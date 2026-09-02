# Reclaim — AI Tinkerers London 3-Hour Hackathon

**Idea:** an autopilot that finds the money TfL owes you and claims it before the deadline expires.

## Documents

| File | What's in it |
|---|---|
| [`01-hackathon-brief.md`](01-hackathon-brief.md) | The brief verbatim, judging criteria decoded, what wins and what loses |
| [`02-idea-reclaim.md`](02-idea-reclaim.md) | The product: problem, rules, detection algorithm, architecture, data model, demo script, scope ladder |
| [`03-technical-findings.md`](03-technical-findings.md) | Verified API/policy facts with reproducible probes, plus the undocumented gotchas |
| [`04-open-decisions.md`](04-open-decisions.md) | Decisions that need a human call before building |

## The one-paragraph pitch

Every Londoner is owed money by TfL and almost nobody claims it. A 15-minute Tube delay entitles you to a refund of that fare, and you have 28 days. An incomplete journey charges you a maximum fare, and you have 8 weeks. Nobody remembers, so the money quietly expires. Reclaim ingests your journey history, detects both classes of claim deterministically, assembles the supporting evidence from TfL's own disruption records, tracks each deadline in a durable workflow, and files the claim in a headless browser — running unattended on a daily cron, with an idempotent ledger so a claim can never be filed twice.

## Why it beats the "could a markdown file do this?" test

Six reasons, in pitch order:

1. **Two thresholds by mode.** Tube/DLR is 15 minutes, Overground/Elizabeth line is 30. An LLM guesses; we encode.
2. **Two deadlines plus a hold.** 28 days for delays, 8 weeks for max fares, and you must wait 48 hours before filing a max-fare claim. That is a clock, not a chat session.
3. **Ambiguous station resolution.** "Canary Wharf" resolves to six NaPTAN entries including a river pier. Needs a deterministic resolver, not a vibe.
4. **The baseline problem.** TfL's Journey Planner refuses any date more than 7 days in the past — discovered empirically, documented nowhere — so the baseline needs a three-tier fallback strategy.
5. **Idempotency is not optional.** Double-filing a refund claim is fraud-adjacent. That's a unique constraint in a ledger, not a prompt that says "please don't file twice."
6. **It has to run on day 26.** The whole value is acting when you have forgotten. An agent in a terminal cannot.

## Run the prototype

```bash
npm test
npm run dev
```

Open <http://localhost:8787> and click **Scan my journeys** for the rehearsable demo, or upload the real TfL CSV in `tfl exports/`. The prototype parses and analyses journey data entirely in the browser.

## Deploy to Cloudflare

```bash
npx wrangler login
npm run deploy
```

Wrangler prints the public `workers.dev` URL after deployment. Add `TFL_API_KEY` as an encrypted Cloudflare Worker secret. Uploaded recent journeys are resolved through the server-side proxy and checked against TfL Journey Planner; the key is never exposed to the browser.
