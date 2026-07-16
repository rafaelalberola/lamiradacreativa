// Free Trial Email Sequence — Scheduled Function
// Runs every 15 minutes, sends pending emails
// Config in netlify.toml: [functions."free-send-sequence"] schedule = "*/15 * * * *"

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BATCH_SIZE = 50;
const BASE_URL = 'https://lamiradacreativa.com';

// ============================================
// Email templates by step
// ============================================
function getEmailTemplate(step) {
  const templates = {
    // Step 0 is sent immediately by free-register.js — included here as fallback
    0: {
      subject: 'Tu primer ejercicio está listo',
      html: buildEmailHtml(0)
    },
    1: {
      subject: 'Día 2. ¿Disparaste ayer?',
      html: buildEmailHtml(1)
    },
    2: {
      subject: 'Llevas 3 días',
      html: buildEmailHtml(2)
    },
    3: {
      subject: 'Lo que pasa después del día 7',
      html: buildEmailHtml(3)
    },
    4: {
      subject: 'Un ejercicio que cambió cómo disparo',
      html: buildEmailHtml(4)
    },
    5: {
      subject: 'Último día de prueba',
      html: buildEmailHtml(5)
    },
    6: {
      subject: 'Tu racha se rompió',
      html: buildEmailHtml(6)
    }
  };
  return templates[step] || null;
}

