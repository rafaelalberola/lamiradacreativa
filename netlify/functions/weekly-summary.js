// Weekly Summary Email — Scheduled Function
// Runs every Sunday at 9:00 UTC (10:00 CET / 11:00 CEST)
// Config in netlify.toml: [functions."weekly-summary"] schedule = "0 9 * * 0"
//
// Sends a personalized weekly recap to each paying user:
// - Exercises completed this week
// - Current streak & best streak
// - Total progress (X/365) & current block
// - Tone varies by weekly performance (4 levels)

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================
// Block system
// ============================================

function getCurrentBlock(totalCompleted) {
  if (totalCompleted <= 90) return { name: 'Mirada Técnica', number: 1, remaining: 90 - totalCompleted };
  if (totalCompleted <= 182) return { name: 'Mirada Sensible', number: 2, remaining: 182 - totalCompleted };
  if (totalCompleted <= 270) return { name: 'Mirada Narrativa', number: 3, remaining: 270 - totalCompleted };
  return { name: 'Mirada Propia', number: 4, remaining: 365 - totalCompleted };
}

// ============================================
// Fetch user list from user_preferences
// ============================================

async function getUsers() {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('auth0_user_id, email');

  if (error) {
    // Table may not exist yet (Agente F creates it)
    console.warn('[Weekly Summary] Could not read user_preferences:', error.message);
    return [];
  }

  return (data || []).filter(u => u.email && u.auth0_user_id);
}

// ============================================
// Fetch weekly stats for a single user
// ============================================

async function getUserWeeklyStats(auth0UserId) {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [weekProgressRes, streakRes] = await Promise.all([
    supabase
      .from('progress')
      .select('exercise_day', { count: 'exact' })
      .eq('auth0_user_id', auth0UserId)
      .gte('completed_at', weekAgo.toISOString()),
    supabase
      .from('streaks')
      .select('current_streak, longest_streak, total_completed')
      .eq('auth0_user_id', auth0UserId)
      .single()
  ]);

  const completedThisWeek = weekProgressRes.count || 0;
  const streak = streakRes.data || { current_streak: 0, longest_streak: 0, total_completed: 0 };

  return {
    completedThisWeek,
    currentStreak: streak.current_streak || 0,
    longestStreak: streak.longest_streak || 0,
    totalCompleted: streak.total_completed || 0
  };
}

// ============================================
// Email HTML builder
// ============================================

