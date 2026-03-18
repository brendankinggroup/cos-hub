export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const BATCHDATA_KEY = process.env.BATCHDATA_KEY || 'FUYAMVRI5mCePugUkFvKyM7Nq2eq32gGDcJDudxY';

  try {
    const resp = await fetch('https://api.batchdata.com/api/v1/property/lookup/all-attributes', {
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
