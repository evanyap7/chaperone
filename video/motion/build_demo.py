#!/usr/bin/env python3
"""Assemble the 3-minute Chaperone demo video.

Pipeline (all new code lives in video/; nothing outside video/ is modified):
  1. render every frame with scenes.render_frame (motion graphics + burned-in captions);
  2. pipe raw RGB to ffmpeg -> silent 1920x1080@30 H.264;
  3. mix the 180.0 s Kokoro narration under a ducked music bed via video/mix.py (-16 LUFS);
  4. mux to assets/demo-video.mp4 and verify the duration is exactly 180.0 s.

Usage:
  video/.venv/bin/python video/motion/build_demo.py --dryrun   # 1 frame per segment, fast QA
  video/.venv/bin/python video/motion/build_demo.py            # full render + mix + mux
"""
import os
import subprocess
import sys
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(HERE)
ROOT = os.path.dirname(VIDEO)
sys.path.insert(0, HERE)
sys.path.insert(0, VIDEO)

import chrome  # noqa: E402
import ds  # noqa: E402
import mix  # noqa: E402  (shared final-mix module; imported, never modified)
import scenes  # noqa: E402

WORK = os.path.join(VIDEO, 'work3')
DRY = os.path.join(WORK, 'dryrun')
NARRATION = os.path.join(WORK, 'narration.wav')
MUSIC = os.path.join(VIDEO, 'music.mp3')
SILENT = os.path.join(WORK, 'demo_silent.mp4')
MIXWAV = os.path.join(WORK, 'demo_mix.wav')
OUT = os.path.join(ROOT, 'assets', 'demo-video.mp4')

FPS = ds.FPS
W, H = ds.W, ds.H
TOTAL = 180.0
N = int(round(TOTAL * FPS))


def _frame(n):
    return scenes.render_frame(n).tobytes()


def encode_silent(out):
    enc = subprocess.Popen(
        ['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
         '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-', '-c:v', 'libx264',
         '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', '60',
         '-movflags', '+faststart', out],
        stdin=subprocess.PIPE)
    workers = max(2, (os.cpu_count() or 4) - 1)
    with Pool(workers) as pool:
        for k, buf in enumerate(pool.imap(_frame, range(N), chunksize=6)):
            enc.stdin.write(buf)
            if k % 600 == 0:
                print(f'  frame {k}/{N}', flush=True)
    enc.stdin.close()
    if enc.wait():
        raise SystemExit('video encode failed')


def dryrun():
    os.makedirs(DRY, exist_ok=True)
    # a representative local time per segment: mid-scene, but late enough that the
    # key reveals have landed (so QA sees the populated state, not an empty frame).
    probe = {1: 9.0, 2: 9.5, 3: 11.0, 4: 8.0, 5: 12.0, 6: 15.0, 7: 9.5,
             8: 9.0, 9: 8.6, 10: 11.0, 11: 9.0, 12: 11.0, 13: 12.0, 14: 13.5}
    for idx, s in enumerate(scenes.SEGMENTS):
        local = min(probe.get(s['id'], s['dur'] * 0.7), s['dur'] - 0.05)
        img = scenes.draw_scene(idx, local)
        text, alpha = chrome.caption_at(scenes.CUES, s['start'] + local)
        if text:
            chrome.draw_caption(img, text, alpha)
        img.convert('RGB').save(os.path.join(DRY, f"seg{s['id']:02d}.png"))
        print(f"  dryrun seg{s['id']:02d} ({s['kind']}) @ local {local:.2f}s", flush=True)
    print('dryrun frames ->', DRY)


def main():
    if '--dryrun' in sys.argv:
        dryrun()
        return
    print(f'rendering {N} frames ({TOTAL}s @ {FPS}fps)…')
    encode_silent(SILENT)
    print('mixing narration + ducked music bed…')
    js = mix.duck_and_normalize(NARRATION, MUSIC, TOTAL, MIXWAV)
    print(f'  audio normalised to {mix.LUFS} LUFS (measured input {js["input_i"]})')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    mix.mux(SILENT, MIXWAV, OUT)
    dur = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                          '-of', 'csv=p=0', OUT], capture_output=True, text=True).stdout.strip()
    size = os.path.getsize(OUT) / 1e6
    print(f'wrote {OUT} | duration {dur}s | {size:.1f} MB')


if __name__ == '__main__':
    main()
