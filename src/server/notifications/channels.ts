import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getEnv } from "../env";
import { logger } from "../logger";

/**
 * Canales de envío. Email por SMTP (pensado para las casillas que se crean en Ferozo)
 * y WhatsApp abstraído para sumarlo después.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailChannel {
  send(msg: EmailMessage): Promise<{ delivered: boolean; info: string }>;
}

export interface WhatsAppChannel {
  readonly enabled: boolean;
  send(to: string, text: string): Promise<{ delivered: boolean; info: string }>;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const env = getEnv();
  if (!env.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE, // 465 = SSL directo; 587 = STARTTLS (SMTP_SECURE=false)
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } : undefined,
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
  });
  return transporter;
}

export const smtpEmailChannel: EmailChannel = {
  async send(msg) {
    const t = getTransporter();
    if (!t) {
      // Sin SMTP configurado (desarrollo): el correo se registra en el log y no se envía.
      logger.info("Email (modo log, SMTP sin configurar)", { to: msg.to, subject: msg.subject });
      return { delivered: false, info: "SMTP sin configurar: registrado en el log" };
    }
    const info = await t.sendMail({ from: getEnv().MAIL_FROM, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
    return { delivered: true, info: String(info.messageId ?? "enviado") };
  },
};

/**
 * WhatsApp: interfaz lista, sin proveedor conectado (ver README › Decisiones).
 * Para habilitarlo hay que implementar `send` con la API elegida (por ejemplo,
 * WhatsApp Business Cloud API) y poner WHATSAPP_ENABLED=true.
 */
export const whatsAppChannel: WhatsAppChannel = {
  get enabled() {
    return getEnv().WHATSAPP_ENABLED;
  },
  async send(to, text) {
    logger.info("WhatsApp (sin proveedor conectado): mensaje no enviado", { to, length: text.length });
    return { delivered: false, info: "Canal WhatsApp sin proveedor" };
  },
};
