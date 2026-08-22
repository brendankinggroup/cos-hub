// Vercel serverless route — AI deal screener for the Offer Desk.
// Sends a batch of raw MLS export rows to Claude and returns a tiered,
// structured hit list. Requires the ANTHROPIC_API_KEY env var.
import Anthropic from '@anthropic-ai/sdk';
import { requireRole, unauthorized } from './_auth.js';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const MAX_ROWS = 60;

const ScreenResult = z.object({
  market_note: z.string(),
  properties: z.array(z.object({
    address: z.string(), // FULL address: street, city, state zip
    zip: z.string(),
    list_price: z.number(),
    dom: z.number(),
    sqft: z.number(),
    tier: z.number(),        // 1 = chase now, 2 = watch/conditional, 3 = pass
    arv_estimate: z.number(), // modeled ARV in dollars — triage-grade, 0 when unsupported
    flags: z.array(z.string()),
    why: z.string(),
    play: z.string(),
    outreach_angle: z.string(),
    rehab_tier_guess: z.number(), // 1 cosmetic · 2 standard · 3 heavy · 4 gut
    agent: z.object({
      name: z.string(),
      phone: z.string(),
      email: z.string(),
    }),
    arv_note: z.string(),
  })),
});

const SYSTEM = `You are the acquisitions screener for Cash Offer Specialist, a licensed
Las Vegas wholesale operation run by Brendan King. You receive raw MLS export rows
(any column layout — read whatever fields are present, especially BOTH "Public Remarks"
and "Agent to Agent Remarks"). Your job: find homes with obvious signs of distress
and/or statistics that make them ideal to wholesale or flip, and pass over everything else.

The buyer profile: cash, as-is, 7-day due diligence, no financing/appraisal contingency,
close in 14–21 days, typically offers 78–82% of ARV minus rehab minus a $12K–$30K fee —
so a workable listing is one where the seller has a structural reason to accept far below
retail, not merely a stale listing.

TIER DEFINITIONS
- Tier 1 — chase now: a structural reason this seller cannot or will not close with a
  normal financed retail buyer.
- Tier 2 — watch/conditional: real motivation signals but no structural lock-out yet;
  or needs one fact verified before it graduates to Tier 1.
- Tier 3 — pass: retail listing behaving normally. Include it in the output with tier 3,
  empty flags, and one short "why" so nothing silently disappears.

WHAT TO HUNT FOR (from the operator's proven playbook)
- Short sales / notice language — the lender sets the price, not the seller's equity;
  a genuine 70–80% number can actually get approved. Ask what the bank already rejected.
- Financing-killers: appraisal-defeating discrepancies (MLS sqft vs remarks sqft,
  unpermitted additions/conversions), leased solar with a balance the buyer must assume,
  homes that "won't qualify" for FHA/conventional, seller requiring prequal with a
  specific lender (a tell that financing already blew up).
- Died escrows: "back on market", "buyer could not perform", "no fault of the seller" —
  the seller just learned their buyer pool is smaller than they thought.
- Tenant-in-place / investor-only listings: the agent has pre-qualified the cash-buyer
  pool for you. Suggest cap-rate/assignment plays, not rehab models.
- Explicit motivation: price cuts (count and size when derivable), credits offered,
  "motivated", "anxious", "priced to sell", "bring all offers", "as-is", estate/probate/
  trust language, vacancy, hoarder/condition language, deferred maintenance.
- Flat-fee / limited-service listings with the seller's own phone number in remarks —
  a live seller conversation with no agent gatekeeper.
- DOM mechanics: high DOM plus any of the above compounds; a 250+ DOM listing with
  "won't last" language is a seller in denial worth a certainty pitch.

OUTPUT FIELD RULES
- flags: 2–5 short tags, e.g. "SHORT SALE", "266 DOM", "LEASED SOLAR $55K",
  "SQFT GAP 840sf", "DIED ESCROW", "TENANT / INVESTOR ONLY", "SELLER PHONE IN REMARKS".
- why: 1–2 sentences, the structural read — the thing a rules engine would miss.
- play: one sentence, the specific move (e.g. "Ask what the bank already rejected —
  that question hands you the floor", "Verify permits at Clark County first",
  "Get the rent roll and assign on cap rate").
- outreach_angle: 2–3 sentences addressed to THIS listing agent's situation, in a
  direct, professional, certainty-selling voice. No listing-agent commission mentions.
- arv_estimate: your modeled after-repair value in whole dollars — conservative and
  triage-grade, derived from the row's sqft, zip, price band, and condition language.
  It feeds a pricing queue that computes a preliminary offer from it, and is replaced
  by a comps-based ARV before anything goes in writing — so give your best defensible
  number rather than refusing. Use 0 only when the row truly cannot support an estimate.
- rehab_tier_guess: 1 cosmetic / 2 standard / 3 heavy / 4 gut, inferred from remarks,
  year built, and condition language. Default 2 when unclear.
- address: the COMPLETE address — street, city, state, and zip combined from the
  row's columns (e.g. "5788 Mia Skye ST, Las Vegas, NV 89148"). Never street-only.
- agent: pull name/phone/email from the row's agent columns; empty string when absent.
- list_price / dom / sqft: parse numerics from the row ("$500,000" → 500000,
  "2,116" → 2116). Use 0 when truly absent.
- arv_note: one line. Any value opinion must be labeled modeled-only — e.g. "Modeled
  from zip-level actives only — pull 90-day renovated solds for 89147 before writing."
  NEVER present a modeled number as underwriting-grade.
- market_note: 2–3 sentences on what this batch says about the market and which zips
  or price bands look softest. No invented statistics — only what the rows support.

Order properties: all Tier 1 first (best first), then Tier 2, then Tier 3.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireRole(req, 'admin')) return unauthorized(res);
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Screener not configured — add ANTHROPIC_API_KEY in Vercel project settings.' });
  }

  const rows = (req.body || {}).rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Body must be {rows:[...]} with at least one row.' });
  }
  if (rows.length > MAX_ROWS) {
    return res.status(400).json({ error: `Max ${MAX_ROWS} rows per request — send in chunks.` });
  }

  const client = new Anthropic();

  try {
    const response = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: 'Screen this MLS export batch. Rows as JSON:\n\n' + JSON.stringify(rows),
      }],
      output_config: {
        format: zodOutputFormat(ScreenResult),
      },
    });

    if (response.stop_reason === 'refusal') {
      return res.status(502).json({ error: 'Model declined the request', detail: response.stop_details?.explanation || '' });
    }
    if (!response.parsed_output) {
      return res.status(502).json({ error: 'Screening response could not be parsed', stop_reason: response.stop_reason });
    }
    return res.status(200).json({
      result: response.parsed_output,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY is invalid — check the value in Vercel settings.' });
    }
    if (e instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Rate limited by the Claude API — wait a minute and re-run.' });
    }
    if (e instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `Claude API error ${e.status}: ${e.message}` });
    }
    return res.status(500).json({ error: e.message });
  }
}
