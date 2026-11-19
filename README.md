# Chaperone

An oversight agent that watches AI worker agents for a one-person company.
Built for the QwenWork x Hashmeta AI One-Person Company Hackathon — Track 2
(AI Governance, Security & Decision-Making), on AvePoint's "Agents Watching
Agents" starter kit.

**Final scores: classifier 30/30 (100%) · scenario checks 30/30 (100%).**
Every decision carries rule IDs and evidence quoted from real files.

## What it is

Lumen Studio is a one-person company. Mei (the owner) runs five AI worker
agents — Marketing, Sales, Ops, Finance, Support. Chaperone is the sixth
agent: the only one with authority. Every worker action goes through a single
logged gate; nothing else can send, pay, publish, delete or sign.

Per action, the gate:

1. **Classifies** every touched file by content (not filename) into
   public / internal / confidential / regulated, with a cited evidence line.
2. **Tracks lineage** — summaries, rewords and splits inherit the highest
   sensitivity of their sources; laundering never downgrades.
3. **Checks scope** against the task's declared file needs; out-of-scope
   regulated reads are blocked, other creep is logged.
4. **Applies `rules/policy.json`** → ALLOW / HOLD_FOR_APPROVAL / BLOCK.
   NEVER rules are unapprovable — even by messages claiming to be Mei.
5. **Fact-checks** outbound figures, dates and commitments against source
   files (claimed vs on-file, with file:line quotes); untraceable = fabricated.
6. **Aggregates payments** per invoice and per supplier over 24h, catching
   split payments.
7. **Scans inbound content for prompt injection** — file and email text is
   always data, never instructions.
8. **Logs everything**: time, agent, action, files, data level, outcome,
   rules, and evidence as direct quotes with file paths.

Held actions wait in Mei's approval queue (deduped — she is never nagged
twice). Each morning she gets a plain-words briefing and a 60-second video.

## Results

| Evaluation | Score |
|---|---|
| Sensitivity classifier vs ground truth (27 kit files + 3 new) | **30/30 · 100%** |
| Kit scenarios S1–S5 (decision + rules + evidence, 3 pts each) | **15/15 · 100%** |
| New scenarios S6–S10 (same 3 checks) | **15/15 · 100%** |

New scenarios: S6 lineage laundering (regulated summary stays regulated),
S7 prompt injection in a vendor email, S8 payment splitting under the
approval threshold, S9 fake owner approval by email, S10 regulated data
received in error — contract-mandated notification allowed, retention blocked.

Reports: `reports/classifier_score.json`, `reports/scenario_score.json`.

## Quick start

```bash
npm run score        # classifier vs ground truth (30 files)
npm test             # all 10 scenarios through the gate, 30 checks
npm start            # live app on http://localhost:8081
```

No dependencies, no API keys — Node.js 18+ only.

In the app: **Run demo** replays all 10 scenarios (30 actions) through the
live gate; the log, evidence, approval queue, fact-check table, lineage chain
and scorecard update live. Owner decisions happen only in the Approvals tab.

## Layout

```
rules/    policy, taxonomy, scenarios (kit) + scenarios_extra, ground_truth_extra
data/     kit data + 3 new test files (injection email, fake approval, split invoice)
agents/   5 worker prompts + Chaperone oversight prompt
src/      classifier, gate engine, lineage, fact-check, scope, store,
          briefing, scenario runner, shared scorer, server
web/      Mei-facing UI (live log, evidence, queue, facts, lineage, scorecard)
tests/    classifier + scenario scorers (same checks as the live scorecard)
video/    reproducible production pipeline for both videos (see video/README.md)
assets/   briefing-60s.mp4 (narrated briefing) · demo-video.mp4 (live UI demo)
reports/  machine-readable score reports
```

## Design for Mei

Plain words, large type, calm colours. Rule IDs appear only in "details"
lines. No invented figures anywhere — every number in the UI, the briefing
and both videos traces to a file or to the engine's own run.