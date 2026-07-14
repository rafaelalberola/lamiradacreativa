// Daily metrics push to Telegram.
// Scheduled in netlify.toml. Sends a bulleted summary (progreso) + acciones.
// Bypasses the email suppression list (owner opted out of email) — Telegram
// is the right channel for the owner.
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// Manual test: GET /.netlify/functions/daily-telegram?key=<TELEGRAM_TEST_KEY>

const { computeMetrics } = require('../lib/metrics');

function esc(s) {
  // MarkdownV2 escaping
  return String(s).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

const LEVEL_ICON = { alto: '🔴', medio: '🟠', bajo: '🟡', ok: '🟢', info: 'ℹ️' };

function buildMessage(b) {
  const fecha = new Date().toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Madrid',
  });

  let msg = `*La Mirada Creativa · ${esc(fecha)}*\n_Resumen últimos ${b.rangeDays} días_\n\n`;
  msg += `*📊 Progreso*\n`;
  for (const line of b.summary) msg += `• ${esc(line)}\n`;

  msg += `\n*✅ Acciones*\n`;
  const actions = b.actions.filter((a) => a.level !== 'info');
  if (!actions.length) msg += `• ${esc('Sin alertas.')}\n`;
  for (const a of actions) msg += `${LEVEL_ICON[a.level] || '•'} ${esc(a.text)}\n`;

  const infos = b.actions.filter((a) => a.level === 'info');
  if (infos.length) {
    msg += `\n_Avisos técnicos_\n`;
    for (const a of infos) msg += `• ${esc(a.text)}\n`;
  }

  msg += `\n[Abrir dashboard](https://lamiradacreativa.com/metrics/)`;
  return msg;
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID no configurados');

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
    }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram: ${json.description}`);
  return json;
}

exports.handler = async (event) => {
  // Manual HTTP trigger requires a matching test key. The scheduled invocation
  // has no httpMethod, so the cron is never blocked by this.
  if (event.httpMethod === 'GET') {
    const testKey = process.env.TELEGRAM_TEST_KEY;
    if (!testKey || event.queryStringParameters?.key !== testKey) {
      return { statusCode: 403, body: 'forbidden' };
    }
  }

  try {
    const bundle = await computeMetrics({ rangeDays: 7 });
    const text = buildMessage(bundle);
    await sendTelegram(text);
    console.log('[daily-telegram] sent');
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('[daily-telegram] error', e);
    // Try to notify the failure itself so silence never = "all good"
    try {
      await sendTelegram(esc(`⚠️ Fallo generando el resumen diario: ${e.message}`));
    } catch (_) {}
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
