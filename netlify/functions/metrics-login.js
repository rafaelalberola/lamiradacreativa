// Login del backoffice de métricas — contraseña + cookie firmada.
// Enfoque self-contained: sin Auth0, sin sesión compartida, sin rebotes.
// - La contraseña se compara por hash sha256 (con sal estática).
// - La cookie de sesión se firma con HMAC usando SUPABASE_SERVICE_ROLE_KEY,
//   que ya está en el env de las functions y NUNCA se expone al cliente.
//   Así, sin ese secreto de servidor, una cookie no se puede falsificar.

const crypto = require('crypto');

const SALT = 'lmc::';
// sha256(SALT + password). Cambiar la contraseña = recalcular este hash.
const PASS_HASH = 'ce2696905fd0afd2be0c63a7024201c20cff98eb60a4cb416c6ef6dd73cd940c';

const COOKIE = 'mtk';
const TTL = 30 * 24 * 3600; // 30 días

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}
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
  if (!safeEq(sha256(SALT + password), PASS_HASH)) {
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
