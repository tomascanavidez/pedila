import type { Metadata } from "next";
import { UNPAID_RULE_LABEL } from "@/lib/labels";
import { ActionForm } from "@/components/ui/action-form";
import { Card, PageHeader } from "@/components/ui/display";
import { updateOperationalSettingsAction } from "@/server/actions/admin";
import { requirePageUser } from "@/server/auth/guards";
import { getPlatformConfig } from "@/server/config";
import { activePaymentProvider, getEnv } from "@/server/env";

export const metadata: Metadata = { title: "Configuración" };

export default async function SettingsPage() {
  await requirePageUser(["ADMIN"], "/admin/configuracion");
  const config = await getPlatformConfig();
  const env = getEnv();
  return (
    <>
      <PageHeader title="Configuración" description="Plazos y reglas de los pools. Se congelan en cada pool al publicarlo." />
      <div className="flex flex-col gap-6">
        <Card>
          <ActionForm action={updateOperationalSettingsAction} submitLabel="Guardar configuración" buttonClassName="self-start">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-bold">
                Plazo para pagar al cerrarse un pool (horas)
                <input type="number" name="paymentWindowHours" min={1} max={240} defaultValue={config.paymentWindowHours} className="field-input" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                Si alguien no paga a tiempo
                <select name="unpaidRule" defaultValue={config.unpaidRule} className="field-input">
                  {Object.entries(UNPAID_RULE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                Al reabrir, extender la fecha al menos (horas)
                <input type="number" name="reopenExtensionHours" min={1} max={720} defaultValue={config.reopenExtensionHours} className="field-input" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                Ventana para que el preventista decida un pool vencido (horas)
                <input type="number" name="expiredDecisionHours" min={1} max={720} defaultValue={config.expiredDecisionHours} className="field-input" />
              </label>
            </div>
            <label className="flex min-h-[44px] items-center gap-3 font-semibold">
              <input type="checkbox" name="poolApprovalRequired" defaultChecked={config.poolApprovalRequired} className="h-6 w-6 accent-[#111111]" />
              Los pools necesitan aprobación del admin antes de publicarse
            </label>
          </ActionForm>
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-black">Integraciones (se configuran en el archivo .env del servidor)</h2>
          <ul className="flex flex-col gap-1 text-sm">
            <li>Pagos: <b>{activePaymentProvider() === "mercadopago" ? `Mercado Pago${env.MP_USE_SANDBOX ? " (modo prueba)" : ""}` : "Simulado (solo desarrollo)"}</b></li>
            <li>Webhook de Mercado Pago: <code>{env.APP_URL.replace(/\/$/, "")}/api/webhooks/mercadopago</code> {env.MP_WEBHOOK_SECRET ? "(firma verificada)" : "(sin clave secreta: configurá MP_WEBHOOK_SECRET)"}</li>
            <li>Email: <b>{env.SMTP_HOST ? `SMTP ${env.SMTP_HOST}:${env.SMTP_PORT}` : "sin SMTP (los correos se registran en el log)"}</b></li>
            <li>WhatsApp: <b>{env.WHATSAPP_ENABLED ? "habilitado" : "no conectado"}</b></li>
          </ul>
        </Card>
      </div>
    </>
  );
}
