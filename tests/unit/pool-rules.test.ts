import { describe, expect, it } from "vitest";
import type { PoolStatus } from "@/generated/prisma/enums";
import { DomainError } from "@/domain/errors";
import {
  POOL_TRANSITIONS,
  assertParticipationTransition,
  assertPoolTransition,
  assertValidExtension,
  canAcceptBelowMinimum,
  canExtendDeadline,
  canTransition,
  computeProgress,
  decideAfterCommit,
  decideAfterPayments,
  decideOnDeadline,
  isAcceptingJoins,
  reopenDeadline,
  validateParticipationChange,
  validatePoolDefinition,
  type PoolSnapshot,
} from "@/domain/pool-rules";

const NOW = new Date("2026-10-23T15:00:00Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

function pool(overrides: Partial<PoolSnapshot> = {}): PoolSnapshot {
  return {
    status: "ABIERTO",
    totalUnits: 600,
    minUnitsToClose: 480,
    minPerCommerce: 10,
    maxPerCommerce: 120,
    committedUnits: 0,
    closeOnMinimum: true,
    deadlineAt: inHours(48),
    closedAt: null,
    notified80: false,
    ...overrides,
  };
}

describe("máquina de estados del pool", () => {
  it("permite el camino feliz completo", () => {
    const happy: PoolStatus[] = [
      "BORRADOR",
      "PENDIENTE_APROBACION",
      "ABIERTO",
      "COMPLETO",
      "CERRADO_PAGADO",
      "EN_ENTREGA",
      "ENTREGADO",
    ];
    for (let i = 0; i < happy.length - 1; i++) {
      expect(canTransition(happy[i]!, happy[i + 1]!)).toBe(true);
    }
  });

  it("permite publicar directo cuando no se exige aprobación", () => {
    expect(canTransition("BORRADOR", "ABIERTO")).toBe(true);
  });

  it("permite vencer, extender una vez y aceptar cerrar igual", () => {
    expect(canTransition("ABIERTO", "VENCIDO_SIN_COMPLETAR")).toBe(true);
    expect(canTransition("VENCIDO_SIN_COMPLETAR", "ABIERTO")).toBe(true);
    expect(canTransition("VENCIDO_SIN_COMPLETAR", "COMPLETO")).toBe(true);
  });

  it("permite reabrir un pool completo cuando alguien no pagó", () => {
    expect(canTransition("COMPLETO", "ABIERTO")).toBe(true);
  });

  it("los estados finales no tienen salida", () => {
    expect(POOL_TRANSITIONS.ENTREGADO).toHaveLength(0);
    expect(POOL_TRANSITIONS.CANCELADO).toHaveLength(0);
  });

  it.each<[PoolStatus, PoolStatus]>([
    ["BORRADOR", "COMPLETO"],
    ["ABIERTO", "CERRADO_PAGADO"],
    ["ABIERTO", "ENTREGADO"],
    ["CERRADO_PAGADO", "ABIERTO"],
    ["EN_ENTREGA", "CANCELADO"],
    ["ENTREGADO", "CANCELADO"],
    ["CANCELADO", "ABIERTO"],
    ["VENCIDO_SIN_COMPLETAR", "CERRADO_PAGADO"],
  ])("rechaza %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertPoolTransition(from, to)).toThrow(DomainError);
  });

  it("valida transiciones de participación", () => {
    expect(() => assertParticipationTransition("COMPROMETIDA", "PENDIENTE_PAGO")).not.toThrow();
    expect(() => assertParticipationTransition("PENDIENTE_PAGO", "PAGADA")).not.toThrow();
    expect(() => assertParticipationTransition("LIBERADA", "COMPROMETIDA")).not.toThrow();
    expect(() => assertParticipationTransition("COMPROMETIDA", "PAGADA")).toThrow(DomainError);
    expect(() => assertParticipationTransition("ENTREGADA", "CANCELADA")).toThrow(DomainError);
  });
});

describe("isAcceptingJoins", () => {
  it("acepta en ABIERTO antes de la fecha límite", () => {
    expect(isAcceptingJoins(pool(), NOW)).toBe(true);
  });
  it("acepta en COMPLETO si sigue abierto (no se cerró al mínimo)", () => {
    expect(isAcceptingJoins(pool({ status: "COMPLETO", closedAt: null }), NOW)).toBe(true);
  });
  it("no acepta si está cerrado o vencido", () => {
    expect(isAcceptingJoins(pool({ status: "COMPLETO", closedAt: NOW }), NOW)).toBe(false);
    expect(isAcceptingJoins(pool({ deadlineAt: inHours(-1) }), NOW)).toBe(false);
    expect(isAcceptingJoins(pool({ status: "BORRADOR" }), NOW)).toBe(false);
  });
});

