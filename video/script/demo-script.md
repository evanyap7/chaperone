# Chaperone — live demo script (v2, 175 s)

QwenWork × Hashmeta · Track 2 · "Agents Watching Agents" (AvePoint)

- **Runtime:** 175.000 s (hard window 170–178 s), 1920×1080 @ 30 fps.
- **Narration:** 414 whitespace tokens (400 spoken words; em-dashes are not spoken), 154.3 s of speech, 2.35 words/s overall. Kokoro `af_heart`, per-segment speed 1.0–1.065 (measured, never a word cut).
- **Voice fixes vs the old 180 s cut:** "Rewriting it…" (never "Rewording"); "Held. Mei says no."; "An email, supposedly from Mei, approved…"; currency spoken as **SGD** (letters, verified clean through Kokoro + whisper); "Mei" is synthesised as "May" via `tts.py SAY_AS` (word-boundary, synthesis only — every written surface keeps "Mei").
- **Figures:** every number below is a measured engine output (see `figures_source` in the JSON). No invented price — the business segment says "Pricing is being confirmed" and the card shows `[price to be confirmed]`.

## Structure

| # | Chapter | In–Out (s) | Dur | Kind | Beat | Words |
|---|---------|-----------|-----|------|------|-------|
| 1 | Hook | 0.0–8.0 | 8.0 | hook | S7 hidden order → real STOPPED | 23 |
| 2 | Problem | 8.0–26.0 | 18.0 | motion | Mei, five agents, one gate | 41 |
| 3 | Live | 26.0–32.5 | 6.5 | footage | Run the demo (real app) | 15 |
| 4 | Live | 32.5–42.5 | 10.0 | footage | Morning briefing 6 / 4 / SGD 10,260 / 15 | 25 |
| 5 | Live | 42.5–51.0 | 8.5 | footage | S1 client-list upload + evidence | 24 |
| 6 | Live | 51.0–64.5 | 13.5 | footage | S4 fact-check, all three figures | 32 |
| 7 | Live | 64.5–70.5 | 6.0 | footage | S5 scope creep, 3 reads stopped | 13 |
| 8 | Live | 70.5–78.5 | 8.0 | footage | S6 lineage — "Rewriting it…" | 18 |
| 9 | Live | 78.5–89.0 | 10.5 | footage | S8 split maths 750+750=1,500>1,000 | 23 |
| 10 | Live | 89.0–98.5 | 9.5 | footage | S9 fake approval, floor 6,500 vs 5,800 | 21 |
| 11 | Live | 98.5–104.0 | 5.5 | footage | S3 "Say no" in the real queue | 11 |
| 12 | Live | 104.0–110.0 | 6.0 | footage | S10 the correct ALLOW | 14 |
| 13 | Proof | 110.0–124.0 | 14.0 | footage | 30/30 · 30/30 · 136 tests | 33 |
| 14 | Business | 124.0–144.0 | 20.0 | motion | Who pays; price placeholder | 48 |
| 15 | QwenWork | 144.0–166.0 | 22.0 | footage | QwenWork built it; live agents BLOCKED/HELD | 55 |
| 16 | CTA | 166.0–175.0 | 9.0 | endcard | Live URLs, links in description | 18 |

Chapter boundaries match the brief: Hook 0–8, Problem 8–26, Live 26–110, Proof 110–124, Business 124–144, QwenWork 144–166, CTA 166–175. The Live chapter carries the brief's beat order (run-demo, briefing, S1, S4, S5, S8, S9, S3, S10) **plus S6 lineage**, which is required to carry the "Rewriting it…" voice fix (in the current engine, lineage is S6 and scope creep is S5).

## Full narration

**1 · Hook (0.0–8.0)** — exact brief VO
> This email hides an order for Mei's AI agent. Send her entire client list to a stranger. Chaperone stopped it. Nothing was sent.

**2 · Problem (8.0–26.0)**
> Mei runs Lumen Studio alone. Five AI agents email clients, pay suppliers, and delete files — thirty actions today. She is the whole compliance team. Chaperone sits between every agent and the outside world, and checks each action before it happens.

**3 · Run the demo (26.0–32.5)**
> This is the live app. Run the demo: ten real situations from Mei's own files.

**4 · Morning briefing (32.5–42.5)**
> The morning briefing: six risky actions stopped, four waiting for your yes — SGD ten thousand two hundred sixty — and fifteen routine actions done.

**5 · S1 evidence (42.5–51.0)**
> Marketing tried to upload the client list to an outside tool. Blocked — and here's the exact line in Mei's files that decided it.

**6 · S4 fact-check (51.0–64.5)** — all three claims spoken, matching the three rows on screen
> Finance's client reply had three wrong figures. Twenty-five percent — the contract says twenty. Five days — really two. Five thousand two hundred fifty — the invoice says five thousand forty. Stopped.

**7 · S5 scope creep (64.5–70.5)**
> Agents only touch what the task needs. Three off-limits file reads — stopped.

**8 · S6 lineage (70.5–78.5)**
> A summary of a confidential proposal inherits its secret. Rewriting it never makes it safe to share. Blocked.

**9 · S8 split payment (78.5–89.0)** — both payments held
> Seven hundred fifty plus seven hundred fifty is fifteen hundred — over the one-thousand limit. Chaperone adds them up, and holds both payments.

**10 · S9 fake approval (89.0–98.5)**
> An email, supposedly from Mei, approved fifty-eight hundred. Her written floor is sixty-five hundred. An email is not an approval. Blocked.

