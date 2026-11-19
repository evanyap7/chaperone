# Video production

Both videos are rendered from the engine's own output, so no figure is typed in
by hand. Each pipeline lives in its own files:

| Video | Length | Pipeline | Output |
|---|---|---|---|
| Morning briefing | 60 s | `dump_briefing.mjs` → `render.py` → `assemble.py` | `assets/briefing-60s.mp4` |
| Product demo | 175 s | `record/` → `voice3.py` → `captions/` → `motion/scenes_final.py` → `assemble_final.py` | `assets/demo-video.mp4` |

Both use the same local voice (`tts.py`), so they sound like the same person.

## The voice: Kokoro-82M, local

`tts.py` wraps [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) through
`kokoro-onnx`. It runs on the CPU, needs no API key and costs nothing to run.

- **Voice:** `af_heart` (80%) blended with `af_bella` (20%), at speed 1.0.
- **Natural pacing:** each sentence is synthesized separately, with a slightly
  varied pause after it and a small speed drift of ±2.5%, so the delivery
  doesn't sound flat. The variation is seeded from the text, so re-runs come
  out identical, sample for sample.
- **Pronunciation fixes, speech only:** Mei → "May", cashflow → "cash-flow",
  QuickPrint → "Quick Print". On-screen text is not changed.
- **Polish (ffmpeg):** 80 Hz high-pass, a gentle de-esser and light compression.
- **Final mix (`mix.py`):** the music is ducked under the voice
  (`MUSIC_GAIN 0.16`, sidechain ratio 4, release 1100 ms), limited at −3 dBFS,
  loudness-normalized to −16 LUFS, AAC 320k. **The build fails if true peak is
  above −1 dBTP.**

### One-time setup

