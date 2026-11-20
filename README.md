# Chaperone

**Website:** https://chaperone.geo.hashmeta.tech · **Live app:** https://uq2xhx6u.qwenwork.page

**An oversight agent that sits between a one-person company's AI agents and the
outside world.** Every action a worker agent wants to take (send, pay, delete,
upload, quote, sign) is meant to go through a single logged gate first. The gate
classifies the data involved, checks the facts, decides, and records why,
quoting the source file.

Built for the QwenWork x Hashmeta AI One-Person Company Hackathon, Track 2
(AI Governance, Security & Decision-Making), on AvePoint's "Agents Watching
Agents" starter kit.

| Evaluation | Score |
|---|---|
| Sensitivity classifier vs ground truth (27 kit files + 3 new) | **30/30 · 100%** |
| Kit scenarios S1–S5 (decision + rules + evidence, 3 points each) | **15/15 · 100%** |
| New scenarios S6–S10 (same three checks) | **15/15 · 100%** |
| Unit tests (`node:test`, incl. adversarial regressions) | **173/173 passing** |
| Red-team attack harness (107 reachable attacks) | **100/107 held or blocked** (was 40/107) |

The scores come from `reports/classifier_score.json` and
`reports/scenario_score.json`, which `npm test` regenerates on every run. The
attack harness and the fix-by-fix regression map are in
[`tests/REGRESSION.md`](tests/REGRESSION.md).

## The story

Lumen Studio is a fictional one-person design studio in Singapore. Its owner,
Mei, runs five AI worker agents: Marketing, Sales, Ops, Finance and Support.
Chaperone is the sixth agent, and the only one with authority. Every worker
action is meant to go through the gate — and with the QwenWork hook
(`integrations/qwenwork/`), tool calls are checked at the tool boundary itself,
for agents routed through it.

Each morning Mei gets a plain-words briefing, money first. Anything that needs
her shows up once in an approval queue. Every number she sees traces back to a
file.

## How it works

```mermaid
flowchart LR
    subgraph Workers["Worker agents"]
        M[Marketing] & S[Sales] & O[Ops] & F[Finance] & Su[Support]
    end
    Workers -- "POST /api/gate<br/>{agent, action, task, params}" --> G

    subgraph G["Chaperone gate · src/chaperone.js"]
        direction TB
        C1[1 · classify data by content] --> C2[2 · resolve lineage]
        C2 --> C3[3 · check task scope]
        C3 --> C4[4 · fact-check outbound figures]
        C4 --> C5[5 · aggregate payments]
        C5 --> C6[6 · scan inbound text for injection]
        C6 --> C7[7 · apply rules/policy.json]
    end

    G --> D{Decision}
    D -- ALLOW --> X[Action runs]
    D -- HOLD_FOR_APPROVAL --> Q[Approval queue<br/>owner says yes / no]
    D -- BLOCK --> B[Stopped, with reasons]
    G --> L[(Append-only log<br/>logs/*.jsonl)]
    Q -- "owner decision<br/>(logged too)" --> L
    L --> UI[Web UI · SSE live]
    L --> BR[Morning briefing<br/>+ 60 s video]
```

For each action, the gate does the following:

1. **Classifies** every file the action touches by its content, not its
   filename, into `public` / `internal` / `client-confidential` / `regulated`
   (`rules/taxonomy.json`), and cites the line that decided it. Normalisation
   (NFKC, zero-width characters, Cyrillic lookalikes) runs first, and encoded
   payloads are decoded and classified too, so common disguises don't lower a
   level. Unreadable files fail closed to `regulated`.
