# V1 FOOTAGE recorder

Real Playwright screen captures of the running Chaperone app, one clip per demo beat.
Output: `video/work_footage/<beat>.mp4` + `manifest.json` + `acceptance.json` + verification frames in `frames/`.

## Re-run

```sh
cd video/record
npm install            # once; playwright-core is local to this dir
node record_footage.mjs            # all 10 beats, fresh server, ~3 min
node record_footage.mjs s8 s3-deny # re-record selected beats only
```

The script spawns its OWN server (`PORT=8150 OWNER_TOKEN=footage-token node src/server.js`),
records, and kills only that child PID in `finally`. It refuses to start if port 8150 is
already occupied. Env overrides: `PORT`, `OWNER_TOKEN`, `CHROME_PATH`, and `BASE_URL`
(record against an existing server instead of spawning one; state must be fresh for `run-demo`).
When `run-demo` is not in the requested beat list, state is populated via `POST /api/demo/run` first.

Chromium: full "Google Chrome for Testing" from `~/Library/Caches/ms-playwright/chromium-*`
(headless new mode), viewport 1920x1080 @1x.

## Capture technique (documented choice)

- CDP `Page.startScreencast` (`everyFrame`, JPEG q92, 1920x1080). Frames are timestamped and
  assembled with the ffmpeg concat demuxer, then resampled to constant **60 fps** H.264 CRF 18
  (`fps=60:round=near`). Static holds emit few frames and are held for their real duration;
  animations and cursor moves are captured at compositor rate. This is true 60 fps output,
  not duplicated 25 fps webm.
- Playwright draws no cursor, so a synthetic macOS-style arrow + click pulse is injected via
  `addInitScript` (pointer-events: none, recording aid only — all UI data is the real app).
  Moves are eased glides (~30 steps), with 300–1000 ms holds before deliberate clicks.
- Clips must be 6–14 s. The full demo run is ~18 s, so `run-demo` is time-compressed
  (speed_factor in manifest, ~1.9x); long beats are compressed mildly (<=1.4x). Everything
  else is real time. `what_it_shows` in the manifest describes each clip.

## Beats (recording order)

run-demo, briefing, s1, s7, s4, s5, s8, s9, s10, scorecard, s3-deny.
`s3-deny` is last because it changes queue state (denial stands, append-only engine).
`s5` applies its Support filter in a pre-capture setup so the blocked reads read from frame one.

## Pitfalls handled (keep these if you edit the script)

- Log filters persist across tab switches: reset outcome/agent filters explicitly per beat.
- Window scroll: the final UI scrolls to top on every tab change; the script still calls
  `scrollToY(0)` (harmless no-op) and `glideTo` auto-scrolls offscreen targets smoothly.
- The undo countdown (8 s) pauses ONLY while the Undo button has keyboard focus
  (`:focus-visible`), with a visible "Paused — press Undo to change your mind, or move focus
  away to resume." hint. A resting mouse never freezes it. The s3-deny beat demonstrates this:
  click Say no (mouse), Shift+Tab then Tab back onto Undo to trigger the visible paused state,
  hold, then click empty space to move focus away; the countdown resumes and commits. The beat
  waits for `#decidedWrap` to appear, not a fixed sleep.
- Rows/cards are located by ids resolved from `/api/state` (scenario+action+decision), never
  hard-coded, so concurrent engine/UI edits don't break selectors.

## Round 3 (hook beat, 20 Nov 2026)

Added the `s7` beat (now in ALL_BEATS after s1): Live log, Stopped filter, the S7
prompt-injection send_email BLOCK row expanded — Stopped + Hidden instruction badges, the
injection quote from inbox/2026-11-16_vendor_injection.md line 13, the client_list.csv
personal-data evidence, and the "treated as information" note. 9.5 s, real time; the last
~4 s hold on the expanded evidence is the hook's "real log footage" cut.
Also re-recorded `s5` per reviewer note 8: the Support filter is now applied in a pre-capture
setup phase (`BEAT_SETUP`), so the HOLD row and all three blocked "Not needed" reads are
visible from frame one; the clip then expands the HOLD row and settles back on the reads.
manifest.json and acceptance.json merge across partial runs (11 clips total).

## Round 2 (final UI, 20 Nov 2026)

Re-recorded all 10 beats after W1's fixes and the final engine (136/136 tests, 30/30 scenarios).
Measured demo run, click to "Demo complete": **17.83 s** (matches the UI's "about 18 seconds").
Verified on the final footage: tab changes land at the top of the page; the Say-no beat shows
the new visible Paused hint (frozen at 8s) and the denial toast + Already decided; waiting
counts are single-source (Today "4 things need your yes", Approvals badge 4, log summary
"5 held actions → 4 decisions for you"); the S8 card shows "750 + 750 = 1,500 > 1,000".
No remaining UI oddities found.