describe("validateParticipationChange", () => {
  it("devuelve la diferencia de unidades al sumarse", () => {
    expect(validateParticipationChange(pool(), { currentQty: 0, newQty: 10, now: NOW })).toBe(10);
  });

  it("permite modificar y retirarse mientras está ABIERTO", () => {
    expect(validateParticipationChange(pool({ committedUnits: 50 }), { currentQty: 20, newQty: 30, now: NOW })).toBe(10);
    expect(validateParticipationChange(pool({ committedUnits: 50 }), { currentQty: 20, newQty: 10, now: NOW })).toBe(-10);
    expect(validateParticipationChange(pool({ committedUnits: 50 }), { currentQty: 20, newQty: 0, now: NOW })).toBe(-20);
  });

  it("en COMPLETO (sigue abierto) solo deja sumar, no bajar ni retirarse", () => {
    const p = pool({ status: "COMPLETO", committedUnits: 500, closeOnMinimum: false });
    expect(validateParticipationChange(p, { currentQty: 20, newQty: 40, now: NOW })).toBe(20);
    expect(() => validateParticipationChange(p, { currentQty: 20, newQty: 10, now: NOW })).toThrow(/no bajar/);
    expect(() => validateParticipationChange(p, { currentQty: 20, newQty: 0, now: NOW })).toThrow(DomainError);
  });

  it("respeta mínimo y máximo por comercio", () => {
    expect(() => validateParticipationChange(pool(), { currentQty: 0, newQty: 5, now: NOW })).toThrow(/mínimo/);
    expect(() => validateParticipationChange(pool(), { currentQty: 0, newQty: 121, now: NOW })).toThrow(/máximo/);
  });

  it("nunca permite superar el total de unidades", () => {
    const p = pool({ committedUnits: 595 });
    expect(() => validateParticipationChange(p, { currentQty: 0, newQty: 10, now: NOW })).toThrow(/Solo quedan 5/);
    const full = pool({ committedUnits: 600, status: "COMPLETO", closeOnMinimum: false });
    expect(() => validateParticipationChange(full, { currentQty: 0, newQty: 10, now: NOW })).toThrow(/No quedan/);
  });

  it("rechaza cantidades inválidas y cambios nulos", () => {
    expect(() => validateParticipationChange(pool(), { currentQty: 0, newQty: 1.5, now: NOW })).toThrow(DomainError);
    expect(() => validateParticipationChange(pool(), { currentQty: 10, newQty: 10, now: NOW })).toThrow(/Ya tenés/);
  });

  it("rechaza cambios fuera de plazo", () => {
    expect(() =>
      validateParticipationChange(pool({ deadlineAt: inHours(-1) }), { currentQty: 0, newQty: 10, now: NOW }),
    ).toThrow(/no acepta/);
  });
});

describe("decideAfterCommit", () => {
  it("pasa a COMPLETO y cierra al alcanzar el mínimo si closeOnMinimum", () => {
    expect(decideAfterCommit(pool({ committedUnits: 470 }), 480)).toEqual({
      nextStatus: "COMPLETO",
      reachedMinimum: true,
      shouldClose: true,
      crossed80: false,
    });
  });

  it("pasa a COMPLETO pero sigue abierto si el preventista eligió seguir hasta el total", () => {
    const d = decideAfterCommit(pool({ closeOnMinimum: false }), 500);
    expect(d.nextStatus).toBe("COMPLETO");
    expect(d.shouldClose).toBe(false);
  });

  it("cierra cuando se llega al total aunque no cierre al mínimo", () => {
    const d = decideAfterCommit(pool({ status: "COMPLETO", closeOnMinimum: false, committedUnits: 590 }), 600);
    expect(d.shouldClose).toBe(true);
    expect(d.reachedMinimum).toBe(false);
  });

  it("avisa una sola vez al cruzar el 80 % del mínimo", () => {
    expect(decideAfterCommit(pool(), 384).crossed80).toBe(true); // 384 = 80 % de 480
    expect(decideAfterCommit(pool(), 383).crossed80).toBe(false);
    expect(decideAfterCommit(pool({ notified80: true }), 400).crossed80).toBe(false);
    // Si salta directo al 100 % se notifica "completo", no "80 %".
    expect(decideAfterCommit(pool(), 480).crossed80).toBe(false);
  });
});

describe("decideOnDeadline", () => {
  it("no hace nada antes de la fecha", () => {
    expect(decideOnDeadline(pool(), NOW)).toBe("NONE");
  });
  it("vence un pool ABIERTO", () => {
    expect(decideOnDeadline(pool({ deadlineAt: inHours(-1) }), NOW)).toBe("EXPIRE");
  });
  it("cierra un pool COMPLETO que seguía abierto", () => {
    expect(decideOnDeadline(pool({ status: "COMPLETO", deadlineAt: inHours(-1) }), NOW)).toBe("CLOSE");
  });
  it("ignora pools ya cerrados", () => {
    expect(decideOnDeadline(pool({ status: "COMPLETO", closedAt: NOW, deadlineAt: inHours(-1) }), NOW)).toBe("NONE");
  });
});