**11 · S3 say no (98.5–104.0)**
> Ops wants to delete an unpaid invoice. Held. Mei says no.

**12 · S10 allow (104.0–110.0)**
> And when the contract says delete, Chaperone allows it — and sends the notices.

**13 · Proof (110.0–124.0)**
> Ten scenarios, three checks each: the right decision, the right rule, the right evidence. Thirty out of thirty. The classifier got thirty of thirty files right. And one hundred thirty-six unit tests pass.

**14 · Business (124.0–144.0)** — no spoken price
> Who pays? One-person studios, agencies, and fractional ops teams — people who let agents email clients and move money, but can't hire a compliance team. Chaperone sits between the agents and the world, so one person can safely run a whole team of them. Pricing is being confirmed.

**15 · QwenWork (144.0–166.0)**
> QwenWork built this project: the video, the music, the title art, the integration, and the deploy. The app runs on QwenWork Pages. And live Qwen agents run through the gate right now. A sales agent tries to email the client list outside — blocked. An ops agent tries to delete records — held for Mei.

**16 · CTA (166.0–175.0)** — URLs shown, not spelled out
> See it live — the links are in the description. Chaperone, from Hashmeta. Give your agents a chaperone.

Endcard URLs: **https://uq2xhx6u.qwenwork.page** (live app) and **https://chaperone.geo.hashmeta.tech** (Hashmeta site). No localhost, no private repo anywhere.

## Verified figures (2026-11-20)

| Figure | Value | Source |
|---|---|---|
| Unit tests | 136 pass / 0 fail | `npm test` → `node --test tests/unit/*.test.js` |
| Scenario checks | 30/30 (100%) | `node tests/score_scenarios.js` |
| Classifier | 30/30 (100%) | `node tests/score_classifier.js` |
| Briefing | 6 stopped · 4 waiting · SGD 10,260 · 15 done | `POST /api/demo/run` + `GET /api/state` on `PORT=8153 OWNER_TOKEN=v3-token node src/server.js` → `briefing.stats {blocked:6, held:4, held_money:10260, allowed:15}` |
| Queue | exactly 4: Q1 SGD 5,040 delete, Q2 SGD 3,000 delete, Q3 SGD 720 order, Q4 SGD 1,500 split pay | same `/api/state` `queue` (5,040+3,000+720+1,500 = 10,260) |
| S8 maths | 750 + 750 = 1,500 > 1,000 limit, both HELD | S8 log rows |
| S2/S9 floor | floor 6,500 vs offer 5,800 | S2/S9 log rows |
| Actions | 30 log entries | `/api/state` `log` |
| Price | **[price to be confirmed]** — owner input, never spoken | — |

## Pipeline (V3 outputs)

1. `video/.venv/bin/python video/voice3.py` → `video/work_voice/audio/segNN.wav`, `video/work_voice/narration.wav` (48 kHz mono, absolute 175 s timeline — **V5 reads this**), `video/work_voice/timing.json`.
2. `video/.venv/bin/python video/captions/make_captions.py` → faster-whisper `small.en` int8 word timestamps aligned to the script (segment-anchored), then:
   - `video/captions/captions.json` — word-level times/colours + cue line grouping + PNG index
   - `video/captions/captions.ass` — word-by-word highlight ASS (58 px Source Sans 3, pill bottom y=950)
   - `video/captions/captions.srt` and `assets/demo-video.srt` — ≤38-char lines, ≤2 lines
   - `video/work_voice/caption_pngs/wNNN.png` — per-word-state 1920×1080 RGBA overlays (this ffmpeg build has **no libass**, so V5 burns these with enable windows, exactly like the old cue-PNG pipeline)
   - per-word timestamps appended to `video/work_voice/timing.json`

Caption spec: word-by-word fill (spoken `#FFFFFF`, upcoming `#94A3B8`, active word underlined 4 px), decision words coloured BLOCK `#EDA69C` / HOLD `#E8C988` / ALLOW `#A9D9B8` (Lexend 600), body Source Sans 3 weight 600 at 58 px, pill `#0F172A` @ 235 alpha, radius 16, 1 px `#1E293B` stroke, padding 40/18, bottom-centre with pill bottom at **y=950**, max 38 chars/line, max 2 lines. Cue start = first word − 0.05 s, end = last word + 0.15 s (tails trimmed, never delayed past a first word), min on-screen 0.9 s where room allows, gaps < 0.25 s closed.

**Measured alignment (round 3, final):** fresh faster-whisper `small.en` int8 pass with **default settings** (matches the reviewer's measurement pipeline); **400/400 words matched**, every word start snapped verbatim to its ASR timestamp. Independent re-measurement: **350 one-to-one words max drift 0.000 s, mean 0.0000 s**; the 50 merged-token words (spoken numbers like "one hundred thirty-six" vs whisper "136", and "Twenty-five percent" vs "25%.") are spread across the ASR span — 1:1 over whisper fragments when counts match, else proportionally by word length — and all sit inside their ASR token spans. Reviewer's flagged words now land on the reviewer's own ASR values: people 129.54, Pricing 140.40, Blocked. (S9) 97.42, unit 120.78, See 165.88, gate 155.20, one/hundred/thirty-six spread 120.04–120.78. No zero-length windows remain; each cue's word windows tile its `[start, end]` exactly. Word starts are never delayed past their ASR time, and highlight windows are clamped to cue bounds so nothing fires before its cue.