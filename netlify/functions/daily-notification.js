const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load exercise metadata
let exercisesMeta = [];
try {
  const metaPath = path.join(__dirname, 'data', 'exercises-meta.json');
  exercisesMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
} catch (err) {
  console.error('Failed to load exercises-meta.json:', err.message);
}

// Block label map
const BLOCK_LABELS = {
  'técnica': 'Mirada Técnica',
  'sensible': 'Mirada Sensible',
  'conceptual': 'Mirada Conceptual',
  'propia': 'Mirada Propia'
};

function getExercise(day) {
  return exercisesMeta.find(e => e.day === day) || null;
}

function buildEmailHtml(exercise, streak, appUrl) {
  const blockLabel = BLOCK_LABELS[exercise.block] || exercise.block;
  const streakHtml = streak > 0
    ? `<p style="margin:24px 0 0;font-size:15px;color:#555;">&#128293; Tu racha: ${streak} día${streak === 1 ? '' : 's'}</p>`
    : `<p style="margin:24px 0 0;font-size:15px;color:#555;">Empieza una nueva racha hoy</p>`;

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 24px;background:#ffffff;">
    <p style="margin:0 0 24px;font-size:16px;color:#1A1A1A;line-height:1.6;">
      Tu ejercicio de hoy está listo.
    </p>
    <p style="margin:0 0 8px;font-size:14px;color:#888;">
      Día ${exercise.day} de 365. Bloque: ${blockLabel}. Menos de 5 minutos.
    </p>
    <p style="margin:0 0 32px;font-size:18px;color:#1A1A1A;font-style:italic;line-height:1.5;">
      "${exercise.subtitle}"
    </p>
    <a href="${appUrl}" style="display:inline-block;padding:14px 32px;background-color:#FFB020;background-image:linear-gradient(135deg,#FFD84D 0%,#FFB020 100%);color:#000000;text-decoration:none;border-radius:100px;font-size:16px;font-weight:600;">
      Abrir ejercicio
    </a>
    ${streakHtml}
  </div>
  <div style="max-width:600px;margin:0 auto;padding:24px;text-align:center;font-size:12px;color:#999;">
    La Mirada Creativa ·
    <a href="${appUrl}" style="color:#999;">Configurar notificaciones</a> ·
    <a href="UNSUBSCRIBE_URL" style="color:#999;">Darme de baja</a>
  </div>
</body>
</html>`;
}

function buildCongratsEmailHtml(appUrl) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:40px 24px;background:#ffffff;">
    <p style="margin:0 0 24px;font-size:18px;color:#1A1A1A;line-height:1.6;">
      &#127881; Has completado los 365 ejercicios.
    </p>
    <p style="margin:0 0 32px;font-size:16px;color:#555;line-height:1.6;">
      Tu mirada ya no es la misma. Revisa tus favoritos, repite los que más te retaron, o simplemente sal a disparar con todo lo que has aprendido.
    </p>
    <a href="${appUrl}" style="display:inline-block;padding:14px 32px;background-color:#FFB020;background-image:linear-gradient(135deg,#FFD84D 0%,#FFB020 100%);color:#000000;text-decoration:none;border-radius:100px;font-size:16px;font-weight:600;">
      Abrir la app
    </a>
  </div>
  <div style="max-width:600px;margin:0 auto;padding:24px;text-align:center;font-size:12px;color:#999;">
    La Mirada Creativa ·
    <a href="${appUrl}" style="color:#999;">Configurar notificaciones</a> ·
    <a href="UNSUBSCRIBE_URL" style="color:#999;">Darme de baja</a>
  </div>
</body>
</html>`;
}

