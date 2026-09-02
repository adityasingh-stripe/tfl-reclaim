# Technical findings

Everything here was verified by probe or by reading the source page on 2 September 2026. Items marked **UNVERIFIED** are assumptions that still need checking — check them before they become load-bearing.

## TfL refund policy

Source: <https://tfl.gov.uk/fares/refunds-and-replacements>

| Refund type | Threshold | Claim window | Notes |
|---|---|---|---|
| **Service delay** — Tube, DLR | delayed **15 min or more** | **within 28 days** of the delay | |
| **Service delay** — London Overground, Elizabeth line | delayed **30 min or more** | **within 28 days** of the delay | |
| **Incomplete journey** (max fare) | none | **up to 8 weeks** from journey | "Wait at least 48 hours before you apply" — most are auto-corrected |
| Unused credit / ticket | n/a | before expiry | Not relevant to this build |

Also on that page: history can be checked via a contactless and Oyster account, a station ticket machine, the 7-day unregistered card service (contactless, last 7 days only), or by phone.

**UNVERIFIED:** what form the refund takes (pay-as-you-go credit vs refund to the contactless card), the exact fields on the service delay refund form, and whether submitting it requires a signed-in TfL account. The form page returned 404 on the URLs tried — find it via the site's own navigation at build time.

**UNVERIFIED:** the current maximum fare amount, needed to compute `expected_fare` deltas for Detector B.

## TfL Unified API

Base: `https://api.tfl.gov.uk`. All probes below ran **unauthenticated** and succeeded.

**UNVERIFIED:** rate limits. No `x-ratelimit-*` headers are returned. TfL asks developers to register for an `app_key` for higher limits — register one before the event and pass it, since the demo will make bursts of Journey Planner calls.

Responses carry `cache-control: public, must-revalidate, max-age=30, s-maxage=60`.

### Line status

```bash
curl -s "https://api.tfl.gov.uk/Line/Mode/tube/Status"
```

Returns per-line `lineStatuses[]` with `statusSeverity` (int) and `statusSeverityDescription` (e.g. `"Good Service"`), plus `disruptions[]`.

### Disruption — the evidence source

```bash
curl -s "https://api.tfl.gov.uk/Line/victoria/Disruption"
```

Live sample from the probe:

```json
[{ "category": "RealTime",
   "type": "lineInfo",
   "categoryDescription": "RealTime",
   "description": "Victoria Line: Severe delays while we fix a signal failure at
                   Highbury & Islington. Tickets are being accepted on the Weaver Line…" }]
```

This human-readable cause text is exactly what goes in the claim evidence and in the form's free-text field. It's also the single most demo-legible artifact in the whole product — a real named fault at a real station.

**Caveat:** this endpoint is *real-time*. It does not return historical disruptions. For journeys in the past, disruption evidence either has to be captured prospectively by the daily cron (snapshot to R2 every run, then join backwards) or the claim proceeds without cause text. **The cron capturing disruption snapshots daily is what makes historical evidence possible at all** — worth calling out in the pitch as a reason the system must run continuously.

### Journey Planner — the baseline source

```bash
curl -s "https://api.tfl.gov.uk/Journey/JourneyResults/1000173/to/1000138?time=0830&timeIs=Departing"
```

Returns `journeys[]`, each with `duration` (integer minutes), `startDateTime`, `arrivalDateTime`, and `legs[]` where each leg has `instruction.summary` (e.g. `"Central line to Liverpool Street"`). The leg summaries give the **set of lines used**, which is what to query for disruption evidence.

Take `min(duration)` across returned itineraries for a conservative baseline.

#### ⚠️ The 7-day wall — the most important finding

```bash
curl -s ".../JourneyResults/1000173/to/1000138?date=20260815&time=0830&timeIs=Departing"
# → {"httpStatusCode": 400, "message": "Date cannot be more than 7 days in the past."}
```

Past dates are accepted **only within the last 7 days**. Future dates work fine:

```bash
curl -s ".../JourneyResults/1000173/to/1000138?date=20260908&time=0830&timeIs=Departing"
# → journeys: 3, durations 11 / 11 / 11 min
```

