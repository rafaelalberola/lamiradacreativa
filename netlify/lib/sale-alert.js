// Aviso instantáneo de venta a Telegram.
//
// Lo llama stripe-webhook.js. Regla de oro: ESTO NUNCA PUEDE ROMPER NI FRENAR EL
// WEBHOOK. Si Stripe no recibe un 200 a tiempo reintenta el evento, y un reintento
// aquí significa reenviar el email de compra al cliente. Por eso:
//   1) notifySale() no lanza NUNCA (todo va envuelto en try/catch).
//   2) Todo tiene tope de tiempo. El aviso base (venta + pagador) sale de los datos
//      que ya vienen en el evento de Stripe: 0 llamadas externas, ~300 ms.
//   3) El enriquecido con el panel (computeMetrics: Stripe paginado + Meta + Supabase)
//      es OPORTUNISTA: si no llega en METRICS_BUDGET_MS, el aviso sale igual sin él.
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (+ las que ya usa metrics.js)

const { esc, sendMessage, sendPhoto } = require('./telegram');

// Presupuestos de tiempo. Suman un techo de ~6 s en el peor caso, sobre un webhook
// que ya gasta lo suyo en Auth0 + Resend. Ajustables por env sin tocar código.
const METRICS_BUDGET_MS = Number(process.env.SALE_ALERT_METRICS_MS) || 3500;
const DEDUPE_BUDGET_MS = 1500;
const DASHBOARD = 'https://lamiradacreativa.com/backoffice/';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtDay(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${parseInt(d, 10)} ${MESES[parseInt(m, 10) - 1]}`;
}

// Corta una promesa lenta y sigue con `fallback` en vez de esperar.
function withDeadline(promise, ms, fallback, label) {
  let timer;
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[sale-alert] ${label} superó ${ms} ms — sigo sin ello`);
      resolve(fallback);
    }, ms);
  });
  return Promise.race([Promise.resolve(promise).catch((e) => {
    console.warn(`[sale-alert] ${label} falló: ${e.message}`);
    return fallback;
  }), guard]).finally(() => clearTimeout(timer));
}

// ------------------------------------------------------------------ idempotencia
// Stripe reenvía el mismo evento si una entrega anterior falló (p. ej. Auth0 cayó y
// el webhook devolvió 500), así que el mismo session.id puede llegar dos veces.
//
// Memoria del contenedor: gratis, tapa el reintento inmediato en caliente.
// Supabase: tapa el reintento que cae en un contenedor frío (el caso real, minutos
// después). Reusamos la tabla `events` (ya existe, sin migración): metrics.js solo
// cuenta filas con event='pageview', así que estas son inertes para las métricas.
const seen = new Set();

function sb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = require('@supabase/supabase-js');
  return createClient(url, key);
}

async function alreadyNotified(sessionId) {
  if (seen.has(sessionId)) return true;
  const db = sb();
  if (!db) return false;
  const { data, error } = await db
    .from('events')
    .select('id')
    .eq('event', 'sale_alert')
    .eq('device_id', sessionId)
    .limit(1);
  if (error) throw new Error(error.message);
  return Array.isArray(data) && data.length > 0;
}

async function markNotified(sessionId, utmSource) {
  seen.add(sessionId);
  const db = sb();
  if (!db) return;
  await db.from('events').insert({
    event: 'sale_alert',
    path: '/stripe-webhook',
    device_id: sessionId, // el id de sesión de Stripe hace de clave de deduplicación
    utm_source: utmSource || null,
  });
}

// ------------------------------------------------------------------ datos del pagador
function readSession(session) {
  const md = session.metadata || {};
  const cd = session.customer_details || {};
  const utmSource = md.utm_source || null;
  const trafficSource = md.traffic_source || null;

  // "origen": utm_source si viene, si no traffic_source, si no directo.
  const bits = [];
  if (utmSource) bits.push(utmSource);
  else if (trafficSource) bits.push(trafficSource);
  if (md.utm_medium) bits.push(md.utm_medium);

  return {
    id: session.id,
    email: cd.email || session.customer_email || null,
    // El nombre solo llega si Stripe recogió billing details en el checkout.
    name: cd.name || null,
    amount: (session.amount_total || 0) / 100,
    currency: (session.currency || 'eur').toUpperCase(),
    method: (session.payment_method_types || [])[0] || null,
    source: bits.length ? bits.join(' · ') : 'directo',
    utmSource: utmSource || trafficSource || null,
    campaign: md.utm_campaign || null,
    content: md.utm_content || null,
  };
}

// ------------------------------------------------------------------ mensaje
// eur() de metrics.js siempre pinta '€'. El producto se vende en euros, pero si
// algún día entra otra divisa vale más enseñar '80 USD' que un '80 €' que miente.
function amountLabel(s, eur) {
  return s.currency === 'EUR' ? eur(s.amount) : `${s.amount} ${s.currency}`;
}

