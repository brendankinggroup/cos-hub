// Simple password auth — checks against HUB_PASSWORD env var
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  const correct = process.env.HUB_PASSWORD;

  if (!correct) return res.status(500).json({ error: 'HUB_PASSWORD not configured' });
  if (!password) return res.status(400).json({ ok: false, error: 'No password provided' });

  if (password === correct) {
    // Generate a simple session token (hash of password + date)
    const token = Buffer.from(correct + ':' + new Date().toISOString().slice(0, 10)).toString('base64');
    return res.status(200).json({ ok: true, token });
  }

  return res.status(401).json({ ok: false, error: 'Incorrect password' });
}