This is documented nowhere and it forces the entire three-tier baseline design in [`02-idea-reclaim.md`](02-idea-reclaim.md). For journeys older than a week, the baseline must come from the user's own journey median or from a forward-dated equivalent-weekday query used as a proxy.

### StopPoint search — station name → NaPTAN

CSV exports contain station *names*; the API needs NaPTAN IDs. This resolution is ambiguous.

```bash
curl -s "https://api.tfl.gov.uk/StopPoint/Search/Highbury%20%26%20Islington?modes=tube"
# → HUBHHY | Highbury & Islington | ['tube','overground','national-rail','bus']
```

Without a mode filter it gets messy:

```bash
curl -s "https://api.tfl.gov.uk/StopPoint/Search/Canary%20Wharf"
# total 6:
#   HUBCAW       | Canary Wharf                      | ['elizabeth-line','tube','bus','dlr']
#   930GCAW      | Canary Wharf Pier                 | ['river-bus']        ← wrong
#   490000038F   | Canary Wharf Station              | ['bus']              ← wrong
#   490000038G   | Canary Wharf Station              | ['bus']              ← wrong
#   490G00016729 | Canada Square South / Canary Wharf Stn | ['bus']         ← wrong
#   490G000825   | Westferry Circus / Canary Wharf Pier   | ['bus']         ← wrong
```

**Resolver rules:** filter to rail modes (`tube,dlr,overground,elizabeth-line,national-rail`), prefer IDs prefixed `HUB` (interchange hubs), then exact name match, then first remaining. Cache every resolution in D1 — station names in a CSV repeat constantly, and this turns hundreds of lookups into a few dozen.

This ambiguity is a good criterion-3 talking point: five of six candidates for a common station name are wrong, and one is a boat.

## Cloudflare platform

### Workflows — durable execution

Source: <https://developers.cloudflare.com/workflows/>

Available on **Free and Paid** plans. Durable multi-step execution with no timeouts. The primitives needed here:

- `step.do('name', async () => …)` — result is persisted; resumes rather than restarts on failure. Automatic retries.
- `step.sleep()` / `step.sleepUntil()` — pause for seconds, hours, or days. This is the 48-hour hold and the pre-deadline wake-up.
- `step.waitForEvent('name', { event, timeout: '24 hours' })` — block on external input. This is the human confirmation before filing.
- Instances can be triggered, paused, resumed and terminated programmatically.

```ts
export class ClaimWorkflow extends WorkflowEntrypoint {
  async run(event: WorkflowEvent, step: WorkflowStep) {
    const claim = await step.do('load claim', () => …);
    if (claim.notBefore) await step.sleepUntil('48h hold', claim.notBefore);
    const filled = await step.do('fill TfL form', () => …);   // retries free
    await step.waitForEvent('human confirm', { event: 'confirmed', timeout: '24 hours' });
    await step.do('submit + record ref', () => …);
  }
}
```

**UNVERIFIED:** concrete limits (max steps, max instance duration, sleep ceiling). Docs link out to a limits page not yet read. Two primitives on a claim-sized workflow is nowhere near any plausible ceiling, so this is low risk.

### Browser Rendering — now "Browser Run"

Source: <https://developers.cloudflare.com/browser-rendering/>

Available on **Free and Paid** plans, priced on browser time used with a free tier. Two modes:

- **Browser Sessions** — Puppeteer, Playwright, CDP or Stagehand, deployed inside Workers or connected via CDP. Sessions can be persisted in Durable Objects to avoid cold starts. Use this for the form-filling flow.
- **Quick Actions** — stateless single HTTP request for screenshot, PDF, markdown, snapshot, links, scrape, structured data, crawl. **No code deployment needed.** This is the cheap fallback for the filing step if time runs short: screenshot the pre-filled form URL and move on.

### Sandbox SDK — the literal "cloud sandbox"

Source: <https://developers.cloudflare.com/sandbox/>