describe("decideAfterPayments", () => {
  const base = { unpaidRule: "REABRIR" as const, acceptedBelowMinimum: false, minUnitsToClose: 480 };
  it("espera mientras haya pagos pendientes", () => {
    expect(decideAfterPayments({ ...base, paidUnits: 480, pendingPaymentUnits: 10 })).toBe("WAIT");
  });
  it("marca pagado si lo pagado alcanza el mínimo", () => {
    expect(decideAfterPayments({ ...base, paidUnits: 480, pendingPaymentUnits: 0 })).toBe("MARK_PAID");
  });
  it("REABRIR: vuelve a abrir si falta para el mínimo", () => {
    expect(decideAfterPayments({ ...base, paidUnits: 300, pendingPaymentUnits: 0 })).toBe("REOPEN");
    expect(decideAfterPayments({ ...base, paidUnits: 0, pendingPaymentUnits: 0 })).toBe("REOPEN");
  });
  it("CERRAR_CON_PAGADO: cierra con lo pagado o cancela si nadie pagó", () => {
    const rule = { ...base, unpaidRule: "CERRAR_CON_PAGADO" as const };
    expect(decideAfterPayments({ ...rule, paidUnits: 300, pendingPaymentUnits: 0 })).toBe("MARK_PAID");
    expect(decideAfterPayments({ ...rule, paidUnits: 0, pendingPaymentUnits: 0 })).toBe("CANCEL");
  });
  it("si el preventista aceptó cerrar por debajo del mínimo, nunca reabre", () => {
    expect(
      decideAfterPayments({ ...base, acceptedBelowMinimum: true, paidUnits: 100, pendingPaymentUnits: 0 }),
    ).toBe("MARK_PAID");
  });
});

describe("vencimiento y extensión", () => {
  const expired = {
    status: "VENCIDO_SIN_COMPLETAR" as const,
    extendedOnce: false,
    finalizedAt: null,
    decisionDeadlineAt: inHours(24),
    committedUnits: 200,
  };
  it("permite extender una sola vez dentro de la ventana de decisión", () => {
    expect(canExtendDeadline(expired, NOW)).toBe(true);
    expect(canExtendDeadline({ ...expired, extendedOnce: true }, NOW)).toBe(false);
    expect(canExtendDeadline({ ...expired, decisionDeadlineAt: inHours(-1) }, NOW)).toBe(false);
    expect(canExtendDeadline({ ...expired, finalizedAt: NOW }, NOW)).toBe(false);
  });
  it("permite aceptar cerrar igual si hay unidades comprometidas", () => {
    expect(canAcceptBelowMinimum(expired, NOW)).toBe(true);
    expect(canAcceptBelowMinimum({ ...expired, committedUnits: 0 }, NOW)).toBe(false);
  });
  it("valida la nueva fecha", () => {
    expect(() => assertValidExtension(inHours(0.5), NOW)).toThrow(DomainError);
    expect(() => assertValidExtension(inHours(24 * 31), NOW)).toThrow(DomainError);
    expect(() => assertValidExtension(inHours(72), NOW)).not.toThrow();
  });
  it("reopenDeadline nunca acorta la fecha", () => {
    expect(reopenDeadline(inHours(100), NOW, 48)).toEqual(inHours(100));
    expect(reopenDeadline(inHours(-5), NOW, 48)).toEqual(inHours(48));
  });
});

describe("computeProgress", () => {
  it("calcula porcentajes acotados", () => {
    expect(computeProgress(240, 480, 600)).toMatchObject({ percentOfMinimum: 50, percentOfTotal: 40, available: 360 });
    expect(computeProgress(600, 480, 600)).toMatchObject({ percentOfMinimum: 100, remainingToMinimum: 0, available: 0 });
    expect(computeProgress(0, 0, 0).percentOfMinimum).toBe(0);
  });
});

describe("validatePoolDefinition", () => {
  const valid = {
    totalUnits: 600,
    minUnitsToClose: 480,
    minPerCommerce: 10,
    maxPerCommerce: 120,
    deadlineAt: inHours(72),
    estimatedDeliveryAt: inHours(120),
    unitPriceCents: 150_000,
    retailUnitPriceCents: 199_900,
  };
  it("acepta una definición válida", () => {
    expect(validatePoolDefinition(valid, NOW)).toEqual({});
  });
  it("detecta cada error por campo", () => {
    const errors = validatePoolDefinition(
      {
        ...valid,
        minUnitsToClose: 700,
        maxPerCommerce: 5,
        deadlineAt: inHours(0.5),
        retailUnitPriceCents: 100,
      },
      NOW,
    );
    expect(Object.keys(errors).sort()).toEqual(
      ["deadlineAt", "maxPerCommerce", "minUnitsToClose", "retailUnitPriceCents"].sort(),
    );
  });
  it("la entrega estimada no puede ser antes de la fecha límite", () => {
    expect(validatePoolDefinition({ ...valid, estimatedDeliveryAt: inHours(10) }, NOW)).toHaveProperty(
      "estimatedDeliveryAt",
    );
  });
});