async function sendEmail(to, subject, html) {
  const { isSuppressed } = require('../lib/suppressed-emails');
  if (isSuppressed(to)) {
    console.log(`[daily-notification] Suppressed, skipping email to ${to}`);
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
      subject,
      html
    })
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Resend error ${response.status}: ${JSON.stringify(result)}`);
  }
  return result;
}

function getUserLocalHour(timezone) {
  try {
    const now = new Date();
    const hourStr = now.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false });
    return parseInt(hourStr);
  } catch {
    return null;
  }
}

function getUserToday(timezone) {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

exports.handler = async (event) => {
  // Only run as scheduled function
  console.log('[daily-notification] Starting...');

  try {
    const requiredVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY'];
    const missing = requiredVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
      console.error('Missing env vars:', missing);
      return { statusCode: 500, body: 'Missing environment variables' };
    }

    if (exercisesMeta.length === 0) {
      console.error('No exercise metadata loaded');
      return { statusCode: 500, body: 'No exercise data' };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const utcHour = new Date().getUTCHours();
    const appBaseUrl = 'https://lamiradacreativa.com/app/';
    const utmParams = '?utm_source=email&utm_medium=daily_notification&utm_campaign=retention';
    const appUrl = appBaseUrl + utmParams;

    // Get all users with notifications enabled
    const { data: users, error: usersError } = await supabase
      .from('user_preferences')
      .select('auth0_user_id, email, notification_hour, timezone')
      .eq('daily_notification', true);

    if (usersError) {
      console.error('Error fetching users:', usersError);
      return { statusCode: 500, body: 'Database error' };
    }

    if (!users || users.length === 0) {
      console.log('[daily-notification] No users with notifications enabled');
      return { statusCode: 200, body: 'No users to notify' };
    }

    // Filter users whose local hour matches their notification_hour
    const eligibleUsers = users.filter(user => {
      const localHour = getUserLocalHour(user.timezone || 'Europe/Madrid');
      return localHour === user.notification_hour;
    });

    console.log(`[daily-notification] ${eligibleUsers.length} users eligible for hour ${utcHour} UTC`);

    if (eligibleUsers.length === 0) {
      return { statusCode: 200, body: 'No users to notify at this hour' };
    }

    let sentCount = 0;
    let skippedCount = 0;

    // Process in batches of 10 to respect Resend rate limits
    const BATCH_SIZE = 10;
    for (let i = 0; i < eligibleUsers.length; i += BATCH_SIZE) {
      const batch = eligibleUsers.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(batch.map(async (user) => {
        try {
          const timezone = user.timezone || 'Europe/Madrid';
          const today = getUserToday(timezone);

          // Check if user already completed an exercise today
          const { data: todayProgress } = await supabase
            .from('progress')
            .select('exercise_day')
            .eq('auth0_user_id', user.auth0_user_id)
            .gte('completed_at', today + 'T00:00:00')
            .lt('completed_at', today + 'T23:59:59')
            .limit(1);

          if (todayProgress && todayProgress.length > 0) {
            skippedCount++;
            return; // Already active today — don't bother
          }

          // Get all completed exercise days for this user
          const { data: completedDays } = await supabase
            .from('progress')
            .select('exercise_day')
            .eq('auth0_user_id', user.auth0_user_id);

          const completedSet = new Set((completedDays || []).map(d => d.exercise_day));

          // Find next uncompleted exercise
          const nextExercise = exercisesMeta.find(e => !completedSet.has(e.day));

          // Get streak
          const { data: streakData } = await supabase
            .from('streaks')
            .select('current_streak, last_completed_date')
            .eq('auth0_user_id', user.auth0_user_id)
            .single();

          let currentStreak = 0;
          if (streakData) {
            // Only show streak if last completed was yesterday or today
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: timezone });
            if (streakData.last_completed_date === today || streakData.last_completed_date === yesterdayStr) {
              currentStreak = streakData.current_streak;
            }
          }

          // Build unsubscribe URL with user ID as simple token
          const unsubToken = Buffer.from(user.auth0_user_id).toString('base64url');
          const unsubUrl = `https://lamiradacreativa.com/.netlify/functions/unsubscribe-notification?token=${unsubToken}`;

          if (!nextExercise) {
            // All 365 completed! Send congrats or skip
            if (completedSet.size >= 363) { // 363 exercises exist in data
              let html = buildCongratsEmailHtml(appUrl);
              html = html.replace('UNSUBSCRIBE_URL', unsubUrl);
              await sendEmail(user.email, '365 ejercicios completados', html);
              sentCount++;

              // Auto-disable notifications for completed users
              await supabase
                .from('user_preferences')
                .update({ daily_notification: false, updated_at: new Date().toISOString() })
                .eq('auth0_user_id', user.auth0_user_id);
            }
            return;
          }

          // Send daily exercise email
          let html = buildEmailHtml(nextExercise, currentStreak, appUrl);
          html = html.replace('UNSUBSCRIBE_URL', unsubUrl);
          const subject = nextExercise.title;

          await sendEmail(user.email, subject, html);
          sentCount++;
        } catch (err) {
          console.error(`Error processing user ${user.auth0_user_id}:`, err.message);
        }
      }));

      // Small delay between batches to avoid rate limits
      if (i + BATCH_SIZE < eligibleUsers.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    console.log(`[daily-notification] Done. Sent: ${sentCount}, Skipped: ${skippedCount} (already active today)`);

    return {
      statusCode: 200,
      body: JSON.stringify({ sent: sentCount, skipped: skippedCount, eligible: eligibleUsers.length })
    };
  } catch (error) {
    console.error('[daily-notification] Fatal error:', error);
    return { statusCode: 500, body: 'Internal error' };
  }
};
