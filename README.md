# Chaperone

**An oversight agent that sits between a one-person company's AI agents and the
outside world.** Every action a worker agent wants to take (send, pay, delete,
upload, quote, sign) goes through a single logged gate first. The gate classifies
the data involved, checks the facts, decides, and records why, quoting the
source file.

Built for the QwenWork x Hashmeta AI One-Person Company Hackathon, Track 2
(AI Governance, Security & Decision-Making), on AvePoint's "Agents Watching
Agents" starter kit.

| Evaluation | Score |
|---|---|
| Sensitivity classifier vs ground truth (27 kit files + 3 new) | **30/30 · 100%** |
| Kit scenarios S1–S5 (decision + rules + evidence, 3 points each) | **15/15 · 100%** |
| New scenarios S6–S10 (same three checks) | **15/15 · 100%** |
| Unit tests (`node:test`) | **57/57 passing** |

The scores come from `reports/classifier_score.json` and
`reports/scenario_score.json`, which `npm test` regenerates on every run.

## The story

Lumen Studio is a fictional one-person design studio in Singapore. Its owner,
Mei, runs five AI worker agents: Marketing, Sales, Ops, Finance and Support.
Chaperone is the sixth agent, and the only one with authority. Nothing else can
send, pay, publish, delete or sign.

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
    L --> UI[Web UI · SSE live]
    L --> BR[Morning briefing<br/>+ 60 s video]
```

For each action, the gate does the following:

1. **Classifies** every file the action touches by its content, not its
   filename, into `public` / `internal` / `client-confidential` / `regulated`
   (`rules/taxonomy.json`), and cites the line that decided it.
2. **Tracks lineage.** Summaries, rewrites and splits inherit the highest
   sensitivity of their sources, so laundering a file through a summary never
   lowers its level.
3. **Checks scope** against the files the task declared it needs. Out-of-scope
   reads of regulated data are blocked; other scope creep is logged.
4. **Fact-checks** outbound figures, dates and commitments against the source
   files and shows claimed vs on file, with `file:line` quotes. A figure that
   can't be traced to any file counts as made up.
5. **Aggregates payments** per invoice and per supplier over 24 hours, which
   catches a payment split to stay under the approval limit.
6. **Scans inbound content for prompt injection.** File and email text is
   always treated as data, never as instructions.
7. **Applies `rules/policy.json`** (19 rules) and **logs everything**: time,
   agent, action, files, data level, outcome, rule IDs, and evidence as direct
   quotes with file paths.

### Decision model

| Policy rule type | Count | Gate outcome | What it means |
|---|---|---|---|
| `ALLOW` | 7 | **ALLOW** | Routine work goes through and is logged. |
| `APPROVE` | 8 | **HOLD_FOR_APPROVAL** | Parked in the owner's queue. One entry per item, so she's never nagged twice. |
| `NEVER` | 4 | **BLOCK** | Stopped outright. NEVER rules can't be approved by anyone, including a message that claims to be from the owner. |

Unknown actions fail closed: they are held, never allowed. Malformed gate input
gets an HTTP 400 and nothing is logged, because nothing was attempted.

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

## Quick start

Requires Node.js 18 or later. There are no runtime dependencies and no API keys.

```bash
npm test     # unit tests + classifier score + scenario score
npm start    # live app on http://localhost:8081
```

In the app, **Run demo** replays all 10 scenarios through the live gate. The
log, evidence, approval queue, fact-check table, lineage chain and scorecard
update live over server-sent events.

### Environment

| Variable | Default | Used by | Purpose |
|---|---|---|---|
| `PORT` | `8081` | `src/server.js` | HTTP port. |
| `HOST` | `0.0.0.0` | `src/server.js` | Bind address (set by the QwenWork Pages runtime). |

The owner's name comes from `rules/policy.json`, and the owner's email from
`data/00_README.md`. Neither is hard-coded. The video pipeline has its own
settings, listed in [`video/README.md`](video/README.md).

### HTTP API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/gate` | The single channel for worker actions. Returns the decision, rules and evidence. |
| `GET` | `/api/events` | Server-sent events stream used by the UI. |
| `GET` | `/api/state` | Log, queue, scores, briefing and lineage in one snapshot. |
| `POST` | `/api/demo/run` | Replays the 10 scenarios through the live gate (409 if a run is already going). |
| `POST` | `/api/queue/decide` | `{queue_id, decision: "approve" \| "deny"}`. NEVER items are refused. |
| `GET` | `/api/briefing` | The morning briefing, including the spoken narration segments. |
| `GET` | `/api/lineage` | File lineage graph. |
| `GET` | `/api/health` | Liveness: `ok`, `demoRunning`, action and queue counts, uptime. |

## The web UI

The UI is written for Mei, not for engineers: plain words, large type and calm
colours. Rule IDs appear only in "details" lines. It has six tabs:

- **Today:** the morning briefing, money first.
- **Live log:** every action as it happens, with evidence you can expand.
- **Approvals:** the only place an owner decision can happen.
- **Fact-check:** each claimed figure next to what's on file.
- **Where files went:** lineage, showing that a summary keeps its sources'
  sensitivity.
- **Scorecard:** the same checks as `npm test`, run live.

## Videos

- **`assets/briefing-60s.mp4`:** a 60-second narrated morning briefing. A local
  neural voice (Kokoro-82M via `kokoro-onnx`; no API, no cost) reads a script
  generated by `src/narration.js` from the log. It runs about 60 s at -16 LUFS.
- **Three-minute product demo:** a separate pipeline (`video/voice3.py`,
  `video/captions/`, `video/motion/`, driven by `video/script/demo-script.json`)
  that uses the same voice.

Both are reproducible. Setup and commands are in [`video/README.md`](video/README.md).

## Tests and CI

```bash
npm run test:unit        # node --test tests/unit/*.test.js
npm run score            # classifier vs ground truth (30 files)
npm run score:scenarios  # 10 scenarios x 3 checks
```

- **Unit tests** (`tests/unit/`) cover the classifier, config, fact-check,
  prompt injection, lineage, payments, policy, the HTTP server and the store.
- **Scorers** (`tests/score_*.js`) use the same scoring code as the live
  Scorecard tab (`src/score.js`).
- **CI** (`.github/workflows/ci.yml`) runs `npm test` on Node 18, 20 and 22 for
  every push to `main` and every pull request.

## Project layout

```
src/        gate engine (chaperone.js), classifier, lineage, fact-check, store,
            briefing + narration, scenario runner, shared scorer, HTTP app + server
web/        owner-facing UI (index.html, style.css)
rules/      policy (19 rules), taxonomy (4 levels), scenarios (kit + extra), ground truth
data/       Lumen Studio sample files (kit data + 3 new test files)
agents/     prompts for the 5 workers and the Chaperone oversight agent
tests/      unit tests (node:test) and the classifier and scenario scorers
reports/    machine-readable score reports (rewritten by npm test)
logs/       append-only action logs (JSONL)
video/      reproducible video pipelines (see video/README.md)
assets/     rendered videos
design-system/  UI design tokens and guidelines
```

## Principles

- **No invented figures.** Every number in the UI, the briefing and the videos
  traces to a file in `data/` or to the engine's own logged run. The engine
  itself contains no hard-coded names, paths or amounts; clients, suppliers,
  price floors, limits and contract clauses are all looked up from `data/` and
  `rules/`.
- **One gate, one log.** No other path can act. Every decision carries rule IDs
  and quoted evidence.
- **Content is data.** Instructions found inside files or emails are never
  followed.
- **The owner decides.** HOLD items wait for an explicit yes or no, and NEVER
  items can't be approved at all.
