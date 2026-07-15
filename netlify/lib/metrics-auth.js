// Verificación de la cookie de sesión del backoffice (mtk).
// La cookie = base64url({exp}).hmac(payload, SUPABASE_SERVICE_ROLE_KEY).
// Sin el secreto de servidor no se puede forjar; aquí solo se valida.

const crypto = require('crypto');

function verifyCookie(cookieHeader) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !cookieHeader) return false;

  const m = String(cookieHeader).match(/(?:^|;\s*)mtk=([^;]+)/);
  if (!m) return false;

  const token = m[1];
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

module.exports = { verifyCookie };
