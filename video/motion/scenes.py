#!/usr/bin/env python3
"""Scene dispatch + frame compositor for the Chaperone 3-minute demo.

render_frame(n) is the single entry point used by build_demo.py: it picks the segment
for global time n/FPS, draws it (with a 0.5 s crossfade out of the previous scene),
burns the caption cue, and applies the global fade in/out. Deterministic and pure.
"""
from PIL import Image

import chrome
import ds
from scenes_motion import SCENES_MOTION
from scenes_ui import SCENES_UI

SCENES = {**SCENES_MOTION, **SCENES_UI}
SEGMENTS = chrome.load_segments()
CUES = chrome.load_captions()
FPS = ds.FPS
W, H = ds.W, ds.H
TOTAL = 180.0
XF = 0.5  # crossfade seconds between scenes


def _seg_at(t):
    """Return (index, local_time) for the segment active at global time t."""
    for i, s in enumerate(SEGMENTS):
        if s['start'] - 1e-6 <= t < s['start'] + s['dur']:
            return i, t - s['start']
    return len(SEGMENTS) - 1, SEGMENTS[-1]['dur']


def draw_scene(idx, local):
    """Render segment idx at local seconds onto a fresh RGBA frame."""
    seg = SEGMENTS[idx]
    base = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    SCENES[seg['id']](base, local, seg)
    return base


def render_frame(n):
    t = n / FPS
    i, local = _seg_at(t)
    img = draw_scene(i, local)
    # dissolve out of the previous scene's end-state during the first XF seconds
    if local < XF and i > 0:
        prev = draw_scene(i - 1, SEGMENTS[i - 1]['dur'])
        img = Image.blend(prev, img, ds.ease_standard(local / XF))
    # burned-in caption
    text, alpha = chrome.caption_at(CUES, t)
    if text:
        chrome.draw_caption(img, text, alpha)
    # global fade in from / out to near-black
    fade = min(1.0, t / 0.5, (TOTAL - t) / 1.5)
    if fade < 1.0:
        black = Image.new('RGBA', (W, H), ds.rgba(ds.DARK_FADE, 255))
        img = Image.blend(black, img, ds.ease_standard(max(0.0, fade)))
    return img.convert('RGB')
