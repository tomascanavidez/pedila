import {
  Ban,
  CheckCheck,
  CircleCheck,
  CircleDashed,
  Clock,
  CreditCard,
  Flame,
  PackageCheck,
  Truck,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { OrderStatus, ParticipationStatus, PaymentStatus, PoolStatus } from "@/generated/prisma/enums";
import {
  ORDER_STATUS_LABEL,
  PARTICIPATION_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  POOL_STATUS_LABEL,
} from "@/lib/labels";
import { Badge } from "./display";

type Tone = "brand" | "dark" | "outline" | "muted";

// Además del color, cada estado tiene ícono y texto: no se depende solo del color.
const POOL: Record<PoolStatus, { tone: Tone; icon: LucideIcon }> = {
  BORRADOR: { tone: "outline", icon: CircleDashed },
  PENDIENTE_APROBACION: { tone: "outline", icon: Clock },
  ABIERTO: { tone: "brand", icon: Flame },
  COMPLETO: { tone: "dark", icon: CircleCheck },
  CERRADO_PAGADO: { tone: "dark", icon: CreditCard },
  EN_ENTREGA: { tone: "outline", icon: Truck },
  ENTREGADO: { tone: "outline", icon: PackageCheck },
  VENCIDO_SIN_COMPLETAR: { tone: "muted", icon: Clock },
  CANCELADO: { tone: "muted", icon: Ban },
};

export function PoolStatusBadge({ status, closed }: { status: PoolStatus; closed?: boolean }) {
  const cfg = POOL[status];
  const Icon = cfg.icon;
  const label = status === "COMPLETO" && closed ? "Cerrado · esperando pagos" : POOL_STATUS_LABEL[status];
  return (
    <Badge tone={cfg.tone}>
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {label}
    </Badge>
  );
}

const PART: Record<ParticipationStatus, Tone> = {
  COMPROMETIDA: "brand",
  PENDIENTE_PAGO: "dark",
  PAGADA: "outline",
  ENTREGADA: "outline",
  RETIRADA: "muted",
  LIBERADA: "muted",
  CANCELADA: "muted",
};

export function ParticipationStatusBadge({ status }: { status: ParticipationStatus }) {
  return <Badge tone={PART[status]}>{PARTICIPATION_STATUS_LABEL[status]}</Badge>;
}

const PAY: Record<PaymentStatus, { tone: Tone; icon: LucideIcon }> = {
  PENDIENTE: { tone: "dark", icon: Clock },
  EN_PROCESO: { tone: "outline", icon: Clock },
  APROBADO: { tone: "brand", icon: CheckCheck },
  VENCIDO: { tone: "muted", icon: Ban },
  CANCELADO: { tone: "muted", icon: Ban },
  REINTEGRADO: { tone: "outline", icon: Undo2 },
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const cfg = PAY[status];
  const Icon = cfg.icon;
  return (
    <Badge tone={cfg.tone}>
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {PAYMENT_STATUS_LABEL[status]}
    </Badge>
  );
}

const ORDER: Record<OrderStatus, Tone> = {
  PENDIENTE_PAGO: "dark",
  PAGADO: "brand",
  EN_ENTREGA: "outline",
  ENTREGADO: "outline",
  CANCELADO: "muted",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER[status]}>{ORDER_STATUS_LABEL[status]}</Badge>;
}
