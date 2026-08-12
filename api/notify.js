// Vercel serverless route — forwards notification emails to Web3Forms.
// Keeps the access key server-side (WEB3FORMS_KEY env var); the recipient
// is fixed here so the endpoint can't be used to email arbitrary addresses.
const KEY = process.env.WEB3FORMS_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!KEY) {
    return res.status(500).json({ success: false, error: 'WEB3FORMS_KEY not configured' });
  }

  try {
    const payload = { ...(req.body || {}) };
    payload.access_key = KEY;
    payload.to = 'info@cashofferspecialist.com';
    const r = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await r.json();
    return res.status(r.status).json(json);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
