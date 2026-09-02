# Reclaim — design

*Working name. Alternatives: Owed, Delayed, Arrears.*

## The problem

TfL owes Londoners money constantly and almost nobody collects it.

Two entirely separate entitlements, both routinely forfeited:

**Service delay refunds.** If your Tube or DLR journey was delayed by 15 minutes or more, you can claim that fare back. Overground and Elizabeth line: 30 minutes. You have **28 days** from the delay.

**Incomplete journey / maximum fare refunds.** If you fail to touch out — bad reader, open gate, rushing for a connection — TfL charges a maximum fare, sometimes two. You can reclaim the difference for up to **8 weeks**, but you should wait 48 hours first because most are auto-corrected.

The failure mode is not that people don't know. It's that claiming requires you to (a) notice the delay was ≥15 minutes, (b) remember days later, (c) find the journey in your history, (d) fill a form per journey, (e) do it inside the window. Every step of that leaks. The money expires silently.

This is a genuinely daily London problem, it involves real money, and the amount recovered is verifiable on stage.

## What Reclaim does

1. **Ingests** your journey history from your TfL contactless/Oyster account — file upload or pasted table, since TfL's export format is unconfirmed.
2. **Detects** two independent classes of claim using deterministic rules and a per-journey baseline.
3. **Assembles evidence** from TfL's own published disruption records for the lines on that route at that time.
4. **Tracks deadlines** — 28 days, 8 weeks, and the 48-hour hold — in a durable workflow per claim.
5. **Files** the claim in a headless browser, with a human confirmation step.
6. **Runs unattended** on a daily cron, with an idempotent ledger so no claim is ever filed twice.

### Honest framing of what it is and isn't

TfL does not publish per-journey delay truth, and the refund form is an assertion by the passenger that TfL then assesses. So Reclaim is **candidate detection, evidence assembly and deadline management** — not adjudication. It says "this journey took 34 minutes against an 11-minute baseline, here is the Victoria line signal failure that was live at the time, here is the form, 6 days left." It does not claim to know TfL's internal verdict.

Say this in the pitch. Overclaiming here is the fastest way to lose credibility with a room that understands payments.

## The detection algorithm

This is the core of the product and the answer to criterion 3. Two independent detectors over the same journey set.

### Detector A — service delay

```
for each journey J with both a touch-in and a touch-out:
    actual   = J.touch_out_time - J.touch_in_time
    mode     = infer_mode(J)                 # from CSV note text + resolved station modes
    threshold = 15 if mode in {tube, dlr} else 30 if mode in {overground, elizabeth-line}
    from_id  = resolve_station(J.from_name)  # NaPTAN, mode-filtered, hub-preferred, cached
    to_id    = resolve_station(J.to_name)

    baseline = baseline_for(from_id, to_id, J.date, J.touch_in_time)

    delta = actual - baseline
    if delta >= threshold:
        claim(
          type      = SERVICE_DELAY,
          amount    = J.charge,              # the fare for that journey
          deadline  = J.date + 28 days,
          evidence  = disruptions_for(route_lines, J.date, J.touch_in_time),
        )
```

### `baseline_for()` — three-tier fallback

This exists because of a hard, undocumented API constraint: **TfL Journey Planner rejects any date more than 7 days in the past** (`400 Date cannot be more than 7 days in the past`). See [`03-technical-findings.md`](03-technical-findings.md).

| Tier | Condition | Source | Confidence |
|---|---|---|---|
| 1 | You have ≥3 prior journeys on this origin→destination pair | **median of your own actuals** | Highest — it's your route, your walking speed, your interchange |
| 2 | Journey is within the last 7 days | Journey Planner at the exact historical date/time | High |
| 3 | Otherwise | Journey Planner at the **next equivalent weekday and time** | Proxy — label it as such in the UI |

Tier 1 first is a deliberate modelling choice: a personal median is a better predictor of *your* journey than a timetable, and it makes the system better the longer you use it. Tier 3 is explicitly a proxy for the historical timetable, and the UI must say so. Showing the baseline source per claim is a feature, not a disclosure.

Journey Planner returns multiple itineraries; take the **minimum** duration as the baseline so the delta is conservative — we'd rather under-claim than generate a bad claim.

### Detector B — maximum fare / incomplete journey