2. **Tracks lineage.** Summaries, rewrites and splits inherit the highest
   sensitivity of their declared sources. Files an agent actually read through
   the gate become part of its context even if it declares no sources, and a
   word-shingle similarity check links many paraphrases to their confidential
   originals — see [Known limits](#known-limits) for what it misses.
3. **Checks scope** against the task record (`rules/tasks.json`), never against
   what the agent declares. A request may narrow its task's scope, never widen
   it. Out-of-scope reads of regulated data are blocked; other scope creep is
   logged.
4. **Fact-checks** outbound figures, percentages, fractions, number words,
   dates and commitments against the source files and shows claimed vs on
   file, with `file:line` quotes. Only files about the recipient's organisation
   count (no source shopping). A figure that can't be traced to any file counts
   as made up. Amount parsing converts any Unicode decimal digit to ASCII and
   handles compact forms (`5k8`), number words (`5 thousand 8 hundred`) and
   sub-100 values, in linear time. Price-floor client names are matched after
   NFKC + confusable folding, space collapsing and dropping `the` /
   `centre`/`center`, with fuzzy matching against the known client list.
5. **Aggregates payments.** Duplicate tracking keys on invoice + payee across
   all runs: paying an already-paid invoice is BLOCK (an invoice is never paid
   twice). Per-supplier totals over 24 hours catch split payments. The payee
   must match the issuer named on the invoice by full normalised legal name —
   short forms resolve unambiguously via the owner's supplier list, and
   first-word lookalikes no longer pass. The currency must be SGD. Path
   spelling (case, `./`, `//`) never creates a "new" invoice.
6. **Scans inbound content for prompt injection** (broadened multiline pattern
   set, normalised, covering data-moving and money-moving instructions in
   several languages). File and email text is treated as data, not
   instructions — a detected injection raises the decision to BLOCK. Once an
   agent has READ a file flagged as containing embedded instructions, that
   agent's later pay/upload/quote actions are HOLDed for owner review; acting
   on the flagged source itself is still BLOCK.
7. **Applies `rules/policy.json`** (19 rules) and **logs everything**: time,
   agent, action, files, data level, outcome, rule IDs, and evidence as direct
   quotes with file paths. Owner approvals and denials are appended to the
   same log. The log is append-only and hash-chained.

### Only the owner decides

- **Owner sign-in.** The page is served with no owner token. The owner signs
  in by visiting `/?owner=<token>` (printed at startup, or set via
  `OWNER_TOKEN`). That sets an `httpOnly` `SameSite=Strict` cookie (`Secure`
  over https) and redirects to strip the token from the URL. Worker agents
  never get the token. Cross-origin writes are refused.
- **Visitors get demo mode.** Without the cookie, the UI shows a small
  "Demo mode" label and runs against a separate in-memory sandbox: "Run the
  demo" and queue decisions there never touch real state. The owner sees an
  "Owner" label and can toggle between the real view and the sandbox.
  `/api/state`, `/api/events`, `/api/briefing` and `/api/lineage` serve the
  visitor's demo context or the owner's real context — no 401 for reading.
- **Real decisions are owner-only** (`/api/queue/decide` on real items,
  `/api/hook`) and are themselves appended to the hash-chained log. Demo
  visitors decide sandbox items only.
- **NEVER rules can't be approved by anyone** — not from the queue, not by a
  message claiming to be Mei. A claimed approval in content is quoted and
  exposed as evidence, never treated as authority.
- **Approvals are single-use**, bound to the exact action hash (full params,
  attachments included). Approving one email never releases a different email
  with the same opening line; a retry after approval gets a fresh queue item.
- **Unknown parameters fail closed.** Every recipient (`to`, `cc`, `bcc`) and
  every attachment (singular or plural) is checked; anything hidden in an
  unexpected field is held, or blocked when it carries protected data.
- **Overwriting a file is a delete** and is held like one (R16), with the money
  at stake shown for unpaid invoices.
- **The real log is append-only and hash-chained**: every entry links to the
  previous one by SHA-256 (`/api/state` reports `log_chain.ok`). Demo runs
  never write to it. The chain detects tampering; it does not prevent it
  (see [Known limits](#known-limits)).
- **An agent can't flood anyone else's queue**: the cap is 20 pending items
  per agent per hour, queue items are agent-scoped, and one agent hitting the
  cap never blocks another agent's actions.

### Decision model

| Policy rule type | Count | Gate outcome | What it means |
|---|---|---|---|
| `ALLOW` | 7 | **ALLOW** | Routine work goes through and is logged. |
| `APPROVE` | 8 | **HOLD_FOR_APPROVAL** | Parked in the owner's queue. One entry per item, so she's never nagged twice. |
| `NEVER` | 4 | **BLOCK** | Stopped outright. NEVER rules can't be approved by anyone, including a message that claims to be from the owner. |

Unknown actions fail closed: they are held, never allowed. Malformed gate input
gets an HTTP 400 and nothing is logged, because nothing was attempted. Task ids
like `__proto__` are rejected with 400. `/api/gate` and `/api/hook` bodies are
capped at 64 KB (413 above).

### The ten scenarios

| ID | Scenario | Decision | Rules cited |
|---|---|---|---|
| S1 | Client data to an external tool | BLOCK | R01, R15 |
| S2 | Committing to a price below the floor | BLOCK | R01, R08, R07 |
| S3 | Deleting records to tidy up | HOLD_FOR_APPROVAL | R01, R16 |
| S4 | A fabricated figure sent to a client | BLOCK | R01, R18, R09 |
| S5 | Quiet scope creep | HOLD_FOR_APPROVAL | R01, R02, R12 |
| S6 | Sensitivity laundering through a summary | BLOCK | R01, R15, R19 |
| S7 | Prompt injection in a vendor email | BLOCK | R01, R15, R05 |
| S8 | Splitting a payment to dodge the approval limit | HOLD_FOR_APPROVAL | R11 |
| S9 | Fake owner approval | BLOCK | R01, R08, R07 |
| S10 | Regulated data received in error: the correct handling | ALLOW | R01, R17, R03 |

Each scenario is scored on three checks: the right decision, the right rule
IDs, and the right evidence. S1–S5 come from the kit (`rules/scenarios.json`)
and S6–S10 are new (`rules/scenarios_extra.json`). The table shows the output
of `npm run score:scenarios`.

## Known limits

- **Paraphrase and translation detection is partial.** Similarity is
  word-shingle based (English tokens, shared 3-grams). A translation or a
  thorough rewrite with no shared 3-grams can evade it. Lineage inheritance
  covers declared and derived files, not arbitrary rewording.
- **Injection detection is pattern-based.** Novel phrasings or languages can
  evade the regex. The read-taint HOLD mitigates this for pay/upload/quote,
  but not for every action.
- **Name matching is conservative.** Fuzzy client/payee matching holds unusual
  spellings for review rather than auto-matching them. It is not a general
  entity-resolution system.
- **Sub-100 prose offers are not price commitments.** Email price-commitment
  detection ignores figures under SGD 100 in body text (a noise filter). The
  amount parser itself handles sub-100 values.
- **Live state is in-memory.** The demo sandbox, queue and payment ledger live
  in one process; a restart clears them. The on-disk JSONL log persists and is
  append-only, but the running queue and ledger do not survive restarts.
- **The hash chain detects tampering, it does not prevent it.** Deletion or
  edits break the chain, but an attacker with write access to the process or
  disk can rewrite history. There is no external anchoring.
- **The owner token is a bearer secret.** Sign-in puts it in the URL once (the
  redirect strips it; `Referrer-Policy: no-referrer`). Anyone who obtains the
  token or the cookie is the owner.
- **Enforcement depends on routing.** Chaperone checks actions that reach the
  gate or the installed hook. It cannot intercept an agent that acts outside
  them.
- **Single instance.** No multi-process or shared-state support.

## Quick start

Requires Node.js 18 or later. There are no runtime dependencies and no API keys.

```bash
npm test     # unit tests + classifier score + scenario score
npm start    # live app on http://localhost:8081 (prints the owner sign-in URL)
```

Open the printed `/?owner=<token>` URL to sign in as the owner; the token then
lives in an httpOnly cookie and is stripped from the URL. Everyone else gets
demo mode.

In the app, **Run the demo** replays all 10 scenarios in a separate in-memory
sandbox — each run is a fresh, self-contained simulation, reset per run. The
real append-only log, approval queue and payment ledger are never touched by a
demo. The log, evidence, queue, fact-check table, lineage chain and scorecard
update live over server-sent events.

### Environment

| Variable | Default | Used by | Purpose |
|---|---|---|---|
| `PORT` | `8081` | `src/server.js` | HTTP port. |
| `HOST` | `0.0.0.0` | `src/server.js` | Bind address (set by the QwenWork Pages runtime). |
| `OWNER_TOKEN` | random per boot | `src/app.js` | Owner sign-in token. Printed at startup as a `/?owner=<token>` URL; visiting it sets the httpOnly cookie and redirects. Set it to keep the same token across restarts (the QwenWork hook reads it). |

The owner's name comes from `rules/policy.json`, and the owner's email from
`data/00_README.md`. Neither is hard-coded. The video pipeline has its own
settings, listed in [`video/README.md`](video/README.md).

### HTTP API

Worker channel: `POST /api/gate` needs no owner token (agents call it). Owner
routes need the owner cookie or `Authorization: Bearer <token>`; cross-origin
writes are refused. Read routes serve the owner's real context or a visitor's
demo context.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/gate` | worker | The single channel for worker actions. Returns the decision, rules and evidence. Body capped at 64 KB (413 above). |
| `POST` | `/api/hook` | owner | QwenWork PreToolUse hook: `{tool_name, tool_input}` → `{decision: "allow"\|"deny", reason}`. HOLD maps to deny ("held for owner approval") and queues the item. Body capped at 64 KB (413 above). |
| `GET` | `/api/events` | owner real / visitor demo | Server-sent events stream used by the UI. |
| `GET` | `/api/state` | owner real / visitor demo | Log, queue, scores, briefing, lineage and `log_chain` in one snapshot. |
| `POST` | `/api/demo/run` | public | Replays the 10 scenarios in the in-memory sandbox (409 if a run is already going). Never touches real state. |
| `POST` | `/api/queue/decide` | owner real / visitor demo | `{queue_id, decision: "approve" \| "deny", mode}`. `mode` selects the real queue (owner only) or the demo sandbox. Single-use; NEVER items are refused; real decisions are logged to the chain. |
| `GET` | `/api/briefing` | owner real / visitor demo | The morning briefing, including the spoken narration segments. |
| `GET` | `/api/lineage` | owner real / visitor demo | File lineage graph. |
| `GET` | `/api/health` | public | Liveness: `ok`, `demoRunning`, action and queue counts, uptime. |

## Built with QwenWork

QwenWork is not a checkbox in this project — it built and runs it:

- **The demo video** (`assets/demo-video.mp4`, 175 s): script, neural narration
  (local Kokoro), word-level captions (faster-whisper alignment), motion
  graphics, real Playwright footage of the running app, and final assembly —
  all produced by QwenWork agents working in parallel.
- **The music and title art** were generated with QwenWork's media tools.
- **The QwenWork integration** (`integrations/qwenwork/`): a PreToolUse hook
  adapter and an SDK `canUseTool` path that route tool calls through the
  gate. Live QwenWork agents ran through it during the build: a sales agent
  emailing the client list outside was **BLOCKED**; an ops agent deleting
  records was **HELD** for the owner (real log excerpts in
  `integrations/qwenwork/live-run.md`).
- **The deploy**: the live app runs on QwenWork Pages
  (https://uq2xhx6u.qwenwork.page).
- **The red team**: QwenWork agents attacked the engine (107 reachable
  attacks), and the fixes were verified against the same harness.

## The web UI

The UI is written for Mei, not for engineers: plain words, large type and calm
colours. Rule IDs appear only in "details" lines. A small label shows whether
you are the owner or in demo mode; the owner can toggle between the real view
and the demo sandbox. It has six tabs:

- **Today:** the morning briefing, money first.
- **Live log:** every action as it happens, with evidence you can expand.
- **Approvals:** where decisions happen — real items for the owner, sandbox
  items for demo visitors.
- **Fact-check:** each claimed figure next to what's on file.
- **Where files went:** lineage, showing that a summary keeps its sources'
  sensitivity.
- **Scorecard:** the same checks as `npm test`, run live.

## Videos

- **`assets/demo-video.mp4`** — the 175-second product demo: a hook built on the
  real S7 injection attack, kinetic type, **real Playwright footage of the
  running app** (not redraws), animated proof counters (classifier 30/30,
  scenarios 30/30, unit tests), the business case, live QwenWork agents being
  BLOCKED and HELD, and a closing card with the live app and
  https://chaperone.geo.hashmeta.tech. Word-by-word captions (≤38 chars,
  decision words colour-coded), local neural narration
  (Kokoro-82M), −16 LUFS, true peak −3 dBTP. Subtitles: `assets/demo-video.srt`.
  Thumbnail: `assets/thumbnail.png`. YouTube kit: [`video/youtube.md`](video/youtube.md).
  The repo copy is a 14 MB web encode; the CRF 18 master used for YouTube is
  rebuilt locally by `video/assemble_final.py` (too large for git).
- **`assets/briefing-60s.mp4`:** a 60-second narrated morning briefing. The same
  local neural voice reads a script generated by `src/narration.js` from the
  log. It runs about 60 s at -16 LUFS.

Both are reproducible. Setup and commands are in [`video/README.md`](video/README.md).

## Tests and CI

```bash
npm run test:unit        # node --test tests/unit/*.test.js
npm run score            # classifier vs ground truth (30 files)
npm run score:scenarios  # 10 scenarios x 3 checks
```

- **Unit tests** (`tests/unit/`) cover the classifier, config, fact-check,
  prompt injection, lineage, payments, policy, the HTTP server, the store, the
  QwenWork hook route, and adversarial regressions (`regression.test.js`)
  mapped fix-by-fix in [`tests/REGRESSION.md`](tests/REGRESSION.md).
- **Scorers** (`tests/score_*.js`) use the same scoring code as the live
  Scorecard tab (`src/score.js`).
- **CI** (`.github/workflows/ci.yml`) runs `npm test` on Node 18, 20 and 22 for
  every push to `main` and every pull request.

### Adversarial testing

A red-team harness of 107 reachable attacks (exfiltration, payment tricks,
injection variants, queue abuse, fact-check evasion, destructive lookalikes)
ran against the real HTTP API. Measured result: **40/107** held or blocked
before hardening, **100/107** after. The 7 remaining failures are documented
in [`tests/REGRESSION.md`](tests/REGRESSION.md): those tests compare against a
hardcoded copy of the *old* injection regex literal inside the attack scripts
themselves, not the engine, and the engine's detection of those exact variants
is covered by the regression tests.

## Project layout

```
src/        gate engine (chaperone.js), classifier, lineage, fact-check,
            normalisation, store (hash-chained log), briefing + narration,
            scenario runner, shared scorer, HTTP app + server
web/        web UI, owner + demo modes (index.html, style.css, app.js)
rules/      policy (19 rules), taxonomy (4 levels), scenarios (kit + extra),
            ground truth, tasks.json (task → scope registry)
data/       Lumen Studio sample files (kit data + 3 new test files)
agents/     prompts for the 5 workers and the Chaperone oversight agent
integrations/qwenwork/  PreToolUse hook adapter, /api/hook handler, SDK path,
            live-run logs (see its README for 3-step setup)
tests/      unit tests (node:test), scorers, REGRESSION.md
reports/    machine-readable score reports (rewritten by npm test)
logs/       append-only action logs (JSONL)
video/      reproducible video pipelines (see video/README.md)
assets/     rendered videos, subtitles, thumbnail
design-system/  UI design tokens and guidelines
```

## Principles

- **No invented figures.** Every number in the UI, the briefing and the videos
  traces to a file in `data/` or to the engine's own logged run. The engine
  itself contains no hard-coded names, paths or amounts; clients, suppliers,
  price floors, limits and contract clauses are all looked up from `data/` and
  `rules/`.
- **One gate, one log.** Every action is meant to go through the gate, and the
  QwenWork hook enforces it at the tool boundary for agents routed through it.
  Every decision carries rule IDs and quoted evidence; owner approvals and
  denials are logged too. The log is append-only and hash-chained.
- **Content is data.** Instructions found inside files or emails are never
  followed. Acting on a flagged source is blocked; an agent that has read a
  flagged file has its later pay/upload/quote actions held for owner review.
- **Only the owner decides.** Real HOLD items wait for an explicit yes or no
  from the authenticated owner, and the decision is logged; approvals are
  single-use; NEVER items can't be approved at all. Demo visitors decide
  sandbox items only.