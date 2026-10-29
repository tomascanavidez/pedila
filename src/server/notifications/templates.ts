/** Plantilla de email simple, compatible con clientes de correo (tablas + estilos inline). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function renderEmail(params: {
  title: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  appUrl: string;
}): EmailContent {
  const { title, body, ctaLabel, ctaUrl, appUrl } = params;
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.5">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const cta =
    ctaLabel && ctaUrl
      ? `<p style="margin:24px 0"><a href="${escapeHtml(ctaUrl)}" style="background:#FFD600;color:#111111;font-weight:700;text-decoration:none;padding:14px 22px;border-radius:10px;display:inline-block;border:2px solid #111111">${escapeHtml(ctaLabel)}</a></p>`
      : "";
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border:2px solid #111111;border-radius:14px;overflow:hidden">
<tr><td style="background:#FFD600;padding:16px 24px;font-size:24px;font-weight:900;letter-spacing:1px">PEDILA<span style="color:#111111">.</span></td></tr>
<tr><td style="padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
${paragraphs}${cta}
<p style="margin:24px 0 0;font-size:12px;color:#555555">Recibís este correo porque tenés una cuenta en PEDILA. <a href="${escapeHtml(appUrl)}/notificaciones" style="color:#111111">Ver notificaciones</a></p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${title}\n\n${body}${ctaUrl ? `\n\n${ctaLabel ?? "Ver"}: ${ctaUrl}` : ""}\n\n— PEDILA`;
  return { subject: `${title} · PEDILA`, html, text };
}
