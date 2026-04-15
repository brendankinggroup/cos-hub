// Vercel serverless API route for Buyers List (Disposition CRM) — COS Hub
const AT_KEY = process.env.AIRTABLE_API_KEY;
const AT_BASE = 'app467uZVWGxnatwK';
const AT_TABLE = 'tbldRZHx0V4SEtP6G';
const AT_URL = `https://api.airtable.com/v0/${AT_BASE}/${AT_TABLE}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (!AT_KEY) {
    return res.status(500).json({ error: 'AIRTABLE_API_KEY not configured' });
  }

  const atHeaders = {
    'Authorization': `Bearer ${AT_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    let url = AT_URL;

    if (req.method === 'GET') {
      const qs = new URLSearchParams(req.query || {}).toString();
      if (qs) url += '?' + qs;
      const r = await fetch(url, { headers: atHeaders });
      const json = await r.json();
      return res.status(r.status).json(json);
    }

    if (req.method === 'POST') {
      const r = await fetch(url, {
        method: 'POST',
        headers: atHeaders,
        body: JSON.stringify(req.body),
      });
      const json = await r.json();
      return res.status(r.status).json(json);
    }

    if (req.method === 'PATCH') {
      const r = await fetch(url, {
        method: 'PATCH',
        headers: atHeaders,
        body: JSON.stringify(req.body),
      });
      const json = await r.json();
      return res.status(r.status).json(json);
    }

    if (req.method === 'DELETE') {
      if (req.query.id) {
        url += '/' + req.query.id;
        const r = await fetch(url, { method: 'DELETE', headers: atHeaders });
        const json = await r.json();
        return res.status(r.status).json(json);
      } else {
        const qs = new URLSearchParams(req.query || {}).toString();
        if (qs) url += '?' + qs;
        const r = await fetch(url, { method: 'DELETE', headers: atHeaders });
        const json = await r.json();
        return res.status(r.status).json(json);
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
