# Video production

Both videos are rendered from the engine's own output, so no figure is typed in
by hand. Each pipeline lives in its own files:

| Video | Length | Pipeline | Output |
|---|---|---|---|
| Morning briefing | 60 s | `dump_briefing.mjs` → `render.py` → `assemble.py` | `assets/briefing-60s.mp4` |
| Product demo | 180 s | `voice3.py` + `captions/` + `motion/` (driven by `script/demo-script.json`) | see below |

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
- **Final mix (`mix.py`):** the music is ducked under the voice with
  `sidechaincompress`, then the mix is loudness-normalized in two passes to
  -16 LUFS, with true peak at or below -1.5 dBTP after AAC encoding.

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

## The 3-minute demo: a separate pipeline

The 180-second product demo is built by a separate pipeline, owned and run
separately from the briefing. Its files are:

- **`script/demo-script.json`** (the human-readable twin is `demo-script.md`):
  14 timed segments adding up to 180.0 s, with narration, captions and the
  source of every figure.
- **`voice3.py`** (step A) synthesizes each segment's narration with the shared
  `tts.py`. It checks that every line fits its slot; if one overruns, it raises
  the speed slightly rather than cutting words. It writes
  `work3/narration.wav` and `work3/timing.json`.
- **`captions/make_captions.py`** (step B) re-times the script's caption cues
  against the measured audio. It writes `captions.ass`, `captions.srt` and
  per-cue PNG overlays that get burned in.
- **`motion/ds.py`** is the drawing kit for the motion graphics. It mirrors
  `design-system/chaperone/` (Lexend, Source Sans 3 and JetBrains Mono, fetched
  by `motion/fetch_fonts.sh` into the gitignored `motion/fonts/`).

`record_demo.mjs`, `assemble_demo.py` and `demo_voiceover.json` are an earlier
Playwright tour of the live UI. They record the app, then add a title card, an
end card and a voiceover.

## Assets

- **`music.mp3`:** instrumental bed generated with QwenWork.
- **`title_artwork.png`:** cover art generated with QwenWork, used on the
  briefing's title slide.
- **`demo_title.png` / `demo_end.png`:** bookend cards for the UI tour.
