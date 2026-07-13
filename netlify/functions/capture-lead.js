// Captura de lead (exit-intent 5%)
// POST /.netlify/functions/capture-lead   body: { email, website (honeypot), utm }
//
// 1) Manda el email de bienvenida con el código BIENVENIDA5 (Resend, key de envío).
// 2) Añade el contacto a la Resend Audience para retargeting/newsletters.
//    - El paso (2) requiere una key Full Access en RESEND_FULL_KEY + RESEND_AUDIENCE_ID.
//    - Si no están configuradas, el email se manda igual y el guardado se omite (log).

const PROMO_CODE = 'BIENVENIDA5';
const DISCOUNT_PCT = 5;

// Key de ENVÍO (la actual, restringida a emails)
const SEND_KEY = process.env.RESEND_API_KEY;
// Key FULL ACCESS para gestionar Audiences/Contactos (opcional hasta que exista)
const FULL_KEY = process.env.RESEND_FULL_KEY || process.env.RESEND_API_KEY;
const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID || '';
const FROM = process.env.RESEND_FROM || 'La Mirada Creativa <hola@lamiradacreativa.com>';

// ---- Validación / anti-abuso -------------------------------------------------
function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length < 255;
}

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 3600000; // 1h
const RATE_LIMIT_MAX = 8;
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

// ---- Email de bienvenida -----------------------------------------------------
function buildEmailHtml() {
  const FONT = "'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#F5F6F8;font-family:${FONT};">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F6F8;padding:32px 0;"><tr><td align="center" style="padding:0 16px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px -16px rgba(20,32,64,0.22);">

<tr><td style="padding:30px 32px 0;">
  <p style="margin:0;font-size:16px;font-weight:800;letter-spacing:-0.01em;color:#0B0B0D;font-family:${FONT};">La Mirada Creativa</p>
</td></tr>

<tr><td style="padding:22px 32px 20px;">
  <p style="font-size:16px;color:#0B0B0D;margin:0 0 16px;line-height:1.6;font-weight:700;">Aquí tienes tu descuento, como prometimos.</p>
  <p style="font-size:15px;color:#6A6F79;margin:0;line-height:1.7;">Un ${DISCOUNT_PCT}% en <strong style="color:#0B0B0D;">La Mirada Creativa</strong> — 365 cartas digitales con retos para entrenar tu ojo. Pago único, sin suscripciones.</p>
</td></tr>

<tr><td style="padding:0 32px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF8E6;border:1.5px solid #FFE08A;border-radius:14px;">
  <tr><td style="padding:24px;text-align:center;">
    <p style="font-size:12px;color:#8A6A00;margin:0 0 6px;line-height:1.5;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;">Tu código de bienvenida</p>
    <p style="font-size:24px;color:#0B0B0D;margin:0 0 14px;line-height:1.2;font-weight:800;">${DISCOUNT_PCT}% de descuento</p>
    <table cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 14px;"><tr>
      <td style="background-color:#0B0B0D;border-radius:10px;padding:13px 26px;">
        <span style="font-size:20px;color:#ffffff;font-weight:700;letter-spacing:0.12em;font-family:'Courier New',Courier,monospace;">${PROMO_CODE}</span>
      </td></tr>
    </table>
    <p style="font-size:13px;color:#8A6A00;margin:0;line-height:1.5;">Aplícalo en el paso de pago. Sin fecha de caducidad.</p>
  </td></tr>
  </table>
</td></tr>

<tr><td style="padding:24px 32px 0;" align="center">
  <table cellpadding="0" cellspacing="0"><tr><td style="background-color:#FFB020;background-image:linear-gradient(135deg,#FFD84D 0%,#FFB020 100%);border-radius:100px;">
    <a href="https://lamiradacreativa.com/#precio?utm_source=email&utm_medium=lead&utm_campaign=bienvenida_5" style="display:inline-block;color:#241900;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:100px;font-family:${FONT};">Usar mi ${DISCOUNT_PCT}% ahora</a>
  </td></tr></table>
</td></tr>

<tr><td style="padding:28px 32px 0;">
  <p style="font-size:15px;color:#6A6F79;margin:0;line-height:1.7;">El problema nunca fue tu cámara.</p>
  <p style="font-size:15px;color:#0B0B0D;margin:14px 0 0;line-height:1.7;font-weight:600;">— Rafa</p>
</td></tr>

<tr><td style="padding:26px 32px 30px;">
  <div style="border-top:1px solid #E7E9ED;padding-top:18px;">
    <p style="font-size:11px;color:#9AA0AA;margin:0;font-family:${FONT};">La Mirada Creativa · <a href="https://lamiradacreativa.com" style="color:#9AA0AA;">lamiradacreativa.com</a></p>
  </div>
</td></tr>

</table></td></tr></table>
</body></html>`;
}

async function sendWelcomeEmail(to) {
  if (!SEND_KEY) {
    console.warn('[capture-lead] RESEND_API_KEY no configurada, no se envía email');
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        reply_to: 'hola@lamiradacreativa.com',
        subject: `Tu ${DISCOUNT_PCT}% de descuento — La Mirada Creativa`,
        html: buildEmailHtml(),
      }),
    });
    const out = await res.json();
    console.log('[capture-lead] email Resend:', res.status, JSON.stringify(out));
    return res.ok;
  } catch (e) {
    console.error('[capture-lead] error enviando email:', e.message);
    return false;
  }
}

// Añade el contacto a la Audience (retargeting/newsletters). Requiere key Full Access.
async function addToAudience(email) {
  if (!AUDIENCE_ID) {
    console.log('[capture-lead] RESEND_AUDIENCE_ID no configurado, se omite guardado en Audience');
    return false;
  }
  try {
    const res = await fetch(`https://api.resend.com/audiences/${AUDIENCE_ID}/contacts`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${FULL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, unsubscribed: false }),
    });
    const out = await res.json();
    if (!res.ok) {
      console.warn('[capture-lead] Audience no guardó (¿key restringida?):', res.status, JSON.stringify(out));
      return false;
    }
    console.log('[capture-lead] contacto en Audience:', res.status, JSON.stringify(out));
    return true;
  } catch (e) {
    console.error('[capture-lead] error Audience:', e.message);
    return false;
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) {}

  // Honeypot: si el campo trampa viene relleno, es un bot → respondemos ok sin hacer nada.
  if (body.website) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, code: PROMO_CODE }) };
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email no válido' }) };
  }

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown';
  if (isRateLimited(ip)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Demasiados intentos, prueba en un rato' }) };
  }

  // El email es lo crítico; el guardado en Audience es best-effort.
  const [emailed, stored] = await Promise.all([sendWelcomeEmail(email), addToAudience(email)]);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, code: PROMO_CODE, discount: DISCOUNT_PCT, emailed, stored }),
  };
};
