// Verificación de la sesión del backoffice (token firmado `mtk`).
// El token = base64url({exp}).hmac(payload, SUPABASE_SERVICE_ROLE_KEY).
// Sin el secreto de servidor no se puede forjar; aquí solo se valida.
// Se acepta por DOS vías equivalentes:
//   1) cookie `mtk` (HttpOnly, la emite metrics-login)
//   2) cabecera `Authorization: Bearer <token>` — el cliente guarda el token en
//      localStorage para recordar el login aunque el navegador no conserve la cookie.

const crypto = require('crypto');

function verifyToken(token) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !token) return false;

  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return !!exp && exp > Math.floor(Date.now() / 1000);
  } catch (e) {
    return false;
  }
}

function verifyCookie(cookieHeader) {
  if (!cookieHeader) return false;
  const m = String(cookieHeader).match(/(?:^|;\s*)mtk=([^;]+)/);
  return m ? verifyToken(m[1]) : false;
}

// Autoriza si vale la cookie O el token del header Authorization (Bearer).
function isAuthed(event) {
  const h = (event && event.headers) || {};
  if (verifyCookie(h.cookie || h.Cookie)) return true;
  const auth = h.authorization || h.Authorization || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? verifyToken(m[1]) : false;
}

module.exports = { verifyCookie, verifyToken, isAuthed };
