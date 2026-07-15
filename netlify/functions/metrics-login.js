// Login del backoffice de métricas — contraseña + cookie firmada.
// Enfoque self-contained: sin Auth0, sin sesión compartida, sin rebotes.
// - La contraseña se verifica por HMAC(SUPABASE_SERVICE_ROLE_KEY, password): como
//   la key es secreta (env, NO está en el repo), el valor esperado no permite
//   crackear la contraseña aunque el repositorio sea público.
// - La cookie de sesión se firma con el mismo secreto: sin él no se puede falsificar.

const crypto = require('crypto');

// HMAC(SUPABASE_SERVICE_ROLE_KEY, password). Cambiar la contraseña = recalcular esto.
const EXPECTED = 'e3318aad7a3b5254143dabcad202cd5af21926513a099825a32ccaf9bb670c73';

const COOKIE = 'mtk';
const TTL = 30 * 24 * 3600; // 30 días

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}
function safeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function cookieString(value, maxAge) {
  return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{"error":"method"}' };

  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return { statusCode: 500, headers, body: '{"error":"server_misconfig"}' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}

  // Logout: caduca la cookie.
  if (body.action === 'logout') {
    return { statusCode: 200, headers: { ...headers, 'Set-Cookie': cookieString('', 0) }, body: '{"ok":true}' };
  }

  const password = String(body.password || '');
  if (!safeEq(hmac(secret, password), EXPECTED)) {
    return { statusCode: 401, headers, body: '{"error":"bad_password"}' };
  }

  // Emite token firmado: base64url({exp}).hmac(payload, secret)
  const exp = Math.floor(Date.now() / 1000) + TTL;
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  const token = `${payload}.${hmac(secret, payload)}`;

  return {
    statusCode: 200,
    headers: { ...headers, 'Set-Cookie': cookieString(token, TTL) },
    body: '{"ok":true}',
  };
};
