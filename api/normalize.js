// Vercel serverless route — Smart Paste for the Offer Desk queue.
// Takes arbitrary pasted text (spreadsheet rows, jumbled columns, freeform
// notes) and returns clean, canonical queue rows. ANTHROPIC_API_KEY required.
import Anthropic from '@anthropic-ai/sdk';
import { requireRole, unauthorized } from './_auth.js';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const Rows = z.object({
  rows: z.array(z.object({
    address: z.string(),  // FULL address: street, city, state zip — never street-only
    agent: z.string(),    // agent first name, '' when unknown
    list_price: z.number(),
    dom: z.number(),
    arv: z.number(),
    sqft: z.number(),
    tier: z.number(),     // rehab tier 1-4, default 2 when unknown
  })),
});

const SYSTEM = `You normalize pasted real-estate data for a Las Vegas wholesale pricing
queue. The input is arbitrary text: spreadsheet rows (any column order, tabs or commas),
MLS snippets, or freeform notes — one or many properties.

Extract every property you can find. Rules:
- address: the COMPLETE address (street, city, state, zip) when derivable; assume the
  Las Vegas valley when city/state are absent but a 89xxx zip is present. Never invent
  street names.
- agent: the listing agent's FIRST name only ('' if none appears).
- list_price / arv / sqft / dom: parse numbers from any format ("$685.5K" → 685500,
  "2,175 sf" → 2175). Distinguish list price from ARV by context/labels; when only one
  price appears, treat it as list_price and set arv 0. Use 0 for anything truly absent.
- tier: rehab tier 1 cosmetic / 2 standard / 3 heavy / 4 gut from condition language;
  default 2.
- Never fabricate values. Skip lines that contain no property data.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireRole(req, 'admin')) return unauthorized(res);
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Smart Paste not configured — add ANTHROPIC_API_KEY in Vercel project settings.' });
  }
  const text = (req.body || {}).text;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Body must include non-empty text.' });
  }
  if (text.length > 100000) {
    return res.status(400).json({ error: 'Paste too large — use 📁 Import File for big files.' });
  }
  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: 'user', content: 'Normalize this pasted text into queue rows:\n\n' + text }],
      output_config: { format: zodOutputFormat(Rows) },
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      return res.status(502).json({ error: 'Could not normalize that paste.' });
    }
    return res.status(200).json({ rows: response.parsed_output.rows });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is invalid — check Vercel settings.' });
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'Rate limited — wait a minute and retry.' });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ error: `Claude API error ${e.status}: ${e.message}` });
    return res.status(500).json({ error: e.message });
  }
}
