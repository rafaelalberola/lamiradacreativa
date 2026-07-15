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
  'cash_balance',
  'monthly_fixed_costs',
  'other_ad_spend',
  'product_price',
  'target_roas',
  'target_cpl',
  'target_cac',
  'runway_alert_months',
];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // --- auth (cookie firmada) ---
  if (!verifyCookie(event.headers.cookie || event.headers.Cookie)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
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
