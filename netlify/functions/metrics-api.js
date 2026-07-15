// Metrics backoffice API.
// GET  ?range=30  -> full metrics bundle
// POST { action:'save-config', config:{...} } -> update runway/targets
//
// Auth: cookie de sesión firmada (mtk), emitida por metrics-login.

const { createClient } = require('@supabase/supabase-js');
const { verifyCookie } = require('../lib/metrics-auth');
const { computeMetrics } = require('../lib/metrics');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
};

const CONFIG_FIELDS = [
  'monthly_ad_budget',
  'other_ad_spend',
  'product_price',
  'target_roas',
  'target_cpl',
  'target_cac',
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // --- auth (cookie firmada) ---
  if (!verifyCookie(event.headers.cookie || event.headers.Cookie)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // --- diagnóstico de datos (auditoría, solo admin) ---
  if (event.queryStringParameters?.debug === 'stripe') {
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const all = await stripe.checkout.sessions.list({ limit: 100 }).autoPagingToArray({ limit: 8000 });
      const completed = await stripe.checkout.sessions.list({ status: 'complete', limit: 100 }).autoPagingToArray({ limit: 8000 });
      const byPayStatus = {};
      let paidCount = 0, paidRevenue = 0, lastPaid = 0, firstPaid = 0;
      const byMonth = {};
      for (const s of completed) {
        byPayStatus[s.payment_status] = (byPayStatus[s.payment_status] || 0) + 1;
        if (s.payment_status === 'paid') {
          paidCount++; paidRevenue += (s.amount_total || 0) / 100;
          if (s.created > lastPaid) lastPaid = s.created;
          if (!firstPaid || s.created < firstPaid) firstPaid = s.created;
          const mk = new Date(s.created * 1000).toISOString().slice(0, 7);
          byMonth[mk] = byMonth[mk] || { ventas: 0, ingresos: 0 };
          byMonth[mk].ventas += 1;
          byMonth[mk].ingresos += (s.amount_total || 0) / 100;
        }
      }
      return { statusCode: 200, headers, body: JSON.stringify({
        totalSessionsAllStatuses: all.length,
        totalCompleted: completed.length,
        byPaymentStatus: byPayStatus,
        paidCount, paidRevenue: Math.round(paidRevenue * 100) / 100,
        aov: paidCount ? Math.round(paidRevenue / paidCount * 100) / 100 : null,
        firstPaidDate: firstPaid ? new Date(firstPaid * 1000).toISOString().slice(0, 10) : null,
        lastPaidDate: lastPaid ? new Date(lastPaid * 1000).toISOString().slice(0, 10) : null,
        ingresosPorMes: byMonth,
      }, null, 2) };
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'debug', detail: e.message }) };
    }
  }

  try {
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      if (body.action !== 'save-config') {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
      }
      const patch = {};
      for (const f of CONFIG_FIELDS) {
        if (body.config && body.config[f] !== undefined && body.config[f] !== null && body.config[f] !== '') {
          const n = Number(body.config[f]);
          if (!Number.isNaN(n)) patch[f] = n;
        }
      }
      patch.id = 1;
      patch.updated_at = new Date().toISOString();

      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const { error } = await sb.from('metrics_config').upsert(patch, { onConflict: 'id' });
      if (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'DB error', detail: error.message }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // GET -> bundle
    const rangeDays = Math.min(365, Math.max(1, parseInt(event.queryStringParameters?.range, 10) || 30));
    const bundle = await computeMetrics({ rangeDays });
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ...bundle }) };
  } catch (e) {
    console.error('[metrics-api] error', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error', detail: e.message }) };
  }
};