Requires **Workers Paid**. Full Linux container per sandbox, backed by Durable Objects for stateful coordination. `getSandbox(env.Sandbox, id)`, then `exec()`, `runCode()` for Python/JS with persistent contexts, file I/O, `watch()`, browser terminals over WebSocket, R2/S3 mounted as a filesystem, and **outbound traffic control** — block/allow/intercept outbound HTTP and inject auth headers from the Worker so credentials never enter the sandbox.

That last feature is a genuinely strong security story if the product ever handles a user's TfL credentials: the sandbox drives the browser but never sees the password. Worth one sentence in the pitch even if unused; it's the difference between "I ran a scraper" and "I thought about the trust boundary."

Note there's a `@cloudflare/sandbox@next` preview alongside the stable package; Cloudflare suggests new projects start on the preview.

### Choosing between them

| Need | Use |
|---|---|
| Fill a web form, screenshot it | Browser Rendering (Free plan, less setup) |
| Run untrusted code / need a real filesystem / credential isolation | Sandbox SDK (Paid plan) |
| Satisfy "runs in a cloud sandbox" strictly | Either — Browser Rendering is a headless browser in Cloudflare's sandboxed cloud |

Recommendation: Browser Rendering, because it's on the free plan and the task is form-filling, not arbitrary code execution.

## Getting journey history out of TfL

