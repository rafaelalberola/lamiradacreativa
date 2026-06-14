// Daily Metrics Report — Scheduled Function
// Runs daily at 7:00 UTC (8:00 CET / 9:00 CEST)
// Config in netlify.toml: [functions."daily-report"] schedule = "0 7 * * *"

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================
// Date helpers
// ============================================

function getSpainDates() {
  // Get "yesterday" and "today" boundaries in UTC
  // Spain is UTC+1 (CET) or UTC+2 (CEST)
  // This function runs at 7:00 UTC, which is 8:00 CET / 9:00 CEST
  // We want yesterday's full day in UTC (good enough approximation)
  const now = new Date();

  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);

  return { yesterdayStart, todayStart };
}

function formatDateSpanish(date) {
  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - 1); // Yesterday
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ============================================
// Metrics queries
// ============================================


async function getEmailSequenceStats() {
  const { data, error } = await supabase
    .from('email_sequence')
    .select('step, sent_at')
    .not('sent_at', 'is', null);

  if (error || !data) return {};

  const stats = {};
  for (const row of data) {
    stats[row.step] = (stats[row.step] || 0) + 1;
  }
  return stats;
}

async function getStreakMetrics() {
  const { data, error } = await supabase
    .from('streaks')
    .select('current_streak, longest_streak, total_completed');

  if (error || !data || data.length === 0) {
    return {
      activos: 0,
      rachaMedia: 0,
      rachaMax: 0,
      distribucion: { inactivo: 0, d1_3: 0, d4_7: 0, d8_30: 0, d30plus: 0 }
    };
  }

  const activos = data.filter(s => s.current_streak > 0).length;
  const streaks = data.map(s => s.current_streak);
  const rachaMedia = activos > 0
    ? Math.round(streaks.filter(s => s > 0).reduce((a, b) => a + b, 0) / activos * 10) / 10
    : 0;
  const rachaMax = Math.max(...streaks, 0);

  const distribucion = {
    inactivo: streaks.filter(s => s === 0).length,
    d1_3: streaks.filter(s => s >= 1 && s <= 3).length,
    d4_7: streaks.filter(s => s >= 4 && s <= 7).length,
    d8_30: streaks.filter(s => s >= 8 && s <= 30).length,
    d30plus: streaks.filter(s => s > 30).length
  };

  return { activos, rachaMedia, rachaMax, distribucion };
}

async function getCompletadosAyer(yesterdayStart, todayStart) {
  const { count, error } = await supabase
    .from('progress')
    .select('id', { count: 'exact', head: true })
    .gte('completed_at', yesterdayStart.toISOString())
    .lt('completed_at', todayStart.toISOString());

  return count || 0;
}

async function getCampaignComparison(yesterdayStart, todayStart) {
  const [freeTotal, freeAyer, freeConverted, payingTotal] = await Promise.all([
    supabase.from('free_users').select('id', { count: 'exact', head: true }),
    supabase.from('free_users').select('id', { count: 'exact', head: true })
      .gte('created_at', yesterdayStart.toISOString())
      .lt('created_at', todayStart.toISOString()),
    supabase.from('free_users').select('id', { count: 'exact', head: true })
      .eq('converted', true),
    supabase.from('streaks').select('auth0_user_id', { count: 'exact', head: true })
  ]);

  const totalPaying = payingTotal.count || 0;
  const converted = freeConverted.count || 0;

  return {
    free: {
      total: freeTotal.count || 0,
      ayer: freeAyer.count || 0,
      convertidos: converted
    },
    directa: {
      compras: totalPaying - converted
    },
    totalPagando: totalPaying
  };
}

// ============================================
// Email HTML builder
// ============================================

