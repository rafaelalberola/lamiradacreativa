// Daily metrics push to Telegram.
// Scheduled in netlify.toml. Sends a bulleted summary (progreso) + acciones.
// Bypasses the email suppression list (owner opted out of email) — Telegram
// is the right channel for the owner.
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// Manual test: GET /.netlify/functions/daily-telegram?key=<TELEGRAM_TEST_KEY>

const { computeMetrics, eur, round1 } = require('../lib/metrics');

function esc(s) {
  // MarkdownV2 escaping
  return String(s).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtDay(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${parseInt(d, 10)} ${MESES[parseInt(m, 10) - 1]}`;
}

function errorsBlock(b) {
  const errs = Object.entries(b.errors || {});
  if (!errs.length) return '';
  let out = `\n_Avisos técnicos_\n`;
  for (const [src, m] of errs) out += `• ${esc(`${src}: ${m}`)}\n`;
  return out;
}

// El resumen habla SOLO de la campaña viva: los creativos activos y únicamente
// desde que se lanzaron. Sin histórico, sin anuncios pausados, sin acumulados
// de otras épocas — así el número no se puede malinterpretar.
function buildMessage(b) {
  const fecha = new Date().toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Madrid',
  });
  const cp = b.campaignPeriod;

  let msg = `*La Mirada Creativa · ${esc(fecha)}*\n`;

  if (!cp || !cp.ads || !cp.ads.length) {
    msg += `\n⚪ ${esc('No hay creativos activos: no hay campaña que medir ahora mismo.')}\n`;
    msg += errorsBlock(b);
    msg += `\n[Abrir dashboard](https://lamiradacreativa.com/metrics/)`;
    return msg;
  }

  msg += `_${esc(`Creativos actuales · desde ${fmtDay(cp.since)} · día ${cp.days}`)}_\n\n`;

  // Veredicto SOLO de este periodo.
  let icon = '⚪';
  let line = 'Aún sin datos suficientes para juzgar.';
  const vs = cp.orders === 1 ? 'venta' : 'ventas';
  if (cp.orders > 0 && cp.roas != null) {
    if (cp.roas >= 1.5) {
      icon = '✅';
      line = `Va rentable: por cada 1 € recuperas ${round1(cp.roas)} € (${cp.orders} ${vs}, ${eur(cp.profit)}).`;
    } else if (cp.roas >= 1) {
      icon = '🟠';
      line = `Justo: por cada 1 € recuperas ${round1(cp.roas)} € (${cp.orders} ${vs}, ${eur(cp.profit)}).`;
    } else {
      icon = '🔴';
      line = `De momento pierdes: por cada 1 € recuperas ${round1(cp.roas)} € (${cp.orders} ${vs}, ${eur(cp.profit)}).`;
    }
  } else if (cp.spend > 0) {
    icon = '🔴';
    line = `${eur(cp.spend)} gastados y 0 ventas todavía.`;
  }
  msg += `${icon} *${esc(line)}*\n\n`;

  // Qué creativo tira: el detalle por anuncio vivo.
  msg += `*🎯 Creativos*\n`;
  for (const a of cp.ads.slice(0, 5)) {
    const ctr = a.ctr != null ? round1(a.ctr) + '%' : '—';
    const v = `${a.purchases} ${a.purchases === 1 ? 'venta' : 'ventas'}`;
    msg += `• ${esc(`${a.name} · ${eur(a.spend)} · CTR ${ctr} · ${a.landingViews} vis · ${a.checkouts} chk · ${v}`)}\n`;
  }

  // Números del periodo.
  msg += `\n*📊 Este periodo*\n`;
  const rows = [
    `Gasto: ${eur(cp.spend)}`,
    `Visitas: ${cp.landingViews}${cp.costPerVisit ? ` (${eur(cp.costPerVisit)}/visita)` : ''}`,
    `Pago iniciado: ${cp.checkouts}`,
    `Ventas: ${cp.orders} · Ingresos: ${eur(cp.revenue)}`,
    `ROAS: ${cp.roas == null ? '—' : round1(cp.roas) + 'x'} · CPA: ${cp.cpa == null ? '—' : eur(cp.cpa)} · Beneficio: ${eur(cp.profit)}`,
  ];
  for (const r of rows) msg += `• ${esc(r)}\n`;

  msg += errorsBlock(b);
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

// Exportado solo para poder testear el render sin enviar nada.
exports.buildMessage = buildMessage;

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
