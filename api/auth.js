// Vercel serverless route — hub sign-in. Verifies the password server-side
// (HUB_PASSWORD env var) and issues a signed, role-aware session token.
// Roles are baked into the token so per-user accounts can be added later
// without changing any endpoint.
import crypto from 'crypto';
import { signToken } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.HUB_PASSWORD) {
    return res.status(500).json({ error: 'HUB_PASSWORD not configured — add it in Vercel project settings.' });
  }
  const pw = (req.body || {}).password;
  if (!pw || typeof pw !== 'string') {
    return res.status(400).json({ error: 'Password required' });
  }
  const a = crypto.createHash('sha256').update(pw).digest();
  const b = crypto.createHash('sha256').update(process.env.HUB_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return res.status(401).json({ error: 'Incorrect password' });
  }
  return res.status(200).json({ token: signToken('admin'), role: 'admin' });
}