```
for each journey J:
    if J.is_incomplete or J.charged_max_fare:
        claim(
          type       = MAX_FARE,
          amount     = J.charge - expected_fare(from_id, to_id),
          not_before = J.date + 48 hours,     # TfL auto-corrects most; don't file early
          deadline   = J.date + 8 weeks,
        )
```

Detection is pure CSV parsing — TfL's export marks unresolved journeys in the note/description column. The `not_before` hold is what makes this need a scheduler rather than a script.

## Why this needed to be built

The pitch script for criterion 3. Every item is a real thing encountered while designing this, not a rationalisation.

1. **Divergent thresholds.** 15 minutes for Tube/DLR, 30 for Overground/Elizabeth line. An LLM asked to apply this gets it wrong some fraction of the time; a table gets it right always.
2. **Three clocks.** 28 days for delays, 8 weeks for max fares, 48 hours minimum hold. Managing three overlapping windows across hundreds of journeys is scheduling, not prompting.
3. **Station resolution is genuinely ambiguous.** `Canary Wharf` returns 6 NaPTAN matches including a river bus pier and two separate bus stops. Requires mode filtering and hub preference. Verified — see findings doc.
4. **The 7-day baseline wall.** Undocumented, discovered by probing, and it forces the entire three-tier baseline design. No markdown file contains this.
5. **Idempotency is a correctness requirement.** Filing the same refund claim twice is fraud-adjacent. That's a unique index on `(user, journey, type)`, not an instruction.
6. **The value is in acting on day 26.** When you have completely forgotten. Unattended cron + durable workflow. An agent in a terminal cannot be there.

## Architecture

Recommended: **Cloudflare Workers + D1 + Workflows + Browser Rendering.** Alternatives and trade-offs in [`04-open-decisions.md`](04-open-decisions.md).

```
┌─────────────────────────────────────────────────────────────┐
│  Worker (Hono)                                              │
│  ├── POST /ingest      CSV upload → parse → journeys        │
│  ├── POST /scan        run detectors → create claims        │
│  ├── GET  /claims      UI: list, £ total, deadlines         │
│  ├── POST /claims/:id/file   → kick Workflow                │
│  └── POST /claims/:id/confirm → Workflow waitForEvent       │
└───────┬──────────────────┬──────────────────┬───────────────┘
        │                  │                  │
   ┌────▼────┐      ┌──────▼──────┐    ┌──────▼──────────┐
   │   D1    │      │  Workflows  │    │ Browser         │
   │journeys │      │ per claim:  │    │ Rendering       │
   │claims   │      │ sleepUntil  │    │ (headless       │
   │stations │      │ waitForEvent│    │  Chromium fills │
   │baselines│      │ retries     │    │  the TfL form)  │
   └─────────┘      └──────┬──────┘    └─────────────────┘
                           │
                    ┌──────▼──────┐        ┌──────────────┐
                    │ Cron 07:00  │        │  TfL API     │
                    │ rescan +    │───────▶│ JourneyPlan  │
                    │ deadline    │        │ StopPoint    │
                    │ sweep       │        │ Disruption   │
                    └─────────────┘        └──────────────┘
```

### Component responsibilities

| Component | Purpose | Depends on |
|---|---|---|
| `parser` | Uploaded file **or pasted text blob** → normalised journeys. Tolerant of column variants across Oyster and contactless export shapes. | nothing (pure) |
| `resolver` | Station name → NaPTAN ID. Mode-filtered, hub-preferred, cached in D1. | TfL StopPoint, D1 |
| `baseline` | Three-tier expected-duration lookup with caching. | TfL Journey Planner, D1, `resolver` |
| `detectors` | Pure functions: journeys + baselines → candidate claims. | nothing (pure) |
| `evidence` | Route lines + timestamp → disruption records. | TfL Disruption, R2 for snapshots |
| `ledger` | Claim persistence, state machine, idempotency. | D1 |
| `filer` | Drive the TfL form in headless Chromium, screenshot, return ref. | Browser Rendering |
| `pipeline` | Durable per-claim orchestration: hold → file → confirm → resolve. | Workflows, all of the above |

`parser` and `detectors` being pure functions is deliberate: they're the parts where correctness matters most and they're testable without any network.

## Data model

