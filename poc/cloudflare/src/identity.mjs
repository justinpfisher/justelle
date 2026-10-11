// Verify Firebase Auth ID tokens at the server, never trust client-supplied UIDs.
// JWKS endpoint documented for Firebase securetoken service account signatures.
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let cached = { keys: null, expires: 0 };

function decodePart(s) {
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) throw new Error('Invalid JWT encoding');
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4);
  const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  return bytes;
}
function jsonPart(s) { return JSON.parse(new TextDecoder().decode(decodePart(s))); }

export async function loadFirebaseKeys() {
  if (cached.keys && Date.now() < cached.expires) return cached.keys;
  const resp = await fetch(JWKS_URL, { headers: { accept: 'application/json' } });
  if (!resp.ok) throw new Error('Could not load Firebase signing keys');
  const data = await resp.json();
  if (!Array.isArray(data.keys) || !data.keys.length) throw new Error('No signing keys');
  // Short bounded cache; token validation fails closed if keys cannot be fetched after expiry.
  cached = { keys: data.keys, expires: Date.now() + 5 * 60_000 };
  return cached.keys;
}

export async function validateFirebaseJwt(token, projectId, keyLoader = loadFirebaseKeys) {
  if (!projectId || !token || token.length > 8192) throw new Error('Invalid authentication configuration');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const header = jsonPart(parts[0]);
  const payload = jsonPart(parts[1]);
  if (header.alg !== 'RS256' || header.typ && header.typ !== 'JWT' || typeof header.kid !== 'string') throw new Error('Invalid JWT header');
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}` ||
      typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128 ||
      typeof payload.exp !== 'number' || payload.exp <= now ||
      typeof payload.iat !== 'number' || payload.iat > now ||
      typeof payload.auth_time !== 'number' || payload.auth_time > now ||
      !Number.isFinite(payload.exp) || !Number.isFinite(payload.iat) || !Number.isFinite(payload.auth_time)) {
    throw new Error('Invalid JWT claims');
  }
  const jwks = await keyLoader();
  const key = jwks.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
  if (!key) throw new Error('Signing key not found');
  const imported = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', imported, decodePart(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error('Bad signature');
  return payload;
}

export async function authenticate(request, env) {
  if (!env.FIREBASE_PROJECT_ID || !env.ROOM_ID || !env.MEMBER_MAP_JSON) throw new Error('Misconfigured authentication');
  const bearer = /^Bearer ([-_a-zA-Z0-9.]+)$/.exec(request.headers.get('authorization') || '');
  if (!bearer) return null;
  try {
    const claims = await validateFirebaseJwt(bearer[1], env.FIREBASE_PROJECT_ID);
    const mapping = JSON.parse(env.MEMBER_MAP_JSON);
    const members = Object.keys(mapping);
    if (members.length !== 2 || new Set(Object.values(mapping)).size !== 2 ||
        !Object.values(mapping).every(v => typeof v === 'string' && /^person-[a-z0-9-]{1,48}$/.test(v))) throw new Error('Wrong member configuration');
    if (!members.includes(claims.sub) || claims.justelle_room !== env.ROOM_ID || claims.justelle_member !== true) return null;
    return { uid: claims.sub, personId: mapping[claims.sub], members };
  } catch { return null; }
}