Needs [uv](https://docs.astral.sh/uv/) and ffmpeg.

```bash
video/setup_tts.sh
```

This creates `video/.venv` (Python 3.12) with `kokoro-onnx==0.6.1`, soundfile,
numpy and Pillow. It then downloads `kokoro-v1.0.onnx` and `voices-v1.0.bin`
(about 350 MB) into `video/models/`. Both folders are gitignored.

To try the voice on its own:

```bash
video/.venv/bin/python video/tts.py "Morning, Mei. Here's how your agents got on." /tmp/hello.wav
```

## `briefing-60s.mp4`: the 60-second morning briefing

```bash
W=/tmp/chaperone_briefing && mkdir -p $W
node video/dump_briefing.mjs $W/briefing.json   # fresh engine run of all 10 scenarios
video/.venv/bin/python video/render.py $W        # slides + voice + timeline (manifest.json)
video/.venv/bin/python video/assemble.py $W      # -> assets/briefing-60s.mp4
```

The full run takes about a minute on a laptop.

- **The script:** `src/narration.js` (`buildNarration`) writes it from the log
  and the approval queue. It is written to be spoken to the owner: money first,
  plain words, no rule IDs. Every count, amount, name and file label is derived
  from the logged actions, and no claim is made unless the log supports it.
- **`render.py`** draws one 1920×1080 slide per segment in Avenir Next on the
  brand colours: paper `#faf7f1`, ink `#2c2721`, teal `#2f7f6f`. The slide
  types are title, stat, fact-check (claimed vs on file), shield, eye and done.
  It then synthesizes each line and lays out the timeline. Gaps between lines
  are sized so the video lands on `VIDEO_SECONDS` (default 60).
- **`assemble.py`** adds a slow Ken Burns move (sub-pixel affine, so text never
  shimmers), smoothstep crossfades and a fade from paper at both ends. It then
  mixes in the ducked music bed (`music.mp3`) through `mix.py`.
  - **Rendering:** frames are drawn in parallel, but each worker encodes its own
    3-second chunk with its own ffmpeg process. The chunks are then joined
    losslessly. No pipe is shared between processes, and every wait has a
    timeout (`ASSEMBLE_TIMEOUT`, default 900 s), so the render cannot hang.

Settings (environment variables):

| Variable | Default | Effect |
|---|---|---|
| `VIDEO_SECONDS` | `60` | Target length; the gaps between lines stretch or shrink to fit. |
| `TTS_VOICE` | `af_heart:0.8,af_bella:0.2` | Kokoro voice, or a weighted blend. |
| `TTS_SPEED` | `1.0` | Base speaking rate. |
| `ASSEMBLE_TIMEOUT` | `900` | Seconds before a stuck frame render is aborted. |

Checks used on the current render:

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 assets/briefing-60s.mp4
ffmpeg -nostats -i assets/briefing-60s.mp4 -af ebur128=peak=true -f null - 2>&1 | tail -12
```

## The 175-second demo: real footage + motion graphics

The product demo is built from **real Playwright screen recordings of the
running app**, composited with motion graphics, neural narration and
word-by-word captions. Its files:

- **`record/record_footage.mjs`** records the app (1920×1080, true 60 fps via
  CDP screencast) — one clip per beat: run-demo, briefing, S1, S4, S5, S7, S8,
  S9, S10, S3 "Say no", scorecard. Clips + `manifest.json` land in
  `work_footage/`. Re-run all beats or a subset: `node record_footage.mjs s8 s9`.
- **`script/demo-script.json`** (twin: `demo-script.md`): schema_version 2,
  timed segments adding up to 175.0 s, with narration, on-screen specs and the
  source of every figure (~415 words).
- **`voice3.py`** synthesizes each segment with the shared `tts.py` (Mei is
  spoken as "May"; captions keep "Mei"), measures durations and writes
  `work_voice/narration.wav` + `timing.json`.
- **`captions/make_captions.py`** aligns words with faster-whisper timestamps
  (drift < 0.15 s) and writes `captions.json`, `captions.ass` (word-by-word
  highlight, ≤38-char lines, Source Sans 3 58 px at y≈950, decision colours
  BLOCK `#EDA69C` / HOLD `#E8C988` / ALLOW `#A9D9B8`), `captions.srt` and the
  per-word PNGs. `assets/demo-video.srt` is the exported subtitle file.
- **`motion/ds.py` + `motion/footage.py`** are the drawing kit: decision stamps,
  highlight boxes, the rounded-frame footage compositor with slow push-in,
  agent→gate→world flow lines, the animated S8 maths (750 + 750 = 1,500 > 1,000),
  counters and the chapter progress bar. **`motion/scenes_final.py`** dispatches
  every segment (hook, problem kinetic type, footage beats, proof, business,
  QwenWork, CTA).
- **`work_qwen/`** holds the QwenWork-segment recordings: live agents BLOCKED
  and HELD in the app, plus the real terminal output of the PreToolUse hook
  adapter (see `integrations/qwenwork/`).
- **`assemble_final.py`** composites everything: frames → H.264 CRF 18
  (8–12 Mbps) → mix via `mix.py` → burn captions → `assets/demo-video.mp4`.
  `--dryrun` renders one still per segment. It also regenerates the contact
  sheet (one frame every 10 s) in `work_final/`.

```bash
cd video/record && node record_footage.mjs        # real app footage
video/.venv/bin/python video/voice3.py            # narration + timing
video/.venv/bin/python video/captions/make_captions.py
video/.venv/bin/python video/assemble_final.py    # -> assets/demo-video.mp4
```

Checks used on the current render:

```bash
ffprobe -v error -show_entries format=duration -of csv=p=0 assets/demo-video.mp4   # 175.0
ffmpeg -nostats -i assets/demo-video.mp4 -af ebur128=peak=true -f null - 2>&1 | tail -12
# I: -16.0 LUFS, true peak: -3.0 dBFS (build fails above -1 dBTP)
```

`youtube.md` is the upload kit (title, chaptered description, tags). The
thumbnail is `assets/thumbnail.png` (1280×720, red BLOCKED stamp over a real UI
frame). `motion/build_demo.py`, `record_demo.mjs`, `assemble_demo.py` and
`demo_voiceover.json` are the earlier 180 s motion-graphics-only cut, kept for
reference.

## Assets

- **`music.mp3`:** instrumental bed generated with QwenWork.
- **`title_artwork.png`:** cover art generated with QwenWork, used on the
  briefing's title slide.
- **`demo_title.png` / `demo_end.png`:** bookend cards for the UI tour.
