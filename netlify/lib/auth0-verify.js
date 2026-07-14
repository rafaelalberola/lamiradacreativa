// Auth0 ID-token verification for the metrics backoffice.
// Verifies the RS256 signature against Auth0's JWKS (not just a base64 decode),
// then checks issuer, audience, expiry and an ADMIN email allowlist.
//
// Env:
//   AUTH0_DOMAIN      e.g. dev-xxxx.eu.auth0.com
//   AUTH0_CLIENT_ID   SPA client id (aud of the ID token). Falls back to the
//                     app client id hardcoded across the site.
//   ADMIN_EMAILS      comma-separated allowlist. Falls back to the owner.

const crypto = require('crypto');

const DEFAULT_CLIENT_ID = 'wTRFr8TqbqdxBkWCJeQ052zvGGemnwsZ';
const DEFAULT_ADMINS = 'helloimrafa@gmail.com';

let jwksCache = { keys: null, at: 0 };

async function getJwks(domain) {
  const now = Date.now();
  if (jwksCache.keys && now - jwksCache.at < 60 * 60 * 1000) {
    return jwksCache.keys;
  }
  const res = await fetch(`https://${domain}/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const { keys } = await res.json();
  jwksCache = { keys, at: now };
  return keys;
}

function adminSet() {
  return new Set(
    (process.env.ADMIN_EMAILS || DEFAULT_ADMINS)
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

// Returns { sub, email } for a valid admin token, otherwise throws with a reason.
async function verifyAdmin(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('missing bearer token');
  }
  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed jwt');

  const [h, p, s] = parts;
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());

  if (header.alg !== 'RS256') throw new Error(`unexpected alg ${header.alg}`);

  const domain = process.env.AUTH0_DOMAIN;
  if (!domain) throw new Error('AUTH0_DOMAIN not set');

  // --- signature ---
  const keys = await getJwks(domain);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('signing key not found');
  const pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${h}.${p}`),
    pubKey,
    Buffer.from(s, 'base64url')
  );
  if (!ok) throw new Error('bad signature');

  // --- claims ---
  const expectedIss = `https://${domain}/`;
  if (payload.iss !== expectedIss) throw new Error('issuer mismatch');

  const clientId = process.env.AUTH0_CLIENT_ID || DEFAULT_CLIENT_ID;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(clientId)) throw new Error('audience mismatch');

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) throw new Error('token expired');

  const email = (payload.email || '').toLowerCase();
  if (!email) throw new Error('no email claim');
  if (!adminSet().has(email)) throw new Error('not an admin');

  return { sub: payload.sub, email };
}

module.exports = { verifyAdmin };