function buildWeeklySummaryHtml(stats) {
  const { completedThisWeek, currentStreak, longestStreak, totalCompleted } = stats;
  const block = getCurrentBlock(totalCompleted);
  const progressPercent = Math.round((totalCompleted / 365) * 100);

  // Progress bar
  const progressBarFill = Math.min(progressPercent, 100);

  // Tone-dependent content
  let headline, body, ctaText, signoff;

  if (completedThisWeek >= 5) {
    // 5-7: Semana impecable
    headline = `Esta semana completaste ${completedThisWeek} de 7 ejercicios.`;
    body = `<p style="font-size:15px;color:#1A1A1A;margin:0 0 24px;line-height:1.6;">Semana impecable. Tu ojo agradece la constancia.</p>

<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
<tr><td style="font-size:14px;color:#555;line-height:1.8;">
\u{1F525} Tu racha: <strong style="color:#1A1A1A;">${currentStreak} d\u00edas</strong> (Mejor racha: ${longestStreak} d\u00edas)<br>
Progreso total: <strong style="color:#1A1A1A;">${totalCompleted}/365</strong> (${progressPercent}%)<br>
Bloque actual: <strong style="color:#1A1A1A;">${block.name}</strong> \u2014 te quedan ${block.remaining} ejercicios para el siguiente.
</td></tr>
</table>`;
    ctaText = 'Abrir tu ejercicio de hoy';
    signoff = 'Cada semana que entrenas, tu mirada se separa un poco m\u00e1s del resto.';
  } else if (completedThisWeek >= 3) {
    // 3-4: Buena semana
    headline = `Esta semana completaste ${completedThisWeek} de 7 ejercicios.`;
    body = `<p style="font-size:15px;color:#1A1A1A;margin:0 0 24px;line-height:1.6;">Buena semana. No perfecta, pero seguiste entrenando.</p>

<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
<tr><td style="font-size:14px;color:#555;line-height:1.8;">
\u{1F525} Tu racha: <strong style="color:#1A1A1A;">${currentStreak} d\u00edas</strong><br>
Progreso: <strong style="color:#1A1A1A;">${totalCompleted}/365</strong> (${progressPercent}%)<br>
Bloque actual: <strong style="color:#1A1A1A;">${block.name}</strong>
</td></tr>
</table>`;
    ctaText = 'Abrir tu ejercicio de hoy';
    signoff = 'La constancia le gana al talento. Siempre.';
  } else if (completedThisWeek >= 1) {
    // 1-2: Semana floja
    headline = `Esta semana completaste ${completedThisWeek} de 7 ejercicios.`;
    body = `<p style="font-size:15px;color:#1A1A1A;margin:0 0 24px;line-height:1.6;">Semana floja. Pero est\u00e1s aqu\u00ed, y eso cuenta.</p>

<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
<tr><td style="font-size:14px;color:#555;line-height:1.8;">
Tu racha: <strong style="color:#1A1A1A;">${currentStreak} d\u00edas</strong><br>
Progreso: <strong style="color:#1A1A1A;">${totalCompleted}/365</strong> (${progressPercent}%)
</td></tr>
</table>

<p style="font-size:14px;color:#555;margin:16px 0 0;line-height:1.6;">La buena noticia: ma\u00f1ana empieza otra semana.</p>`;
    ctaText = 'Retomar el entrenamiento';
    signoff = '';
  } else {
    // 0: Sin actividad
    headline = 'Esta semana tu ojo descans\u00f3.';
    body = `<p style="font-size:15px;color:#1A1A1A;margin:0 0 24px;line-height:1.6;">Tu progreso sigue en ${totalCompleted}/365. No se ha perdido nada.${currentStreak === 0 ? '<br>Pero tu racha volvi\u00f3 a 0.' : ''}</p>

<p style="font-size:14px;color:#555;margin:0 0 0;line-height:1.6;">5 minutos. Un ejercicio. Eso es todo lo que necesitas para volver.</p>`;
    ctaText = 'Abrir tu ejercicio de hoy';
    signoff = '';
  }

  const appUrl = 'https://lamiradacreativa.com/app?utm_source=email&utm_medium=weekly_summary&utm_campaign=retention';
  const prefsUrl = 'https://lamiradacreativa.com/app?tab=settings&utm_source=email&utm_medium=weekly_summary&utm_campaign=retention';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:40px 0;">
<tr><td align="center" style="padding:0 16px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

<!-- Logo -->
<tr><td style="padding:0 0 32px;text-align:center;">
  <span style="font-family:'Courier New',monospace;font-size:13px;font-weight:600;color:#888888;letter-spacing:2px;text-transform:uppercase;">LA MIRADA CREATIVA</span>
</td></tr>

<!-- Card -->
<tr><td style="background-color:#ffffff;border-radius:12px;border:1px solid #e0e0e0;">
  <table width="100%" cellpadding="0" cellspacing="0">

  <!-- Body -->
  <tr><td style="padding:40px 32px;">
    <p style="font-size:17px;color:#1A1A1A;margin:0 0 24px;line-height:1.5;font-weight:600;">${headline}</p>

    ${body}

    <!-- Progress bar -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f0f0;border-radius:4px;height:8px;">
      <tr><td style="width:${progressBarFill}%;background-color:#FF5006;border-radius:4px;height:8px;font-size:1px;">&nbsp;</td>
      <td style="font-size:1px;">&nbsp;</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:6px 0 0;">
      <span style="font-size:12px;color:#999;">${totalCompleted} de 365 ejercicios</span>
    </td></tr>
    </table>

    <!-- CTA -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;">
    <tr><td align="center">
      <a href="${appUrl}" style="display:inline-block;background-color:#FF5006;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;"><span style="color:#ffffff;">${ctaText}</span></a>
    </td></tr>
    </table>

    ${signoff ? `<p style="font-size:14px;color:#555;margin:32px 0 0;line-height:1.6;font-style:italic;">${signoff}</p>` : ''}

    <p style="font-size:14px;color:#1A1A1A;margin:24px 0 0;line-height:1.5;">\u2014 Rafa</p>
  </td></tr>

  </table>
</td></tr>

<!-- Footer -->
<tr><td style="padding:24px 0 0;text-align:center;">
  <p style="font-size:11px;color:#aaaaaa;margin:0;line-height:1.8;">
    La Mirada Creativa
    &middot; <a href="${prefsUrl}" style="color:#aaaaaa;text-decoration:underline;">Configurar notificaciones</a>
  </p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ============================================
// Send email via Resend API
// ============================================

async function sendEmail(to, html) {
  const { isSuppressed } = require('../lib/suppressed-emails');
  if (isSuppressed(to)) {
    console.log(`[Weekly Summary] Suppressed, skipping email to ${to}`);
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
      subject: 'Tu semana en La Mirada Creativa',
      html
    })
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Resend ${response.status}: ${JSON.stringify(result)}`);
  }
  return result;
}

// ============================================
// Handler
// ============================================

exports.handler = async (event, context) => {
  console.log('[Weekly Summary] Starting...');

  if (!process.env.RESEND_API_KEY) {
    console.error('[Weekly Summary] RESEND_API_KEY not configured');
    return { statusCode: 500, body: 'Missing RESEND_API_KEY' };
  }

  // 1. Get all users
  const users = await getUsers();
  if (users.length === 0) {
    console.warn('[Weekly Summary] No users found in user_preferences. Skipping.');
    return { statusCode: 200, body: 'No users to process' };
  }

  console.log(`[Weekly Summary] Processing ${users.length} users...`);

  let sent = 0;
  let errors = 0;

  // 2. Process each user
  for (const user of users) {
    try {
      const stats = await getUserWeeklyStats(user.auth0_user_id);
      const html = buildWeeklySummaryHtml(stats);
      await sendEmail(user.email, html);
      sent++;
      console.log(`[Weekly Summary] Sent to ${user.email} (${stats.completedThisWeek}/7 this week)`);
    } catch (err) {
      errors++;
      console.error(`[Weekly Summary] Error for ${user.email}:`, err.message);
    }
  }

  const summary = `Enviados ${sent} resúmenes semanales (${errors} errores)`;
  console.log(`[Weekly Summary] Done. ${summary}`);

  return { statusCode: 200, body: summary };
};
