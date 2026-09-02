# Hackathon requirements

## Event mechanics

| | |
|---|---|
| **Format** | Solo (organisers: "probably just one" — 3 hours leaves no room for sprint planning) |
| **Doors** | 17:30 |
| **Build window** | 18:00 → 21:00 (**3 hours**) |
| **Judging** | 21:00 |
| **Winners** | 21:15 |
| **Prizes** | £1k cash, $10k Cloudflare credits |
| **Partners** | Sparkles (YC W26), Cloudflare, Anthropic |
| **Credits** | Each participant gets Sparkles and Anthropic credit |

**Demo length: assume 60 seconds.** The brief allows only 15 minutes between "judging begins" and "winners announced." The February 2026 edition of this hackathon explicitly capped demos at one minute. Design the demo to land in 60 seconds and rehearse it — this is a hard constraint on scope, not a detail.

## The theme, verbatim

> You have 3 hours to automate a real-world problem. Push the implementation as far as you can and see what your clanker can really do. You don't need a grand idea: a mundane everyday task can win if the execution is excellent and genuinely useful. The only technical constraint: it must run in a cloud sandbox.

## Judging criteria, verbatim

1. Does it solve a real problem?
2. Is the build robust and reliable?
3. Did it need to be built, or could Hermes/OpenClaw + a markdown file do it?
4. Does it actually run in a cloud sandbox?

## Decoding the criteria

### Criterion 3 is the whole competition

Criteria 1, 2 and 4 are table stakes. Every entrant will solve *a* real problem and every entrant will deploy to a cloud. **Criterion 3 is the elimination round**, and it is unusually explicitly worded: the judges are pre-announcing that they will try to dismiss your project as "an agent with a good prompt."

Hermes and OpenClaw are general-purpose agent harnesses. The question being asked is: *if I handed a competent agent a markdown file describing this task, would I get the same result?* If yes, you lose regardless of how polished the demo is.

Properties an agent-plus-markdown structurally **cannot** have — these are the things worth building:

| Property | Why an agent can't do it |
|---|---|
| **A hard deadline clock** | Value comes from acting inside a legal window. A chat session doesn't wake up on day 26 of 28. |
| **Deterministic money math** | Arithmetic and threshold rules where a plausible-but-wrong answer is unacceptable. |
| **Unattended durability** | Runs forever, per user, survives crashes, resumes mid-pipeline. |
| **Idempotency guarantees** | "Never do this twice" must be a database constraint, not an instruction. |
| **A hostile web surface** | Portals with sessions, CSRF tokens, file uploads. Needs a real browser holding state. |
| **Verifiable provenance** | Every output traceable to a specific source record, not "the model said so." |

Corollary for the pitch: **say the quiet part out loud.** Spend the last 8 seconds of the demo explicitly answering criterion 3. Don't make the judges infer it.

### Criterion 2 — "robust and reliable"

In a 3-hour build this is judged on *visible* evidence of engineering discipline, not on test coverage nobody will read. Things that read as robust in 60 seconds:

- A retry/resume story you can point at (durable execution, not `try/catch`)
- A state machine with explicit terminal states, including failure ones
- An idempotency key with a unique index
- Graceful degradation shown live (e.g. "if the browser step fails, the claim stays queued and retries tomorrow")
- Not crashing during the demo — worth more than any of the above

### Criterion 4 — "runs in a cloud sandbox"

Two possible readings, and it's cheap to satisfy both:

- **Loose reading:** deployed on cloud infrastructure, not your laptop. Cloudflare Workers satisfies this trivially.
- **Strict reading:** genuinely executing inside an isolated sandbox environment. Satisfied by running headless Chromium via Cloudflare Browser Rendering, or by `@cloudflare/sandbox` containers.

Satisfy the strict reading and mention it in one sentence. Note the plan requirement difference: Browser Rendering is on Free and Paid; the Sandbox SDK requires **Workers Paid**.

### Criterion 1 — "solves a real problem"

The brief explicitly blesses mundane problems: *"a mundane everyday task can win if the execution is excellent and genuinely useful."* This is permission to pick something small and unglamorous and execute it properly. It is not permission to pick something you don't personally experience — the judges are Londoners and will smell a hypothetical.

## Anti-patterns that will lose

- A chatbot for X
- "An AI agent that books/orders/emails your stuff" with no deterministic core
- A RAG dashboard over a document set
- Anything whose demo is "and then the model writes a nice response"
- A summariser of any kind
- Something whose entire logic could be a system prompt

## Judge profile note

Previous editions of this series involved Tom Blomfield (Monzo, YC). The partner set is Sparkles / Cloudflare / Anthropic. This audience will respond to: consumer fintech that returns real money, evidence of infrastructure taste, and being told plainly why the thing needed real engineering. They will punish hand-waving about correctness where money is involved.

## Practical constraints for the day

- **Deploy in the first 20 minutes.** A working hello-world on the real platform, before any features. Never leave deployment to the end.
- **Hard feature freeze at T+2:45.** The last 15 minutes are for rehearsal, not for one more feature.
- **Have a demo that cannot fail.** Pre-seeded sample data path, so a live network hiccup doesn't kill the run.
- `wrangler` is not installed locally yet (`npx wrangler` works; node v20.20.2, bun and pnpm available).