// ============================================
// Email HTML builder
// ============================================
function buildEmailHtml(step) {
  const utmBase = `utm_source=email&utm_medium=sequence&utm_campaign=free_trial&utm_content=day_`;

  const bodies = {
    0: `
      <p style="font-size:15px;color:#0B0B0D;margin:0 0 20px;line-height:1.7;">Bienvenido a La Mirada Creativa.</p>
      <p style="font-size:15px;color:#6A6F79;margin:0 0 20px;line-height:1.7;">Tienes 7 ejercicios esperándote. Uno por día. Menos de 5 minutos cada uno.</p>
      <p style="font-size:15px;color:#6A6F79;margin:0 0 28px;line-height:1.7;">No vas a aprender teoría. Vas a entrenar tu ojo.</p>
      ${ctaButton('Abrir mi primer ejercicio', `${BASE_URL}/prueba-gratis/ejercicio/?day=1&${utmBase}0`)}
      <p style="font-size:15px;color:#6A6F79;margin:28px 0 0;line-height:1.7;">El problema nunca fue tu cámara.</p>`,

    1: `
      <p style="font-size:15px;color:#6A6F79;margin:0 0 20px;line-height:1.7;">Si hiciste el ejercicio de ayer, ya sabes de qué va esto.<br>Si no lo hiciste, hoy es otro día.</p>
      <p style="font-size:15px;color:#6A6F79;margin:0 0 28px;line-height:1.7;">Tu segundo ejercicio está listo.</p>
      ${ctaButton('Abrir ejercicio del día 2', `${BASE_URL}/prueba-gratis/ejercicio/?day=2&${utmBase}1`)}
      <p style="font-size:15px;color:#6A6F79;margin:28px 0 0;line-height:1.7;">5 minutos. Una mirada nueva.</p>`,

    2: `
      <p style="font-size:15px;color:#6A6F79;margin:0 0 20px;line-height:1.7;">Tres días mirando diferente.</p>
      <p style="font-size:15px;color:#6A6F79;margin:0 0 28px;line-height:1.7;">La mayoría de fotógrafos nunca entrenan su mirada. Solo compran equipo nuevo y esperan que las fotos cambien.</p>
      <p style="font-size:15px;color:#6A6F79;margin:0 0 28px;line-height:1.7;">Tú ya estás haciendo algo distinto.</p>
      ${ctaButton('Abrir ejercicio del día 3', `${BASE_URL}/prueba-gratis/ejercicio/?day=3&${utmBase}2`)}`,

    3: `
      <p style="font-size:15px;color:#6A6F79;margin:0 0 20px;line-height:1.7;">En dos días se acaban tus ejercicios de prueba.</p>
      <p style="font-size:15px;color:#6A6F79;margin:0 0 20px;line-height:1.7;">Pero el entrenamiento de verdad empieza en el día 8. Ahí es donde la mirada técnica se vuelve instinto.</p>
      <p style="font-size:15px;color:#6A6F79;margin:0 0 28px;line-height:1.7;">365 ejercicios. Cuatro bloques progresivos. De composición básica a firma visual propia.</p>
      <p style="font-size:15px;color:#6A6F79;margin:0 0 28px;line-height:1.7;">Si esto te está sirviendo, no pierdas el ritmo.</p>
      ${ctaButton('Ver el programa completo', `${BASE_URL}/?${utmBase}3`)}`,

    4: `
      <p style="font-size:15px;color:#6A6F79;margin:0 0 20px;line-height:1.7;">El ejercicio del día 81 se llama "Hora dorada".</p>
      <p style="font-size:15px;color:#6A6F79;margin:0 0 20px;line-height:1.7;">Es el que más fotógrafos mencionan cuando les pregunto cuál les cambió la forma de ver.</p>
      <p style="font-size:15px;color:#6A6F79;margin:0 0 20px;line-height:1.7;">No puedo dártelo todavía — está en el Bloque 1, después del día 7.</p>
      <p style="font-size:15px;color:#6A6F79;margin:0 0 28px;line-height:1.7;">Pero mañana terminas tu prueba. Y puedes desbloquear los 365 por lo que cuesta un café a la semana durante un mes.</p>
      <p style="font-size:15px;color:#0B0B0D;margin:0 0 28px;line-height:1.7;font-weight:600;">69 €. Una vez. Para siempre.</p>
      ${ctaButton('Desbloquear los 365 ejercicios — 69 €', `${BASE_URL}/#precio?${utmBase}4`)}`,

    5: `
      <p style="font-size:15px;color:#6A6F79;margin:0 0 20px;line-height:1.7;">Hoy es tu día 7.</p>
      <p style="font-size:15px;color:#6A6F79;margin:0 0 20px;line-height:1.7;">Has entrenado tu mirada durante una semana. La pregunta es simple: ¿quieres seguir?</p>
      <p style="font-size:15px;color:#6A6F79;margin:0 0 28px;line-height:1.7;">365 ejercicios. Cuatro bloques. De mirada técnica a mirada propia.</p>
      <p style="font-size:15px;color:#0B0B0D;margin:0 0 28px;line-height:1.7;font-weight:600;">69 €. Pago único. Acceso para siempre. Garantía de 30 días.</p>
      ${ctaButton('Desbloquear acceso completo — 69 €', `${BASE_URL}/#precio?${utmBase}5`)}
      <p style="font-size:15px;color:#6A6F79;margin:28px 0 0;line-height:1.7;">Si no es para ti, no pasa nada. Pero si has llegado hasta aquí, probablemente es para ti.</p>`,

    6: `
      <p style="font-size:15px;color:#6A6F79;margin:0 0 20px;line-height:1.7;">Llevas 3 días sin ejercicio.</p>
      <p style="font-size:15px;color:#6A6F79;margin:0 0 20px;line-height:1.7;">No te voy a presionar. Solo te digo que el ojo se entrena como un músculo. Si paras, vuelve a donde estaba.</p>
      <p style="font-size:15px;color:#6A6F79;margin:0 0 20px;line-height:1.7;">Los 365 ejercicios siguen ahí. 69 €. Sin prisa, pero sin pausa.</p>
      <p style="font-size:15px;color:#8A6A00;margin:0 0 12px;line-height:1.7;font-weight:600;">Recuerda: tienes un 10% de descuento.</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
      <tr><td bgcolor="#FFFFFF" style="background-color:#FFFFFF;border:2px dashed #E7B94A;border-radius:8px;padding:10px 20px;">
        <p style="font-size:18px;color:#000000;margin:0;font-weight:700;letter-spacing:0.1em;font-family:'Courier New',Courier,monospace;">WELCOME10</p>
      </td></tr>
      </table>
      <p style="font-size:13px;color:#8A6A00;margin:0 0 28px;line-height:1.5;">Usa este código en el checkout. Sin fecha de caducidad.</p>
      ${ctaButton('Retomar el entrenamiento — 10% dto.', `${BASE_URL}/#precio?${utmBase}6`)}`
  };

  const bodyContent = bodies[step] || '';

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;padding:40px 0;">
<tr><td align="center" style="padding:0 16px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

<tr><td style="padding:0 0 32px;">
  ${bodyContent}
  <p style="font-size:15px;color:#0B0B0D;margin:20px 0 0;line-height:1.7;">\u2014 Rafa</p>
</td></tr>

<tr><td style="padding:24px 0 0;border-top:1px solid #f0f0f0;">
  <p style="font-size:11px;color:#aaaaaa;margin:0;">La Mirada Creativa \u00b7 <a href="${BASE_URL}" style="color:#aaaaaa;">lamiradacreativa.com</a></p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function ctaButton(text, url) {
  return `<table cellpadding="0" cellspacing="0"><tr><td>
    <a href="${url}" style="display:inline-block;background-color:#FFB020;background-image:linear-gradient(135deg,#FFD84D 0%,#FFB020 100%);color:#000000;font-size:15px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:100px;">${text}</a>
  </td></tr></table>`;
}

// ============================================
// Send email via Resend
// ============================================
async function sendEmail(to, subject, html) {
  const { isSuppressed } = require('../lib/suppressed-emails');
  if (isSuppressed(to)) {
    console.log(`[Free Sequence] Suppressed, skipping email to ${to}`);
    return { status: 200, suppressed: true };
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
  return { status: response.status, ...result };
}

// ============================================
// Handler (Scheduled Function)
// ============================================
exports.handler = async (event) => {
  console.log('[Free Sequence] Running scheduled check...');

  if (!process.env.RESEND_API_KEY) {
    console.error('[Free Sequence] RESEND_API_KEY not configured');
    return { statusCode: 500 };
  }

  try {
    // Find pending emails: not sent, scheduled time has passed
    const now = new Date().toISOString();

    const { data: pendingEmails, error: fetchError } = await supabase
      .from('email_sequence')
      .select('id, free_user_id, step, scheduled_for, free_users(email, converted)')
      .is('sent_at', null)
      .lte('scheduled_for', now)
      .order('scheduled_for', { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error('[Free Sequence] Fetch error:', fetchError);
      return { statusCode: 500 };
    }

    if (!pendingEmails || pendingEmails.length === 0) {
      console.log('[Free Sequence] No pending emails');
      return { statusCode: 200 };
    }

    console.log(`[Free Sequence] Processing ${pendingEmails.length} emails`);

    let sent = 0;
    let skipped = 0;

    for (const item of pendingEmails) {
      const user = item.free_users;

      if (!user || !user.email) {
        console.warn(`[Free Sequence] No user found for sequence item ${item.id}`);
        continue;
      }

      // Skip email 6 if user has converted
      if (item.step === 6 && user.converted) {
        console.log(`[Free Sequence] Skipping step 6 for converted user: ${user.email}`);
        await supabase
          .from('email_sequence')
          .update({ sent_at: now })
          .eq('id', item.id);
        skipped++;
        continue;
      }

      // Skip all remaining emails if user converted
      if (user.converted && item.step >= 3) {
        console.log(`[Free Sequence] Skipping step ${item.step} for converted user: ${user.email}`);
        await supabase
          .from('email_sequence')
          .update({ sent_at: now })
          .eq('id', item.id);
        skipped++;
        continue;
      }

      const template = getEmailTemplate(item.step);
      if (!template) {
        console.warn(`[Free Sequence] No template for step ${item.step}`);
        continue;
      }

      try {
        const result = await sendEmail(user.email, template.subject, template.html);
        console.log(`[Free Sequence] Step ${item.step} to ${user.email}: ${result.status}`);

        // Mark as sent
        await supabase
          .from('email_sequence')
          .update({ sent_at: new Date().toISOString() })
          .eq('id', item.id);

        sent++;
      } catch (emailError) {
        console.error(`[Free Sequence] Error sending step ${item.step} to ${user.email}:`, emailError.message);
      }
    }

    console.log(`[Free Sequence] Done. Sent: ${sent}, Skipped: ${skipped}`);
    return { statusCode: 200 };

  } catch (error) {
    console.error('[Free Sequence] Error:', error);
    return { statusCode: 500 };
  }
};