function buildReportHtml(fecha, campaigns, emailStats, streaks, completadosAyer) {
  const freeRate = campaigns.free.total > 0
    ? (campaigns.free.convertidos / campaigns.free.total * 100).toFixed(1)
    : '0.0';

  const emailStepNames = [
    'Bienvenida',
    'D\u00eda 2',
    'D\u00eda 3',
    'D\u00eda 5',
    'D\u00eda 6',
    'D\u00eda 7',
    'D\u00eda 10'
  ];

  const emailRows = emailStepNames.map((name, i) => {
    const count = emailStats[i] || 0;
    return `Email ${i} (${name}):`.padEnd(28) + `${count}`;
  }).join('\n');

  const d = streaks.distribucion;

  const textContent = `
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
CAMPA\u00d1A PRUEBA GRATIS (/prueba-gratis/)
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Leads nuevos ayer:    ${campaigns.free.ayer}
Leads total:          ${campaigns.free.total}
Convertidos a pago:   ${campaigns.free.convertidos} de ${campaigns.free.total} (${freeRate}%)

\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
CAMPA\u00d1A VENTA DIRECTA (/)
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Compras directas:     ${campaigns.directa.compras}

Total compradores:    ${campaigns.totalPagando}

\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
EMAILS SECUENCIA (prueba gratis)
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
${emailRows}

\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
PROGRESO (usuarios de pago)
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Ejercicios completados ayer:  ${completadosAyer}
Usuarios con racha activa:    ${streaks.activos}
Racha media:                  ${streaks.rachaMedia} d\u00edas
Racha m\u00e1s larga activa:       ${streaks.rachaMax} d\u00edas

Distribuci\u00f3n de rachas:
- 0 (inactivo):    ${d.inactivo} usuarios
- 1-3 d\u00edas:        ${d.d1_3} usuarios
- 4-7 d\u00edas:        ${d.d4_7} usuarios
- 8-30 d\u00edas:       ${d.d8_30} usuarios
- 30+ d\u00edas:        ${d.d30plus} usuarios

\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
META ADS \u2014 compara con Ads Manager
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u2192 Campa\u00f1a free: Gasto ayer / ${campaigns.free.ayer} leads ayer / CPL
\u2192 Campa\u00f1a directa: Gasto ayer / Compras ayer / CPA
`.trim();

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:40px 0;">
<tr><td align="center" style="padding:0 16px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

<tr><td style="padding:0 0 24px;text-align:center;">
  <span style="font-family:'Courier New',monospace;font-size:13px;font-weight:600;color:#888888;letter-spacing:2px;text-transform:uppercase;">LA MIRADA CREATIVA</span>
</td></tr>

<tr><td style="background-color:#ffffff;border-radius:12px;border:1px solid #e0e0e0;padding:32px 24px;">
  <p style="font-size:16px;font-weight:700;color:#111111;margin:0 0 24px;text-align:center;">Resumen del ${fecha}</p>
  <pre style="font-family:'Courier New',Consolas,monospace;font-size:13px;line-height:1.6;color:#333333;margin:0;white-space:pre-wrap;word-break:break-word;">${textContent}</pre>
</td></tr>

<tr><td style="padding:16px 0 0;text-align:center;">
  <p style="font-size:11px;color:#aaaaaa;margin:0;">Enviado autom\u00e1ticamente a las 8:00 AM</p>
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

async function sendReport(subject, html) {
  const { isSuppressed } = require('../lib/suppressed-emails');
  if (isSuppressed(process.env.REPORT_EMAIL)) {
    console.log(`[Daily Report] Suppressed, skipping report to ${process.env.REPORT_EMAIL}`);
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
      to: [process.env.REPORT_EMAIL],
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
  console.log('[Daily Report] Running...');

  if (!process.env.RESEND_API_KEY) {
    console.error('[Daily Report] RESEND_API_KEY not configured');
    return { statusCode: 500 };
  }

  if (!process.env.REPORT_EMAIL) {
    console.error('[Daily Report] REPORT_EMAIL not configured');
    return { statusCode: 500 };
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[Daily Report] Supabase env vars not configured');
    return { statusCode: 500 };
  }

  try {
    const { yesterdayStart, todayStart } = getSpainDates();
    const fecha = formatDateSpanish(todayStart);

    // Run all queries in parallel
    const [campaigns, emailStats, streaks, completadosAyer] = await Promise.all([
      getCampaignComparison(yesterdayStart, todayStart),
      getEmailSequenceStats(),
      getStreakMetrics(),
      getCompletadosAyer(yesterdayStart, todayStart)
    ]);

    console.log('[Daily Report] Metrics collected:', {
      freeLeads: campaigns.free.total,
      freeAyer: campaigns.free.ayer,
      freeConvertidos: campaigns.free.convertidos,
      comprasDirectas: campaigns.directa.compras,
      totalPagando: campaigns.totalPagando,
      completadosAyer,
      rachasActivas: streaks.activos
    });

    const html = buildReportHtml(fecha, campaigns, emailStats, streaks, completadosAyer);
    const subject = `LMC \u2014 Resumen ${fecha}`;

    const result = await sendReport(subject, html);
    console.log('[Daily Report] Email sent:', result.status);

    return { statusCode: 200 };
  } catch (error) {
    console.error('[Daily Report] Error:', error);
    return { statusCode: 500 };
  }
};
