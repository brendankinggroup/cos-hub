// Shared auth helper for hub API routes (underscore prefix = not exposed as a route).
// Token format: role.expiryEpoch.signature — HMAC-signed with a secret derived from
// HUB_PASSWORD. Role-aware from day one so real user accounts can plug in later
// without touching the endpoints.
import crypto from 'crypto';

const secret = () =>
  crypto.createHash('sha256').update('cos-hub-v1:' + (process.env.HUB_PASSWORD || '')).digest();

export function signToken(role, ttlDays = 7) {
  const exp = Date.now() + ttlDays * 86400000;
  const payload = `${role}.${exp}`;
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [role, expStr, sig] = parts;
  const expected = crypto.createHmac('sha256', secret()).update(`${role}.${expStr}`).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (+expStr < Date.now()) return null;
  return { role };
}

// Returns the session ({role}) or null. On null, the caller should 401.
export function requireRole(req, role = 'admin') {
  if (!process.env.HUB_PASSWORD) return null; // fail closed until configured
  const session = verifyToken(req.headers['x-hub-token']);
  if (!session) return null;
  if (role === 'admin' && session.role !== 'admin') return null;
  return session;
}

export function unauthorized(res) {
  return res.status(401).json({ error: 'Not signed in — log into the hub again.' });
}