```sql
journeys(
  id, user_id, date, touch_in, touch_out, from_name, to_name,
  from_naptan, to_naptan, mode, charge_pence, note_raw,
  is_incomplete, charged_max_fare, actual_minutes
)

stations(csv_name PRIMARY KEY, naptan_id, modes_json, resolved_at)

baselines(from_naptan, to_naptan, dow, tod_bucket, expected_minutes, source, fetched_at)

claims(
  id, user_id, journey_id, type, threshold_minutes, baseline_minutes,
  actual_minutes, delta_minutes, amount_pence, baseline_source,
  not_before, deadline_at, state, filed_at, external_ref,
  idempotency_key UNIQUE
)

evidence(id, claim_id, kind, payload_json, captured_at)
```

`idempotency_key = sha256(user_id | journey_id | type)` with a unique index. This is the "cannot double-file" guarantee, enforced by the database rather than by care.

### Claim state machine

```
detected ──▶ queued ──▶ filed ──▶ awaiting_tfl ──▶ resolved_paid
    │           │                                └▶ resolved_rejected
    │           └──▶ blocked_hold (until not_before)
    └──▶ expired (deadline passed without filing)
```

`expired` existing as a first-class state matters: it's the thing the product exists to prevent, so it should be countable and visible.

## Demo script — 60 seconds

| Time | Beat |
|---|---|
| 0–8s | "TfL owes every Londoner money. 15-minute Tube delay, you get the fare back. You have 28 days. You forget. Every single time." |
| 8–18s | Upload real journey history CSV. *N* journeys parsed live. |
| 18–36s | Result: **"£43.20 across 7 claims."** Point at one row: actual 34 min, baseline 11 min, delta +23, rule *Tube — 15 min*, evidence *"Victoria line: severe delays, signal failure at Highbury & Islington"*, deadline *6 days left*. |
| 36–50s | Click **File**. Headless Chromium on Cloudflare fills the real TfL form. Screenshot appears. Confirm. |
| 50–60s | "This runs at 7am every day on a cron, each claim is a durable workflow that wakes up before its deadline, and the ledger makes double-filing impossible. **That's why this isn't a prompt.**" |

Rehearse it. Twice. The last beat is the one that wins.

## Scope ladder

Timeboxed. Everything below the line is cuttable without breaking the demo.

| Window | Deliverable |
|---|---|
| 0:00–0:20 | Scaffold + **deploy hello world to production**. Wrangler, Hono, D1 schema applied. |
| 0:20–0:50 | CSV parser + sample-data generator + journeys persisted. Demo-safe path exists from here on. |
| 0:50–1:30 | **Detection engine.** Resolver, baseline three-tier, both detectors, claim ledger. Protect this time ruthlessly. |
| 1:30–2:00 | UI: claim list, £ total, per-claim evidence and baseline provenance, deadline countdown. |
| 2:00–2:25 | Workflow + cron: one `sleepUntil`, one `waitForEvent`, daily rescan. |
| 2:25–2:45 | Filing step in Browser Rendering: fill form, screenshot. |
| 2:45–3:00 | **Feature freeze.** Deploy final, rehearse demo twice. |

**Cut list, in order:** Stripe success-fee flow → real form submission (degrade to fill-and-screenshot) → multi-user auth → scraping TfL login for history → National Rail Delay Repay.

**Do not build:** account creation, onboarding, settings, email notifications, mobile layout, dark mode.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Export format unknown until someone signs in | Ingest accepts pasted text as well as a file, through one parser; ship a sample generator so the demo never depends on the real file |
| Journey history requires TfL login to obtain | Primary path is manual upload — no credential handling in the demo at all. `contactless.tfl.gov.uk/UnregisteredCustomer/Captcha` gives 7 days with no account as a backstop |
| TfL API rate limits mid-demo | Cache aggressively in D1; pre-warm the demo dataset before presenting |
| TfL refund form changes / has bot protection | Degrade to fill-and-screenshot with human confirm; frame as deliberate human-in-the-loop design |
| Browser Rendering unfamiliar, eats time | It's the last feature built and the first cut. Quick Actions screenshot API as the cheap fallback |
| Workflows unfamiliar, eats time | Only two primitives needed (`sleepUntil`, `waitForEvent`). If it stalls, Durable Object alarms are the fallback |
| Demo network failure | Pre-seeded dataset + a recorded 20s screen capture as insurance |

## Stretch: the business model flourish

If time permits after freeze (it won't, but noting it): a success fee on recovered money via Stripe. 25% of what's actually refunded, charged only on `resolved_paid`. Ten minutes of work, and it reframes the project from hack to company. Explicitly below the cut line.
