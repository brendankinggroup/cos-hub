// Vercel serverless route — COS Copilot: hub-wide, read-only AI analyst.
// Pulls the FULL business state (deals, buyers, recent leads) from Airtable
// server-side so the model is "all-knowing" regardless of what the browser
// has loaded, then answers the question grounded in that data.
import Anthropic from '@anthropic-ai/sdk';

const AT_KEY = process.env.AIRTABLE_API_KEY;
const AT_BASE = 'app467uZVWGxnatwK';
const T_DEALS = 'tblizewxGfQJNuMZr';
const T_BUYERS = 'tbldRZHx0V4SEtP6G';
const T_LEADS = 'tblbWdHiLX24xBbIh';

async function fetchAll(table, params = '') {
  const out = [];
  let offset = '';
  do {
    const r = await fetch(
      `https://api.airtable.com/v0/${AT_BASE}/${table}?${params}${offset ? '&offset=' + encodeURIComponent(offset) : ''}`,
      { headers: { Authorization: `Bearer ${AT_KEY}` } },
    );
    const json = await r.json();
    if (json.error) throw new Error(`Airtable ${table}: ${json.error.message || json.error.type}`);
    out.push(...(json.records || []));
    offset = json.offset || '';
  } while (offset);
  return out;
}

const trim = (s, n) => (s ? String(s).slice(0, n) : '');

function compactDeal(r) {
  const f = r.fields || {};
  return {
    address: f['Address'] || '', pipeline: f['Pipeline'] || 'New',
    contactedOn: f['Contacted On'] || '', mls: f['MLS #'] || '',
    seller: f['Seller'] || '', dealType: f['Deal Type'] || '',
    arv: f['ARV'] || 0, repairs: f['Repairs'] || 0, mao: f['MAO'] || 0,
    fee: f['Fee'] || 0, priceOffered: f['Price Offered'] || 0,
    dispo: f['Dispo'] || 0, profit: f['Profit'] || 0,
    roiPct: Math.round((f['ROI'] || 0) * 1000) / 10, score: f['Deal Score'] || 0,
    sqft: f['SqFt'] || 0, offerPct: f['Offer %'] || 0,
    beds: f['Beds'] || 0, baths: f['Baths'] || 0,
    distress: f['Distress'] || '', neighborhood: f['Neighborhood'] || '',
    assignedBuyer: f['Assigned Buyer'] || '', savedAt: f['Saved At'] || '',
    notes: trim(f['Notes'], 300),
  };
}

function compactBuyer(r) {
  const f = r.fields || {};
  const sel = (v) => (v && typeof v === 'object' && v.name ? v.name : v || '');
  return {
    name: f['Name'] || '', company: f['Company'] || '',
    types: (f['Types'] || []).map(sel), tags: (f['Tags'] || []).map(sel),
    status: sel(f['Status']) || 'Active', buyBox: trim(f['Buy Box'], 300),
    dealsClosed: f['Deals Closed'] || 0, lastContact: f['Last Contact'] || '',
  };
}

function compactLead(r) {
  const f = r.fields || {};
  return {
    address: f['Address'] || '', city: f['City'] || '', zip: f['Zip'] || '',
    status: (f['Status'] && f['Status'].name) || f['Status'] || '',
    askingPrice: f['Asking Price'] || '', timeline: f['Timeline'] || '',
    reason: trim(f['Reason'], 120), submittedAt: f['Submitted At'] || '',
  };
}

const PERSONA = `You are the COS Copilot — the all-knowing, READ-ONLY analyst inside the
COS Hub, the wholesale operations tool for Cash Offer Specialist (Brendan King,
licensed, Las Vegas). You are given the complete current business state as JSON:
every saved deal, every buyer in the disposition CRM, and recent inbound seller leads.

THE MACHINE STANDARDS (use these when analyzing or recomputing anything):
- Offer formula: MAO = 82% × ARV − repairs − banded fee. High-end 78% applies over
  $750K ARV, condos, and gut jobs.
- Fee bands: <$400K → $12K · $400–650K → $15K · $650–900K → $25K · >$900K → $30K.
- Rehab tiers ($/sqft): T1 cosmetic $15 · T2 standard $30 · T3 heavy $45 · T4 gut $60.
- BAC: 3% buyer's-broker compensation asked of the seller in the RPA on MLS deals;
  total revenue = fee + BAC. It can be conceded on counters before moving price.
- EMD $2,500 (under $500K) / $5,000; 7-day DD; as-is; 14–21 day COE.
- Buyer economics: dispo = contract + fee; +1% purchase costs; +6.5% of ARV selling
  costs; profit = ARV − all-in. Healthy flip ROI ≥ 12%.
- Pipeline (in order): New → Analyzing → Request Approval → Offer Approved →
  Offer Made → Under Contract → Assigned → Closed, plus Dead. New = untouched
  intake; Analyzing = actively being worked; deals should not sit in Offer Made
  silently for weeks.
- ARV discipline: modeled/estimated ARVs are triage-grade; recommend pulling 90-day
  renovated solds before anything goes in writing.

HARD RULES:
- READ-ONLY: you cannot change any data. Never claim to have updated, moved, or
  saved anything. When action is needed, tell Brendan exactly what to click.
- Ground every claim in the provided JSON; cite deals by address. If the data can't
  answer something, say so plainly rather than inventing numbers.
- Be a sharp operator, not a cheerleader: lead with the answer, keep it tight,
  quantify ("3 deals, $74K combined potential fees"), and end with the single next
  action that matters most when one exists.
- Dates: "today" is in the request. Flag staleness (e.g. Offer Made deals with no
  contact in 14+ days).`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Copilot not configured — add ANTHROPIC_API_KEY in Vercel project settings.' });
  }
  if (!AT_KEY) {
    return res.status(500).json({ error: 'AIRTABLE_API_KEY not configured' });
  }

  const { question, history, focus } = req.body || {};
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Body must include a question string.' });
  }

  try {
    const [deals, buyers, leads] = await Promise.all([
      fetchAll(T_DEALS),
      fetchAll(T_BUYERS),
      fetchAll(T_LEADS, 'maxRecords=30'),
    ]);

    const dataBlock =
      `CURRENT BUSINESS STATE\n\nSAVED DEALS (${deals.length}):\n` +
      JSON.stringify(deals.map(compactDeal)) +
      `\n\nBUYERS CRM (${buyers.length}):\n` +
      JSON.stringify(buyers.map(compactBuyer)) +
      `\n\nRECENT INBOUND LEADS (sample of ${leads.length}):\n` +
      JSON.stringify(leads.map(compactLead));

    const cleanHistory = (Array.isArray(history) ? history : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content }));

    let userText = `Today is ${new Date().toISOString().slice(0, 10)}.\n\nQuestion: ${question}`;
    if (focus) {
      userText += `\n\nFOCUS CONTEXT (what Brendan is looking at right now):\n${JSON.stringify(focus).slice(0, 20000)}`;
    }

    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4000,
      system: [
        { type: 'text', text: PERSONA },
        { type: 'text', text: dataBlock, cache_control: { type: 'ephemeral' } },
      ],
      messages: [...cleanHistory, { role: 'user', content: userText }],
    });

    if (response.stop_reason === 'refusal') {
      return res.status(502).json({ error: 'The model declined this request.' });
    }
    const answer = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    return res.status(200).json({
      answer,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens || 0,
      },
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY is invalid — check Vercel settings.' });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Rate limited — wait a minute and ask again.' });
    }
    if (e instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `Claude API error ${e.status}: ${e.message}` });
    }
    return res.status(500).json({ error: e.message });
  }
}