| Route | URL | Window | Auth |
|---|---|---|---|
| Registered account | `tfl.gov.uk/account` → `account.tfl.gov.uk/my-account` | Longer (contactless expected to exceed Oyster's online window) | Azure B2C sign-in |
| **7-day unregistered service** | `contactless.tfl.gov.uk/UnregisteredCustomer/Captcha` | **Past 7 days only** | Card details + CAPTCHA, no account |
| Station ticket machine | — | — | Card present |
| Phone | 0343 222 1234, 08:00–20:00 daily | — | — |

The 7-day unregistered service is more useful than it looks: it needs no account, and its window sits exactly inside the 7 days where Journey Planner still accepts historical dates — so every baseline it produces is tier 2 (exact historical query) rather than a forward-dated proxy.

**UNVERIFIED, and it can't be verified without signing in** — the journey history view is behind Azure B2C, so `WebFetch` only ever reaches the login redirect. Unknown:

1. Download formats offered (CSV, PDF, both, none)
2. History depth for contactless vs Oyster
3. Exact column headers
4. How an incomplete journey / maximum fare is labelled in the row text — Detector B's entire trigger
5. Whether touch-in and touch-out are separate fields or one combined string

**Mitigation, already designed in:** the ingest layer accepts **a pasted text blob as well as a file upload**, normalised through the same parser. If TfL turns out to offer no clean CSV, selecting the on-screen table and pasting it works identically. This is why the unknown doesn't sit on the critical path.

## The real export — confirmed schema

From `tfl exports/MasterCard - 4246 - June 2026 (Journeys).csv`:

```
Date,Time,Journey,Charge (GBP),Capped,Notes
01/06/2026,08:53 - 09:19,Lewisham (National Rail) to Cannon Street (National Rail),-3.90,N,
02/06/2026,10:48,"Bus Journey, Route 21",-1.75,N,
26/06/2026,08:15 - --:--,Bank to Unknown,-5.90,N,"As there is no record of where you touched in or out, the missing journey information has been automatically completed based on a previous journey you made."
```

| Column | Behaviour |
|---|---|
| `Date` | `DD/MM/YYYY` — UK order, must not be parsed as US |
| `Time` | **Dual-purpose.** Rail: `"08:53 - 09:19"` (both touches in one field). Bus: `"10:48"` (single touch). Incomplete: `"08:15 - --:--"` |
| `Journey` | Rail: `"X (National Rail) to Y (DLR)"` — mode annotation *sometimes* present (`Oxford Circus`, `Bank`, `Twickenham` have none). Bus: `"Bus Journey, Route 21"`, quoted for the comma. Incomplete: `"Bank to Unknown"` |
| `Charge (GBP)` | **Negative** = debited. `0.00` = Hopper fare (free second bus within 60 min) — not an anomaly |
| `Capped` | `Y`/`N`. If `Y` the refundable amount is ambiguous; record it |
| `Notes` | Where incomplete journeys are explained. **This is Detector B's trigger.** |

Composition of one real month: **24 bus, 15 National Rail, 5 tube, 1 DLR.** Only ~6 rows are TfL-rail claimable. Buses have no delay refund at all.

## ⚠️ Journey Planner needs `icsId`, not the `HUB…` id

`StopPoint/Search` returns `id` (e.g. `HUBBAN`) **and** `icsId` (e.g. `1000013`). Journey Planner accepts the `icsId` and returns **nothing** for the `HUB…` form — no error, just an empty `journeys` array, which is the worst possible failure mode.

Verified across 6 origin/destination pairs: 0/6 worked with `HUB…`, 6/6 worked with `icsId`. **The resolver must persist `icsId`.**

Also: TfL rejects `Python-urllib`'s default user agent. Send a real `User-Agent`.

## Algorithm validated against the real June data

Forward-dated baselines (June is >7 days past), actual from the CSV:

| Journey | Actual | Baseline | Delta | Verdict |
|---|---|---|---|---|
| Liverpool Street → North Greenwich, 23 Jun 17:31 | 40 | 18 | **+22** | **CLAIM** (Tube, 15 min) |
| Bank → Canary Wharf, 4 Jun 19:24 | 24 | 15 | +9 | correctly rejected |
| Liverpool Street → Oxford Circus, 11 Jun 18:18 | 15 | 10 | +5 | correctly rejected |
| Bank → Bethnal Green, 26 Jun 08:17 | 8 | 11 | −3 | correctly rejected |
| Lewisham → Cannon Street, 18 Jun 08:22 | 25 | 26 | −1 | on time — baseline is accurate |
| Lewisham → Euston, 20 Jun 07:08 | 34 | 37 | −3 | correctly rejected |

The premise holds: one real, defensible delay claim plus one incomplete journey (£5.90, `Bank to Unknown`) from a single month.

**Caveat found:** forward-dating is unreliable for National Rail. Lewisham → Twickenham on a Saturday returned a 98-minute baseline against a 57-minute actual — the planner routed via Elizabeth + Northern, probably weekend engineering works. Tier 1 (the user's own median) must stay the primary source.

## The download endpoint and the refund deep link

From the saved `Journey & payment history` page:

**CSV download is a plain cookie-gated GET:**
```
https://contactless.tfl.gov.uk/NewStatements/DownloadJourneyCsv?Period={M}%7C{YYYY}&CardDisplayId={guid}
```
Without a session cookie it 302s to `HomePage/LoginTimedOut`. With one, a Worker can loop months — **no DOM automation needed.** The month dropdown offers `9|2025` through `9|2026` (**13 months**) plus `7` for "last 7 days only".

**TfL publishes per-journey refund eligibility and a deep link into the refund flow:**
```
NewStatements/RedirectToJourneyOrRefund
  ?isEligibleForRefund=False
  &cardDisplayId={guid}
  &travelDayKey=16953
  &journeyDisplayId={guid}
```

Two consequences:

1. `isEligibleForRefund` is **TfL's own ground truth** on whether a journey is still claimable. We don't have to infer the window — we can read it, and cross-check our own deadline maths against it. Every June row is `False`, consistent with June being outside 28 days as of 2 Sep 2026.
2. The filer can **deep-link per journey** rather than navigating a form from scratch.

**`travelDayKey` = days since 1980-01-01.** Verified on four independent samples (16953 → 2026-06-01, 16954 → 06-02, 16956 → 06-04, 16960 → 06-08). Derivable from a date, so no scraping needed for that field.

**But `journeyDisplayId` is an opaque GUID that appears only in the HTML, not the CSV.** So ingest should fetch **both** the HTML journey page and the CSV, joined on date + time: the CSV gives clean tabular data, the HTML gives the refund deep link and the eligibility flag.

## Local environment

- `node` v20.20.2, `bun` and `pnpm` present, `npx` available
- **`wrangler` not installed** — `npx wrangler` works; consider installing before the event to save cold-start time
- Working directory `~/stripe` is not a git repo; the build should live in its own repo
