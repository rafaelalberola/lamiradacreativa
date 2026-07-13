// Crea (idempotente) la Resend Audience "La Mirada Creativa - Leads" y muestra su ID.
// Requiere una key FULL ACCESS de Resend (la restringida de envío NO sirve).
// Uso:  RESEND_FULL_KEY=re_xxx node scripts/setup-resend-audience.js
//
// Copia el AUDIENCE_ID que imprime en Netlify (RESEND_AUDIENCE_ID) y en .env.

const KEY = process.env.RESEND_FULL_KEY || process.env.RESEND_API_KEY;
const NAME = 'La Mirada Creativa - Leads';

if (!KEY) {
  console.error('Falta RESEND_FULL_KEY (key Full Access de Resend).');
  process.exit(1);
}

async function api(path, opts = {}) {
  const res = await fetch(`https://api.resend.com${path}`, {
    ...opts,
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

(async () => {
  // ¿Ya existe?
  const list = await api('/audiences');
  if (list.status === 401 || (list.json && list.json.name === 'restricted_api_key')) {
    console.error('La key es restringida (solo envío). Crea una Full Access en Resend → API Keys.');
    process.exit(1);
  }
  const existing = (list.json.data || []).find((a) => a.name === NAME);
  if (existing) {
    console.log('YA EXISTE → RESEND_AUDIENCE_ID:', existing.id);
    return;
  }
  const created = await api('/audiences', { method: 'POST', body: JSON.stringify({ name: NAME }) });
  if (created.status >= 400 || !created.json.id) {
    console.error('No se pudo crear la audience:', created.status, JSON.stringify(created.json));
    process.exit(1);
  }
  console.log('CREADA ✓ → RESEND_AUDIENCE_ID:', created.json.id);
})();
