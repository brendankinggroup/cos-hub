export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BATCHDATA_KEY = process.env.BATCHDATA_KEY;
  if (!BATCHDATA_KEY) {
    return res.status(500).json({ error: 'BATCHDATA_KEY not configured' });
  }

  const ALLOWED_ENDPOINTS = {
    'lookup': 'https://api.batchdata.com/api/v1/property/lookup/all-attributes',
    'search': 'https://api.batchdata.com/api/v1/property/search'
  };

  const endpoint = ALLOWED_ENDPOINTS[req.query.endpoint || 'lookup'];
  if (!endpoint) {
    return res.status(400).json({ error: 'Invalid endpoint' });
  }

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + BATCHDATA_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    const json = await resp.json();
    res.status(resp.status).json(json);
  } catch (err) {
    res.status(500).json({ error: 'BatchData request failed', message: err.message });
  }
}