function buildMessage(s, cp, fmt) {
  const { eur, round1 } = fmt;
  let msg = `💰 *${esc(`NUEVA VENTA · ${amountLabel(s, eur)}`)}*\n\n`;

  msg += `*Cliente*\n`;
  msg += `• ${esc(s.name || 'sin nombre')}\n`;
  msg += `• ${esc(s.email || 'sin email')}\n`;
  if (s.method) msg += `• ${esc(`Pago: ${s.method}`)}\n`;

  msg += `\n*Origen*\n`;
  msg += `• ${esc(s.source)}\n`;
  if (s.campaign) msg += `• ${esc(`Campaña: ${s.campaign}`)}\n`;
  if (s.content) msg += `• ${esc(`Creativo: ${s.content}`)}\n`;

  if (cp) {
    msg += `\n*${esc(`Creativos actuales · desde ${fmtDay(cp.since)} · día ${cp.days}`)}*\n`;
    msg += `• ${esc(`Gasto: ${eur(cp.spend)} · Ingresos: ${eur(cp.revenue)}`)}\n`;
    const roas = cp.roas == null ? '—' : `${round1(cp.roas)}x`;
    const cpa = cp.cpa == null ? '—' : eur(cp.cpa);
    msg += `• ${esc(`ROAS: ${roas} · Ventas: ${cp.orders} · CPA: ${cpa}`)}\n`;
  }

  msg += `\n[Abrir dashboard](${DASHBOARD})`;
  return msg;
}

// `metricsOk` distingue dos cosas que NO son lo mismo y que no se pueden confundir:
// que no haya creativos activos, o que no nos haya dado tiempo a leer el panel.
function buildView(s, cp, fmt, metricsOk = true) {
  const { eur, round1 } = fmt;
  const when = new Date().toLocaleString('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  });

  const view = {
    amount: amountLabel(s, eur),
    name: s.name,
    email: s.email,
    source: s.source + (s.campaign ? ` · ${s.campaign}` : ''),
    when,
    panel: null,
    panelNote: null,
  };

  if (cp) {
    view.panel = {
      since: `CREATIVOS ACTUALES · DESDE ${fmtDay(cp.since).toUpperCase()} · DÍA ${cp.days}`,
      spend: eur(cp.spend),
      revenue: eur(cp.revenue),
      roas: cp.roas == null ? '—' : `${round1(cp.roas)}x`,
      orders: String(cp.orders),
      roasState: cp.roas == null ? 'warn' : cp.roas >= 1.5 ? 'ok' : cp.roas >= 1 ? 'warn' : 'bad',
    };
  } else {
    view.panelNote = metricsOk
      ? 'Sin creativos activos ahora mismo.'
      : 'Panel no leído a tiempo — ábrelo para verlo.';
  }
  return view;
}

// ------------------------------------------------------------------ público
/**
 * Avisa de una venta pagada. No lanza nunca.
 * @param {object} session checkout.session de Stripe
 * @returns {Promise<{sent:boolean, reason?:string, withImage?:boolean}>}
 */
async function notifySale(session) {
  try {
    // Solo ventas REALMENTE cobradas. Un checkout puede quedar 'complete' con
    // payment_status 'no_payment_required' (cupón al 100%) o 'unpaid': eso no es
    // una venta y no debe sonar como tal.
    if (!session || session.payment_status !== 'paid') {
      return { sent: false, reason: `payment_status=${session && session.payment_status}` };
    }
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      console.warn('[sale-alert] Telegram sin configurar, no aviso');
      return { sent: false, reason: 'telegram-no-configurado' };
    }

    const s = readSession(session);

    const dup = await withDeadline(alreadyNotified(s.id), DEDUPE_BUDGET_MS, false, 'dedupe');
    if (dup) {
      console.log(`[sale-alert] ${s.id} ya avisado, ignoro reenvío`);
      return { sent: false, reason: 'duplicado' };
    }

    // Panel: oportunista. computeMetrics pagina Stripe y llama a Meta; si tarda,
    // el aviso sale igual con los datos de la venta (que es lo que urge).
    const { computeMetrics, eur, round1 } = require('./metrics');
    const bundle = await withDeadline(
      computeMetrics({ rangeDays: 7 }),
      METRICS_BUDGET_MS,
      null,
      'computeMetrics'
    );
    const cp = (bundle && bundle.campaignPeriod) || null;
    const fmt = { eur, round1 };

    const text = buildMessage(s, cp, fmt);

    // Imagen primero; si algo del render falla (binario nativo, fuente…), texto.
    let withImage = false;
    try {
      const png = await renderCard(buildView(s, cp, fmt, !!bundle));
      await sendPhoto(png, text);
      withImage = true;
    } catch (imgErr) {
      console.warn(`[sale-alert] sin imagen (${imgErr.message}) — mando texto`);
      await sendMessage(text);
    }

    // Se marca DESPUÉS de enviar: si el envío falla, un reintento de Stripe puede
    // volver a intentarlo. Preferimos un duplicado raro a perder el aviso.
    try {
      await markNotified(s.id, s.utmSource);
    } catch (e) {
      console.warn(`[sale-alert] no pude marcar ${s.id}: ${e.message}`);
    }

    console.log(`[sale-alert] enviado ${s.id} (imagen: ${withImage})`);
    return { sent: true, withImage };
  } catch (e) {
    // Último cortafuegos: pase lo que pase, el webhook sigue su camino.
    console.error('[sale-alert] fallo no fatal:', e && e.message);
    return { sent: false, reason: e && e.message };
  }
}

// Aislado para poder testear el render sin tocar Telegram.
async function renderCard(view) {
  const { renderSaleCard } = require('./sale-card');
  return renderSaleCard(view);
}

module.exports = { notifySale, buildMessage, buildView, readSession };
