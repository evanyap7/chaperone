# Chaperone

An oversight agent that watches AI worker agents for a one-person company.
Built for the QwenWork x Hashmeta AI One-Person Company Hackathon — Track 2
(AI Governance, Security & Decision-Making), on AvePoint's "Agents Watching
Agents" starter kit.

**Status: Phase 1 complete** — sensitivity classifier scored 27/27 (100%)
against `rules/ground_truth_labels.json`, no mismatches. Full documentation
lands with the final phase.

## Quick start

```bash
npm run score   # classify every data file, score against ground truth
```

No dependencies, no API keys — Node.js 18+ only.