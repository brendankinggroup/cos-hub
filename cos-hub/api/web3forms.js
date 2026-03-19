export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const WEB3FORMS_KEY = process.env.WEB3FORMS_KEY;
  if (!WEB3FORMS_KEY) {
    return res.status(500).json({ error: 'WEB3FORMS_KEY not configured' });
  }

  try {
    const body = req.body;
    body.access_key = WEB3FORMS_KEY;

    const resp = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const json = await resp.json();
    res.status(resp.status).json(json);
  } catch (err) {
    res.status(500).json({ error: 'Web3Forms request failed', message: err.message });
  }
}
