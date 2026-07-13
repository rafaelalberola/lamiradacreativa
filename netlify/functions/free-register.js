// Free Trial Registration
// POST /.netlify/functions/free-register
// Registers a free user, schedules email sequence, sends welcome email

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================
// Email validation
// ============================================
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length < 255;
}

// ============================================
// Rate limiting (simple in-memory, per cold start)
// ============================================
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 3600000; // 1 hour
const RATE_LIMIT_MAX = 5;

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

// ============================================
// Email sequence schedule (hours from registration)
// ============================================
const SEQUENCE_DELAYS_HOURS = [0, 24, 72, 120, 144, 168, 240];

// ============================================
// Welcome email HTML (Step 0)
// ============================================
function buildWelcomeEmailHtml() {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;padding:40px 0;">
<tr><td align="center" style="padding:0 16px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

<tr><td style="padding:0 0 32px;">
  <p style="font-size:15px;color:#0B0B0D;margin:0 0 20px;line-height:1.7;">Bienvenido a La Mirada Creativa.</p>
  <p style="font-size:15px;color:#6A6F79;margin:0 0 20px;line-height:1.7;">Tienes 7 ejercicios esperándote. Uno por día. Menos de 5 minutos cada uno.</p>
  <p style="font-size:15px;color:#6A6F79;margin:0 0 28px;line-height:1.7;">No vas a aprender teoría. Vas a entrenar tu ojo.</p>

  <table cellpadding="0" cellspacing="0" width="100%"><tr><td>
    <a href="https://lamiradacreativa.com/prueba-gratis/ejercicio/?day=1&utm_source=email&utm_medium=sequence&utm_campaign=free_trial&utm_content=day_0" style="display:inline-block;background-color:#FFB020;background-image:linear-gradient(135deg,#FFD84D 0%,#FFB020 100%);color:#241900;font-size:15px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:100px;">Abrir mi primer ejercicio</a>
  </td></tr></table>
</td></tr>

<!-- Coupon section -->
<tr><td style="padding:28px 0 0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF8E6;border:1.5px solid #FFE08A;border-radius:14px;">
  <tr><td style="padding:24px;">
    <p style="font-size:13px;color:#8A6A00;margin:0 0 6px;line-height:1.5;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Tu regalo de bienvenida</p>
    <p style="font-size:22px;color:#0B0B0D;margin:0 0 12px;line-height:1.3;font-weight:700;">10% de descuento en el programa completo</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
    <tr><td style="background-color:#0B0B0D;border-radius:8px;padding:12px 24px;">
      <p style="font-size:20px;color:#ffffff;margin:0;font-weight:700;letter-spacing:0.1em;font-family:'Courier New',Courier,monospace;">WELCOME10</p>
    </td></tr>
    </table>
    <p style="font-size:13px;color:#8A6A00;margin:0;line-height:1.5;">Usa este código cuando quieras acceder a los 365 ejercicios. Sin prisa, sin fecha de caducidad.</p>
  </td></tr>
  </table>
</td></tr>

<tr><td style="padding:28px 0 0;">
  <p style="font-size:15px;color:#6A6F79;margin:0 0 0;line-height:1.7;">El problema nunca fue tu cámara.</p>
  <p style="font-size:15px;color:#0B0B0D;margin:20px 0 0;line-height:1.7;">\u2014 Rafa</p>
</td></tr>

<tr><td style="padding:24px 0 0;border-top:1px solid #f0f0f0;">
  <p style="font-size:11px;color:#aaaaaa;margin:0;">La Mirada Creativa \u00b7 lamiradacreativa.com</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ============================================
// Send email via Resend
// ============================================
async function sendEmail(to, subject, html) {
  const { isSuppressed } = require('../lib/suppressed-emails');
  if (isSuppressed(to)) {
    console.log(`[Free Register] Suppressed, skipping email to ${to}`);
    return null;
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('[Free Register] RESEND_API_KEY not configured');
    return null;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'La Mirada Creativa <hola@lamiradacreativa.com>',
      to: [to],
      reply_to: 'hola@lamiradacreativa.com',
      subject: subject,
      html: html
    })
  });

  const result = await response.json();
  console.log('[Free Register] Resend response:', response.status, JSON.stringify(result));
  return result;
}

// ============================================
// Handler
// ============================================
exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Rate limiting
    const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    if (isRateLimited(clientIp)) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: 'Demasiados intentos. Espera un poco.' })
      };
    }

    // Parse body
    const body = JSON.parse(event.body || '{}');
    const email = (body.email || '').trim().toLowerCase();

    if (!email || !isValidEmail(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email no válido' })
      };
    }

    // Upsert free user (if email exists, just return success)
    const { data: existingUser } = await supabase
      .from('free_users')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    let userId;

    if (existingUser) {
      console.log('[Free Register] Existing user:', email);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, existing: true, error: 'existing_user' })
      };
    } else {
      // Insert new user
      const { data: newUser, error: insertError } = await supabase
        .from('free_users')
        .insert({
          email: email,
          utm_source: body.utm_source || null,
          utm_medium: body.utm_medium || null,
          utm_campaign: body.utm_campaign || null,
          utm_content: body.utm_content || null,
          utm_term: body.utm_term || null
        })
        .select('id')
        .single();

      if (insertError) {
        // Handle unique constraint (race condition)
        if (insertError.code === '23505') {
          const { data: retryUser } = await supabase
            .from('free_users')
            .select('id')
            .eq('email', email)
            .single();
          userId = retryUser?.id;
        } else {
          console.error('[Free Register] Insert error:', insertError);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Error al registrar' })
          };
        }
      } else {
        userId = newUser.id;
      }

      console.log('[Free Register] New user:', email, userId);

      // Schedule email sequence
      const now = new Date();
      const sequenceRows = SEQUENCE_DELAYS_HOURS.map((delayHours, step) => ({
        free_user_id: userId,
        step: step,
        scheduled_for: new Date(now.getTime() + delayHours * 3600000).toISOString()
      }));

      const { error: seqError } = await supabase
        .from('email_sequence')
        .insert(sequenceRows);

      if (seqError) {
        console.error('[Free Register] Sequence insert error:', seqError);
        // Non-fatal — user is registered, emails may not be scheduled
      }

      // Send welcome email (step 0) immediately
      try {
        await sendEmail(email, 'Tu primer ejercicio + un regalo de bienvenida 🎁', buildWelcomeEmailHtml());

        // Mark step 0 as sent
        await supabase
          .from('email_sequence')
          .update({ sent_at: new Date().toISOString() })
          .eq('free_user_id', userId)
          .eq('step', 0);
      } catch (emailError) {
        console.error('[Free Register] Welcome email error:', emailError.message);
        // Non-fatal
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Revisa tu email' })
    };

  } catch (error) {
    console.error('[Free Register] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Error interno' })
    };
  }
};
