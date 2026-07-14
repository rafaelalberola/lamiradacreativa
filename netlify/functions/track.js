// Lightweight first-party analytics beacon.
// POST { event, path, device_id, utm_*, referrer } -> events table in Supabase.
// No PII: device_id is a random id in the visitor's localStorage.
// This is our own funnel data — replaces the Amplitude/Mixpanel dependency.

const { createClient } = require('@supabase/supabase-js');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_EVENTS = new Set(['pageview', 'lead', 'checkout_start', 'purchase_view']);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{"error":"method"}' };

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 200, headers, body: '{"ok":false}' }; // fail silently, never break the page
  }

  try {
    const b = JSON.parse(event.body || '{}');
    const name = ALLOWED_EVENTS.has(b.event) ? b.event : 'pageview';

    const clip = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : null);
    const row = {
      event: name,
      path: clip(b.path, 500),
      device_id: clip(b.device_id, 80),
      utm_source: clip(b.utm_source, 120),
      utm_medium: clip(b.utm_medium, 120),
      utm_campaign: clip(b.utm_campaign, 120),
      utm_content: clip(b.utm_content, 120),
      utm_term: clip(b.utm_term, 120),
      referrer: clip(b.referrer, 500),
    };

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    await sb.from('events').insert(row);
    return { statusCode: 200, headers, body: '{"ok":true}' };
  } catch (e) {
    return { statusCode: 200, headers, body: '{"ok":false}' };
  }
};
