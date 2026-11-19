# Video production pipeline

Both videos in `assets/` are produced deterministically from the engine's own
output — no figure is typed in by hand.

## `briefing-60s.mp4` (60-second narrated morning briefing)

Requires: macOS (`say`), `ffmpeg`, Python 3 + Pillow.

```bash
mkdir -p /tmp/chaperone_video
node video/dump_briefing.mjs /tmp/chaperone_video/briefing.json  # fresh engine run
python3 video/render.py /tmp/chaperone_video                   # slides + narration
python3 video/assemble.py /tmp/chaperone_video                 # -> assets/briefing-60s.mp4
```

- `dump_briefing.mjs` runs all 10 scenarios through a fresh Chaperone engine and
  dumps the briefing, including per-segment narration text and slide metadata.
- `render.py` renders one 1920x1080 slide per segment (exact figures from the
  engine) and synthesizes narration with `say -v Samantha`. Pacing pads bring
  the total to 60s.
- `assemble.py` joins the clips and mixes `music.mp3` (QwenWork-generated
  instrumental) under the narration.
- `title_artwork.png` is QwenWork-generated cover art.

## `demo-video.mp4` (live UI demo)

Requires: Node + `playwright-core`, a Playwright Chromium build, `ffmpeg`.

```bash
node src/server.js &                     # fresh server on :8081
npm i --prefix /tmp/chaperone_demo playwright-core
node video/record_demo.mjs /tmp/chaperone_demo   # records the full tab tour
python3 video/assemble_demo.py /tmp/chaperone_demo  # -> assets/demo-video.mp4
```

`record_demo.mjs` starts the demo, waits for completion by polling
`/api/health` from Node (deterministic), then tours every tab and captures a
screenshot per step for verification. `assemble_demo.py` bookends the recording
with `demo_title.png` / `demo_end.png` and the same soundtrack.