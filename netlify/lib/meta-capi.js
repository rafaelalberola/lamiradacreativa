// Meta Conversions API — envía la compra a Meta SERVER-TO-SERVER.
//
// Por qué existe: el píxel de cliente (fbq 'Purchase' en /gracias) lo bloquea
// cualquier ad-blocker y no dispara si el comprador no carga la página de gracias.
// Resultado: Meta veía el InitiateCheckout pero perdía la confirmación → atribución
// por creativo falseada. CAPI no lo bloquea nada: la venta llega a Meta siempre.
//
// Dedup con el píxel de cliente vía event_id === session.id (Meta cuenta 1 sola vez
// si el píxel también dispara con el mismo eventID).
//
// Env: META_ACCESS_TOKEN (el mismo permanente que lee métricas; verificado que puede
// escribir en el píxel), META_PIXEL_ID (opcional), META_CAPI_TEST_CODE (opcional →
// manda a Test Events y NO cuenta en producción; úsalo solo para probar).

const crypto = require('crypto');

const GRAPH = 'https://graph.facebook.com/v21.0';
const PIXEL = () => process.env.META_PIXEL_ID || '1795091771208314';

// Meta exige los datos personales hasheados en SHA-256, normalizados (trim + minúsculas).
const sha256 = (v) => crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');

/**
 * Envía un evento Purchase a la Conversions API. Nunca lanza: devuelve un objeto
 * de resultado. El caller debe llamarlo sin bloquear la respuesta 200 a Stripe.
 * @param {object} session  la checkout.session de Stripe
 * @param {object} [opts]   { email } por si el caller ya lo tiene resuelto
 */
async function sendPurchaseCapi(session, opts = {}) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) { console.warn('[CAPI] sin META_ACCESS_TOKEN — se omite'); return { ok: false, skipped: true }; }
  if (!session) return { ok: false, skipped: true };

  try {
    const md = session.metadata || {};
    const email = opts.email || session.customer_details?.email || session.customer_email || md.email || null;
    const value = (session.amount_total || 0) / 100;
    const currency = (session.currency || 'eur').toUpperCase();

    // Datos de emparejamiento (cuantos más, mejor atribuye Meta). El email es el
    // más fuerte; fbc reconstruye el clic desde el fbclid que guardamos en checkout.
    const user_data = {};
    if (email) user_data.em = [sha256(email)];
    if (md.fbc) user_data.fbc = md.fbc;
    else if (md.fbclid) {
      const ts = (session.created ? session.created * 1000 : Date.now());
      user_data.fbc = `fb.1.${ts}.${md.fbclid}`;
    }
    if (md.fbp) user_data.fbp = md.fbp;
    if (md.client_ip) user_data.client_ip_address = md.client_ip;
    if (md.client_ua) user_data.client_user_agent = md.client_ua;

    const event = {
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000), // momento del pago (webhook)
      action_source: 'website',
      event_id: session.id,                       // === eventID del píxel → dedup
      event_source_url: 'https://lamiradacreativa.com/gracias/',
      user_data,
      custom_data: {
        currency,
        value,
        content_type: 'product',
        content_ids: ['la_mirada_creativa'],
      },
    };

    const body = { data: [event] };
    if (process.env.META_CAPI_TEST_CODE) body.test_event_code = process.env.META_CAPI_TEST_CODE;

    const res = await fetch(`${GRAPH}/${PIXEL()}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.error) {
      console.error('[CAPI] error de Meta:', json.error.message);
      return { ok: false, error: json.error.message };
    }
    console.log('[CAPI] Purchase enviado a Meta · events_received=', json.events_received, '· matched keys:', Object.keys(user_data).join(','));
    return { ok: true, received: json.events_received };
  } catch (e) {
    console.error('[CAPI] excepción (no bloqueante):', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendPurchaseCapi, sha256 };
