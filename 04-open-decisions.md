# Open decisions

Two resolved, one pending an observation.

---

## 1. PENDING — Journey history ingest format

**Decided:** manual upload, not automated login. The claim engine is the interesting part and the thing criterion 3 rewards; login automation is work that looks impressive in principle and eats a third of the build window in practice. Mention it in the pitch as the obvious next step.

**Still unknown:** what TfL actually gives you. The journey history view sits behind Azure B2C auth (`tfl.gov.uk/account` → `account.tfl.gov.uk/my-account`), so the export format can't be verified without signing in.

**Action before the event —** sign in, open journey history for your card, and record:

1. Download formats offered (CSV, PDF, both, none)
2. How far back history goes
3. Exact column headers
4. How an incomplete journey / maximum fare is labelled in the row text — Detector B's entire trigger
5. Whether touch-in and touch-out are separate fields or one combined string

**Design consequence, already decided:** ingest accepts **either a file upload or a pasted text blob**. If the export is PDF-only or on-screen-table-only, select the table, paste it, and the parser normalises it through the same path. This removes the biggest unknown from the critical path regardless of what the answer turns out to be.

**Fallback if there's no account:** `contactless.tfl.gov.uk/UnregisteredCustomer/Captcha` gives 7 days of journey and payment history from card details plus a CAPTCHA, no registration. Narrower, but it sits exactly inside the 7-day window where Journey Planner still accepts historical dates, so tier-2 baselines work perfectly on it.

---

## 2. RESOLVED — Architecture

**Cloudflare account is on the Free plan.** Chosen stack, all of which is available on Free:

**Workers + D1 + Workflows + Browser Rendering.**

- Workflows: Free and Paid. Only two primitives needed — `step.sleepUntil` for the 48-hour hold and the pre-deadline wake, `step.waitForEvent` for human confirmation.
- Browser Rendering: Free and Paid, billed on browser time with a free tier.
- **Sandbox SDK is out** — it requires Workers Paid. No loss; the task is form-filling, not arbitrary code execution. Its credential-isolation feature is still worth one sentence in the pitch as the answer to "what if it handled my login?"

**In-flight fallback:** if Workflows fights you past T+2:15, drop to Durable Object alarms for the deadline sweep. Weaker narrative on criterion 2, but it ships.

**Criterion 4 is satisfied strictly, not just loosely** — headless Chromium genuinely executing in Cloudflare's sandboxed cloud, not just "deployed to a host."

---

## 3. RESOLVED — Filing depth

**Fill the real form, screenshot it, human confirms before submit.**

Headless Chromium navigates to TfL's actual refund form, fills every field from the claim record, screenshots it, and blocks on `step.waitForEvent` until you click confirm.

Why this is the right call, in order:

1. It's a real refund claim against a real account. A human confirming before submission is correct design, not a limitation.
2. It's the honest use of `waitForEvent` — human-in-the-loop is a thing Workflows exists to support, and demoing it makes the durability story concrete rather than asserted.
3. If TfL's form has bot protection, this degrades gracefully and full autonomy doesn't.

**Pitch it as deliberate:** *"it does everything except press submit, because it's your money and your account."* That reads as judgment, not incompleteness.

---

## 4. Scope — TfL only

National Rail Delay Repay is a per-operator maze: different thresholds, different portals, every TOC. Triples the rules surface for no extra demo impact. One sentence captures the upside for free — *"the same engine extends to Delay Repay across every train operator."*

---

## 5. Stripe success fee — out

Below the feature-freeze line. A 25% fee charged only on `resolved_paid` is a ten-minute add that reframes the project from hack to company, and it plays to your background — but only if everything else is done by T+2:30, which it won't be. Top of the stretch list.

---

## 6. Name

`Reclaim` is the working name. Alternatives: `Owed`, `Arrears`, `Delayed`. Slight preference for **Owed** — it's the noun the user already thinks in, and it's shorter to say in a 60-second demo. Not worth more than thirty seconds of thought.

---

## 7. Pre-event setup

- Install `wrangler` locally (currently absent; `npx wrangler` works but costs cold-start time)
- Register a TfL API `app_key` — the demo makes bursts of Journey Planner calls and unauthenticated rate limits are undocumented
- Create the repo with its own `wrangler.toml` (`~/stripe` is not a git repo)
- Export journey history and answer the five questions in decision 1
