#!/usr/bin/env python3
"""Footage-layer motion primitives for the NEW ~175 s Chaperone cut.

Builds on ds.py (design tokens, fonts, easing). Everything is a deterministic
pure function of (state, time) except the footage disk cache, which is keyed by
clip content and frame index.

Primitives:
  * decision_stamp   — ALLOW / HOLD / BLOCK slam-in stamps (+ solid red STOPPED)
  * highlight_box    — animated rounded-rect outline draw-on, soft glow, label chip
  * composite_footage— rounded frame + soft shadow + slow push-in on dark backdrop
  * get_frame        — real footage from video/work_footage/ (manifest.json) or a
                       styled placeholder panel labelled with the beat name
  * flow_diagram     — agent -> gate -> world with animated dashes / pulses
  * s8_maths         — 750 + 750 = 1,500 > 1,000 animated (real engine figures)
  * counter          — ease-out count-up (30/30, 30/30, unit tests)
  * chapter_bar      — labelled progress bar along the top
  * kinetic_line     — word-stagger slide-up type

Safe zones: the designer's captions burn in a pill whose 2-line top sits at
y~835-850 (PILL_BOTTOM 965, FONT_SIZE 40). Keep scene content above y~815;
composite_footage clamps its box bottom to CAPTION_SAFE_Y by default.
"""
import glob
import json
import math
import os
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import ds

W, H, FPS = ds.W, ds.H, ds.FPS
HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(HERE)
FOOTAGE_DIR = os.path.join(VIDEO, 'work_footage')
QWEN_DIR = os.path.join(VIDEO, 'work_qwen')
CACHE_DIR = os.path.join(VIDEO, 'work_motion', 'footage_cache')

CAPTION_SAFE_Y = 815          # nothing below this line (2-line caption pill top ~835)
# One stamp voice for the whole film: SOLID semantic fill + white word, -7 deg.
# (The hook's STOPPED style is the template; BLOCK/HOLD/ALLOW now match it.)
STAMP_FILL = {
    'allow': ds.DONE_FG,       # #146C33 green
    'hold': ds.hx('#C2740A'),  # vivid amber-dark, white text passes contrast
    'block': ds.BLOCK_FG,      # #B42318 red
    'stopped': ds.BLOCK_FG,
}
STAMP_COLORS = {              # light tints (outline / glow accents only)
    'allow': ds.DONE_BORDER,   # #A9D9B8
    'hold': ds.WAIT_BORDER,    # #E8C988
    'block': ds.BLOCK_BORDER,  # #EDA69C
    'stopped': ds.BLOCK_BORDER,
}
STAMP_WORDS = {'allow': 'ALLOW', 'hold': 'HOLD', 'block': 'BLOCK', 'stopped': 'STOPPED'}
STAMP_SUB = {'allow': 'ALLOW', 'hold': 'HOLD_FOR_APPROVAL', 'block': 'BLOCK', 'stopped': 'BLOCK'}


# ------------------------------------------------------------------ stamps
def decision_stamp(base, cxy, kind, t, t0, size=56, angle=-7, subscript=None,
                   exit_t=None, pad=30):
    """Slam-in decision stamp: scale 1.6->1.0 over 7 frames, rotation settles.

    kind: 'allow' | 'hold' | 'block' | 'stopped'. 'stopped' is the solid red
    variant (BLOCK_FG fill, white word). Outlined variants use the light tint
    on dark. Optional mono API subscript lands 0.22 s after the stamp.
    pad: transparent margin around the stamp layer (smaller = compact header
    variant that never reaches into footage content).
    Returns the stamp's approximate bounding box (for collision checks).
    """
    p = ds.anim(t, t0, 7.0 / FPS)
    if p <= 0:
        return None
    alpha = min(1.0, p * 2.2)
    if exit_t is not None:
        alpha *= 1.0 - ds.anim(t, exit_t, 0.2)
    if alpha <= 0.003:
        return None
    scale = ds.lerp(1.6, 1.0, p)
    ang = ds.lerp(angle - 5.0, angle, p)
    word = STAMP_WORDS[kind]
    col = STAMP_COLORS[kind]
    fill = STAMP_FILL[kind]
    fs = ds.font('heading', 700, max(10, int(size * scale)))
    dtmp = ImageDraw.Draw(Image.new('RGBA', (8, 8)))
    tw = dtmp.textlength(word, font=fs)
    th = size * scale
    bw, bh = int(tw + 44), int(th * 1.5)
    layer = Image.new('RGBA', (bw + pad * 2, bh + pad * 2), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    cxl, cyl = layer.width / 2, layer.height / 2
    rect = [cxl - bw / 2, cyl - bh / 2, cxl + bw / 2, cyl + bh / 2]
    # unified solid-fill stamp (white word) for every decision kind
    ld.rounded_rectangle(rect, radius=12, fill=ds.rgba(fill, 255),
                         outline=ds.rgba(ds.INVERSE, 70), width=2)
    tcol = ds.INVERSE
    ld.text((cxl - tw / 2, cyl - fs.size * 0.62), word, font=fs, fill=ds.rgba(tcol, 255))
    layer = layer.rotate(ang, expand=True, resample=Image.BICUBIC)
    a = layer.getchannel('A').point(lambda v: int(v * alpha))
    layer.putalpha(a)
    x = int(cxy[0] - layer.width / 2)
    y = int(cxy[1] - layer.height / 2)
    base.alpha_composite(layer, (x, y))
    bbox = (x, y, x + layer.width, y + layer.height)
    if subscript:
        pa = ds.anim(t, t0 + 0.22, 0.2) * alpha
        if pa > 0.003:
            f = ds.font('mono', 500, 22)
            d = ImageDraw.Draw(base)
            sw = d.textlength(subscript, font=f)
            ds.fade_layer(base, lambda dd, off: dd.text(
                (cxy[0] - sw / 2 - off[0], bbox[3] + 10 - off[1]),
                subscript, font=f, fill=ds.rgba(ds.ON_DARK_2, 255)), pa,
                box=(int(cxy[0] - sw / 2) - 4, bbox[3], int(cxy[0] + sw / 2) + 4, bbox[3] + 34))
    return bbox


# ------------------------------------------------------------------ highlight
def _rr_perimeter(box, r, n=7):
    x0, y0, x1, y1 = box
    r = min(r, (x1 - x0) / 2, (y1 - y0) / 2)
    pts = [(x0 + r, y0), (x1 - r, y0)]
    corners = [((x1 - r, y0 + r), -90, 0, (x1, y1 - r)),
               ((x1 - r, y1 - r), 0, 90, (x0 + r, y1)),
               ((x0 + r, y1 - r), 90, 180, (x0, y0 + r)),
               ((x0 + r, y0 + r), 180, 270, (x0 + r, y0))]
    for (cx, cy), a0, a1, nxt in corners:
        for i in range(1, n + 1):
            a = math.radians(a0 + (a1 - a0) * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        pts.append(nxt)
    return pts


def highlight_box(base, box, t, t0, color=None, label=None, draw_dur=0.35,
                  glow=True, exit_t=None, label_pos='above', top_limit=None):
    """Rounded-rect outline draws on clockwise (stroke progress 0->1), soft glow.

    Optional label chip sits above (or below) the box — never over its content.
    top_limit: if the 'above' chip would cross this y (e.g. the footage frame's
    top border), the chip flips BELOW the box so no overlay ever straddles the
    frame edge (round-8 P1-A: the chip + outline at the border read as sliced text).
    """
    p = ds.anim(t, t0, draw_dur)
    if p <= 0:
        return
    alpha = 1.0
    if exit_t is not None:
        alpha = 1.0 - ds.anim(t, exit_t, 0.2)
    if alpha <= 0.003:
        return
    color = color or ds.ACCENT
    x0, y0, x1, y1 = [int(v) for v in box]
    pts = _rr_perimeter((x0, y0, x1, y1), 12)
    pad = 16
    lbox = (max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad))

    def draw(dd, off):
        ox, oy = off
        q = [(px - ox, py - oy) for px, py in pts]
        if glow:
            ds.poly_partial(dd, q, p, fill=ds.rgba(color, 60), width=10)
        ds.poly_partial(dd, q, p, fill=ds.rgba(color, 255), width=3)
    ds.fade_layer(base, draw, alpha, box=lbox)
    if label and p > 0.5:
        la = ds.anim(t, t0 + draw_dur * 0.6, 0.2) * alpha
        f = ds.font('mono', 500, 28)
        d0 = ImageDraw.Draw(base)
        lw = d0.textlength(label, font=f) + 36
        lx = max(8, min(x0, W - int(lw) - 8))
        ly = y0 - 50 if label_pos == 'above' else y1 + 12
        if label_pos == 'above' and top_limit is not None and ly - 4 < top_limit + 8:
            ly = y1 + 12
        if ly < 56:
            ly = y1 + 12
        if ly + 44 > CAPTION_SAFE_Y:
            ly = y0 - 50
        ds.chip_mono(base, (lx, ly + 22), label, alpha=la, size=28,
                     fg=ds.ON_DARK, bg=ds.INK, border=color)


# ------------------------------------------------------------------ footage
_manifest_cache = None


def load_manifest():
    """video/work_footage/manifest.json. Accepts V1's list schema:

    {"clips": [{"beat": "s1", "file": "video/work_footage/s1.mp4",
                "duration_s": 11.73, ...}, ...]}
    and the simpler dict schemas {beat: "file.mp4"} / {beat: {"file": ...}}.
    """
    global _manifest_cache
    if _manifest_cache is not None:
        return _manifest_cache
    path = os.path.join(FOOTAGE_DIR, 'manifest.json')
    man = {}
    if os.path.exists(path):
        try:
            raw = json.load(open(path))
            clips = raw.get('clips', raw) if isinstance(raw, dict) else {}
            if isinstance(clips, list):
                for c in clips:
                    if isinstance(c, dict) and c.get('beat') and c.get('file'):
                        man[c['beat']] = {'file': c['file'],
                                          'duration': c.get('duration_s')}
            elif isinstance(clips, dict):
                for beat, v in clips.items():
                    if isinstance(v, str):
                        v = {'file': v}
                    if isinstance(v, dict) and v.get('file'):
                        man[beat] = v
        except Exception:
            man = {}
    _manifest_cache = man
    return man


def resolve_clip(beat, directory=None, manifest=None):
    directory = directory or FOOTAGE_DIR
    if manifest is None and directory == FOOTAGE_DIR:
        manifest = load_manifest()
    entry = (manifest or {}).get(beat)
    if entry:
        path = entry['file']
        if not os.path.isabs(path):
            cand = os.path.join(directory, path)
            root_cand = os.path.join(os.path.dirname(VIDEO), path)
            path = cand if os.path.exists(cand) else root_cand
        if os.path.exists(path):
            return {'path': path, 'trim_in': float(entry.get('trim_in', 0)),
                    'trim_out': entry.get('trim_out'), 'speed': float(entry.get('speed', 1.0)),
                    'duration': entry.get('duration'), 'key': beat}
    for ext in ('mp4', 'webm', 'mov'):
        p = os.path.join(directory, f'{beat}.{ext}')
        if os.path.exists(p):
            return {'path': p, 'trim_in': 0.0, 'trim_out': None, 'speed': 1.0,
                    'duration': None, 'key': beat}
    return None


_durations = {}
_sizes = {}


def clip_size(path):
    """Native (width, height) of a clip's video stream, via ffprobe (cached)."""
    if path not in _sizes:
        try:
            out = subprocess.run(
                ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                 '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path],
                capture_output=True, text=True, check=True).stdout.strip()
            w, h = out.split(',')[:2]
            _sizes[path] = (int(w), int(h))
        except Exception:
            _sizes[path] = (W, H)
    return _sizes[path]


def clip_duration(path):
    """Real decoded video-stream duration (container metadata can overstate it)."""
    if path not in _durations:
        try:
            out = subprocess.run(
                ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                 '-show_entries', 'stream=duration', '-of', 'csv=p=0', path],
                capture_output=True, text=True, check=True).stdout.strip()
            _durations[path] = float(out) if out and out != 'N/A' else None
        except Exception:
            _durations[path] = None
    return _durations[path]


def apply_window(t_local, seg_dur, window, clip_dur=None):
    """Map segment-local time into a clip window {'in': s, 'out': s|None}.

    If the window span differs from the segment duration, the window is fit
    (time-stretched) across the segment; otherwise it plays 1:1 from 'in'.
    """
    if not window:
        return t_local
    tin = float(window.get('in', 0.0))
    tout = window.get('out')
    if tout is None:
        tout = (clip_dur if clip_dur else tin + (seg_dur or 0.0))
    span = max(0.1, float(tout) - tin)
    if seg_dur and abs(span - seg_dur) > 0.05:
        return tin + (min(t_local, seg_dur) / seg_dur) * span
    return tin + t_local


_clip_frames = {}


def _extract_clip(clip):
    """One ffmpeg pass -> JPEG frames at 30 fps at the clip's NATIVE resolution.

    DPR2 retakes are 1920x1560; we keep native detail (no downscale to 1080) so
    the compositor can crop the content column and still render >=28px body text.
    The cache invalidates automatically when the source file changes.
    """
    key = clip['key']
    src = clip['path']
    sig = f'{os.path.getmtime(src):.0f}:{os.path.getsize(src)}'
    if key in _clip_frames and _clip_frames[key][2] == sig:
        return _clip_frames[key][:2]
    outdir = os.path.join(CACHE_DIR, key)
    done = os.path.join(outdir, 'done.txt')
    cached = open(done).read().strip() if os.path.exists(done) else ''
    if cached.split('|')[-1] != sig:
        os.makedirs(outdir, exist_ok=True)
        for f in glob.glob(os.path.join(outdir, 'f*.jpg')):
            os.remove(f)
        cmd = ['ffmpeg', '-v', 'error']
        if clip['trim_in']:
            cmd += ['-ss', str(clip['trim_in'])]
        cmd += ['-i', src]
        if clip['trim_out']:
            cmd += ['-t', str(float(clip['trim_out']) - clip['trim_in'])]
        vf = []
        if clip['speed'] != 1.0:
            vf.append(f"setpts=PTS/{clip['speed']}")
        vf += ['fps=30']
        cmd += ['-vf', ','.join(vf), '-q:v', '2', os.path.join(outdir, 'f%05d.jpg')]
        subprocess.run(cmd, check=True)
        n = len(glob.glob(os.path.join(outdir, 'f*.jpg')))
        with open(done, 'w') as fh:
            fh.write(f'{n}|{sig}')
    n = int(open(done).read().split('|')[0] or 0)
    _clip_frames[key] = (outdir, n, sig)
    return outdir, n


def placeholder(beat, size=(W, H)):
    """Styled panel shown until V1 delivers the real clip. Labelled with the beat."""
    w, h = size
    img = Image.new('RGBA', (w, h), ds.rgba(ds.ON_DARK_LINE, 255))
    d = ImageDraw.Draw(img)
    m = 14
    d.rounded_rectangle([m, m, w - m, h - m], radius=16,
                        outline=ds.rgba(ds.BORDER_ST, 120), width=2)
    cx, cy = w / 2, h / 2
    f_k = ds.font('heading', 600, 26)
    kick = 'REAL FOOTAGE PENDING'
    kw = ds.tracked_w(d, kick, f_k, 0.16)
    ds.tracked(d, (cx - kw / 2, cy - 110), kick, f_k, ds.rgba(ds.ON_DARK_3, 255), 0.16)
    f_b = ds.font('mono', 600, 64)
    bw = d.textlength(beat, font=f_b)
    d.text((cx - bw / 2, cy - 44), beat, font=f_b, fill=ds.rgba(ds.ON_DARK_2, 255))
    f_s = ds.font('mono', 400, 26)
    sub = f'video/work_footage/{beat}.mp4'
    sw = d.textlength(sub, font=f_s)
    d.text((cx - sw / 2, cy + 56), sub, font=f_s, fill=ds.rgba(ds.ON_DARK_3, 255))
    ds.ic_file(d, cx, cy - 170, 26, ds.rgba(ds.ON_DARK_3, 255), 3, 1.0)
    return img


def get_frame(beat, t_local, directory=None, manifest=None, window=None, seg_dur=None):
    """Return (PIL Image 1920x1080, is_real). Falls back to a labelled placeholder.

    window: optional {'in': seconds, 'out': seconds|None} clip window; see
    apply_window. seg_dur: the segment duration, for fit-mapping the window.
    """
    clip = resolve_clip(beat, directory, manifest)
    if clip is None:
        return placeholder(beat), False
    if window:
        dur = clip.get('duration') or clip_duration(clip['path'])
        t_local = apply_window(t_local, seg_dur, window, dur)
    outdir, n = _extract_clip(clip)
    if n <= 0:
        return placeholder(beat), False
    idx = min(n - 1, max(0, int(t_local * FPS)))
    img = Image.open(os.path.join(outdir, f'f{idx + 1:05d}.jpg')).convert('RGBA')
    img = _mask_cursor(beat, idx + 1, img)
    return img, True


# ------------------------------------------------------------------ cursor mask
# The raw OS arrow/hand captured in the recordings is replaced with a designed
# branded pointer. Round-8 P3-4: ONE pointer language across the whole film —
# the same INK fill + white outline as the MG cursor (chrome._flat_cursor),
# drawn ~3px larger than the raw glyph so it fully covers it. Tracks are
# precomputed per frame in work_motion/r6_src/cursor_tracks.json.
_CURSOR_TRACKS = None
_CURSOR_SPRITE = {}


def _cursor_tracks():
    global _CURSOR_TRACKS
    if _CURSOR_TRACKS is None:
        path = os.path.join(VIDEO, 'work_motion', 'r6_src', 'cursor_tracks.json')
        try:
            raw = json.load(open(path))
            _CURSOR_TRACKS = {b: {'template': e['template'],
                                  'frames': {int(k): v for k, v in e['frames'].items()}}
                              for b, e in raw.items()}
        except Exception:
            _CURSOR_TRACKS = {}
    return _CURSOR_TRACKS


def _dilate(m, it=1):
    r = m.copy()
    for _ in range(it):
        p = np.pad(r, 1)
        r = (p[:-2, :-2] | p[:-2, 1:-1] | p[:-2, 2:] | p[1:-1, :-2] | p[1:-1, 1:-1]
             | p[1:-1, 2:] | p[2:, :-2] | p[2:, 1:-1] | p[2:, 2:])
    return r


def _cursor_sprite(kind):
    if kind in _CURSOR_SPRITE:
        return _CURSOR_SPRITE[kind]
    path = os.path.join(VIDEO, 'work_motion', 'r6_src', f'cursor_{kind}.png')
    core = np.array(Image.open(path).convert('L')) > 127
    cover = _dilate(core, 3)
    outline = _dilate(core, 5) & ~cover
    h, w = cover.shape
    spr = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    px = spr.load()
    acc = ds.INK
    for y in range(h):
        for x in range(w):
            if outline[y, x]:
                px[x, y] = (255, 255, 255, 255)
            elif cover[y, x]:
                px[x, y] = (acc[0], acc[1], acc[2], 255)
    _CURSOR_SPRITE[kind] = spr
    return spr


def _mask_cursor(beat, frame_no, img):
    tr = _cursor_tracks().get(beat)
    if not tr:
        return img
    pos = tr['frames'].get(frame_no)
    if not pos:
        return img
    spr = _cursor_sprite(tr['template'])
    x, y = pos[0] - 3, pos[1] - 3
    sx0, sy0 = max(0, -x), max(0, -y)
    sx1, sy1 = min(spr.width, img.width - x), min(spr.height, img.height - y)
    if sx1 <= sx0 or sy1 <= sy0:
        return img
    img.alpha_composite(spr.crop((sx0, sy0, sx1, sy1)), (x + sx0, y + sy0))
    return img


def composite_footage(base, img, box, t, dur, push=0.06, radius=18, shadow=True,
                      caption_safe=True, fit='cover', crop=None):
    """Rounded frame + soft shadow on the dark backdrop, slow push-in 1.00->1+push.

    crop: optional (x0,y0,x1,y1) in the source's native pixels — the content band
          to show (DPR2 retakes). Applied before the fit so body text stays >=28px.
    fit='cover': scale to cover the box and centre-crop (default).
    fit='contain': letterbox — the WHOLE (cropped) source stays visible.
    Returns the box actually used (clamped to the caption-safe zone).
    """
    x0, y0, x1, y1 = [int(v) for v in box]
    if caption_safe:
        y1 = min(y1, CAPTION_SAFE_Y)
    bw, bh = x1 - x0, y1 - y0
    if bw <= 0 or bh <= 0:
        return (x0, y0, x1, y1)
    src = img.convert('RGB')
    if crop:
        cx0, cy0, cx1, cy1 = [int(v) for v in crop]
        cx0 = max(0, min(cx0, src.width)); cx1 = max(cx0 + 1, min(cx1, src.width))
        cy0 = max(0, min(cy0, src.height)); cy1 = max(cy0 + 1, min(cy1, src.height))
        src = src.crop((cx0, cy0, cx1, cy1))
    scale = 1.0 + push * ds.ease_standard(min(1.0, t / max(0.001, dur)))
    if fit == 'contain':
        r = min(bw / src.width, bh / src.height) * scale / (1.0 + push)
        rw, rh = max(1, int(src.width * r)), max(1, int(src.height * r))
        rs = src.resize((rw, rh), Image.LANCZOS)
        frame = Image.new('RGB', (bw, bh), ds.DARK_FADE)
        frame.paste(rs, ((bw - rw) // 2, (bh - rh) // 2))
    else:
        sw, sh = int(bw * scale), int(bh * scale)
        r = max(sw / src.width, sh / src.height)
        rs = src.resize((max(sw, int(src.width * r)), max(sh, int(src.height * r))),
                        Image.LANCZOS)
        left = (rs.width - sw) // 2
        top = (rs.height - sh) // 2
        frame = rs.crop((left, top, left + sw, top + sh)).resize((bw, bh), Image.LANCZOS)
    mask = Image.new('L', (bw, bh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, bw - 1, bh - 1], radius=radius, fill=255)
    if shadow:
        sh_layer = Image.new('RGBA', (bw + 80, bh + 80), (0, 0, 0, 0))
        ImageDraw.Draw(sh_layer).rounded_rectangle(
            [40, 40, 40 + bw, 40 + bh], radius=radius, fill=ds.rgba(ds.DARK_FADE, 150))
        sh_layer = sh_layer.filter(ImageFilter.GaussianBlur(18))
        base.alpha_composite(sh_layer, (x0 - 40, y0 - 28))
    frame.putalpha(mask)
    base.alpha_composite(frame, (x0, y0))
    d = ImageDraw.Draw(base)
    d.rounded_rectangle([x0, y0, x1 - 1, y1 - 1], radius=radius,
                        outline=ds.rgba(ds.ON_DARK_LINE, 255), width=2)
    return (x0, y0, x1, y1)


def map_to_box(norm, box):
    """Normalised (0..1) highlight coords -> pixels inside a composited footage box."""
    x0, y0, x1, y1 = box
    nx0, ny0, nx1, ny1 = norm
    return (x0 + nx0 * (x1 - x0), y0 + ny0 * (y1 - y0),
            x0 + nx1 * (x1 - x0), y0 + ny1 * (y1 - y0))


def footage_mapper(box, t, dur, push=0.06):
    """Map 1920x1080 footage-space pixels into the composited (pushed-in) box.

    Use for manifest-supplied highlight boxes measured on the real recording.
    """
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    scale = 1.0 + push * ds.ease_standard(min(1.0, t / max(0.001, dur)))
    r = max(bw * scale / W, bh * scale / H)
    left = (W * r - bw * scale) / 2
    top = (H * r - bh * scale) / 2

    def m(fx, fy):
        return (x0 + (fx * r - left) / scale, y0 + (fy * r - top) / scale)
    return m


# ------------------------------------------------------------------ DPR2 rects
_rects_cache = None
_notes_cache = None


def load_rects():
    """video/work_footage/rects.json — measured DOM rects in native device px."""
    global _rects_cache
    if _rects_cache is not None:
        return _rects_cache
    path = os.path.join(FOOTAGE_DIR, 'rects.json')
    try:
        _rects_cache = json.load(open(path)).get('beats', {})
    except Exception:
        _rects_cache = {}
    return _rects_cache


def load_rect_notes():
    """video/work_footage/rects_notes.json — pan model + pre/post-click notes."""
    global _notes_cache
    if _notes_cache is not None:
        return _notes_cache
    path = os.path.join(FOOTAGE_DIR, 'rects_notes.json')
    try:
        _notes_cache = json.load(open(path))
    except Exception:
        _notes_cache = {}
    return _notes_cache


def content_rect(beat):
    e = load_rects().get(beat) or {}
    return tuple(e['content']) if e.get('content') else None


def frame_rect(beat):
    """The clean ~2.48:1 band (device px) containing the full key UI for a beat."""
    e = load_rects().get(beat) or {}
    return tuple(e['frame_rect']) if e.get('frame_rect') else content_rect(beat)


def target_rect(beat, name):
    e = load_rects().get(beat) or {}
    t = (e.get('targets') or {}).get(name)
    return tuple(t) if t else None


def clip_time(beat, t_local, seg_dur, window=None):
    """Segment-local time -> source-clip seconds (same mapping get_frame uses)."""
    clip = resolve_clip(beat)
    dur = None
    if clip:
        dur = clip.get('duration') or clip_duration(clip['path'])
    return apply_window(t_local, seg_dur, window, dur)


def crop_at(beat, t, dur, window=None):
    """The static frame_rect band shown for a beat. Pans are baked into the
    footage (the recording scrolls), so the crop box itself does not move.

    s3-deny carries a crop_switch: at clip time at_s the footage jump-cuts to the
    Already-decided view and the crop box switches from->to (mode 'cut').
    """
    base = frame_rect(beat)
    if beat == 's4':
        # Tighten to the THREE fact rows (drop the draft header + verdict pill, which
        # the BLOCK stamp conveys) so contain-fit renders them at ~24px, no cutoff.
        base = (64, 575, 1856, 1440)
    e = load_rects().get(beat) or {}
    sw = e.get('crop_switch')
    if sw and base:
        ct = clip_time(beat, t, dur, window)
        if ct >= float(sw.get('at_s', 1e9)):
            return tuple(sw['to'])
    return base


def scroll_css_at(beat, clip_t):
    """Reconstruct the page scroll (CSS px) at a clip time from the baked-in pan.

    Pan travel is linear-in-scroll between pan_start_clip_s and pan_end_clip_s
    (with a reading pause at mid_hold_clip_s for s4/s8); eased here to match the
    smooth recorded motion. Before/after the pan the scroll holds its endpoints.
    """
    n = load_rect_notes().get(beat) or {}
    final = n.get('final_scrollY')
    if not n.get('pan_baked_in'):
        return final
    t0 = n.get('pan_start_clip_s')
    t1 = n.get('pan_end_clip_s')
    s0 = n.get('start_scroll_css')
    s1 = n.get('end_scroll_css')
    if t0 is None or t1 is None or s0 is None or s1 is None or final is None:
        return final
    if clip_t <= t0:
        return float(s0)
    if clip_t >= t1:
        return float(s1)
    tm = n.get('mid_hold_clip_s')
    sm = n.get('mid_scroll_css')
    if tm is not None and sm is not None and t0 < tm < t1:
        if clip_t <= tm:
            p = ds.ease_standard((clip_t - t0) / (tm - t0))
            return s0 + (sm - s0) * p
        p = ds.ease_standard((clip_t - tm) / (t1 - tm))
        return sm + (s1 - sm) * p
    p = ds.ease_standard((clip_t - t0) / (t1 - t0))
    return s0 + (s1 - s0) * p


def target_rect_at(beat, name, clip_t):
    """A target's frame-space rect (device px) at a given clip time.

    rects.json targets are measured at the final stable scroll (measured_at_s).
    For baked-in pans the target rides the scroll: y_frame(t) = y_final +
    2*(scroll_final - scroll(t)). Static beats return the measured rect unchanged.
    s3-deny pre-click targets vanish at the commit cut; post-commit pseudo-targets
    'decided_item' / 'toast' come from rects_notes.post_click (post-band frame px).
    """
    n = load_rect_notes().get(beat) or {}
    if beat == 's3-deny':
        e = load_rects().get(beat) or {}
        sw = e.get('crop_switch') or {}
        post = n.get('post_click') or {}
        if clip_t >= float(sw.get('at_s', 1e9)):
            if name == 'decided_item' and post.get('decided_rect'):
                return tuple(post['decided_rect'])
            if name == 'toast' and post.get('toast_rect'):
                return tuple(post['toast_rect'])
            return None
        return target_rect(beat, name)
    r = target_rect(beat, name)
    if not r:
        return None
    if not n.get('pan_baked_in'):
        return r
    final = n.get('final_scrollY')
    s = scroll_css_at(beat, clip_t)
    if final is None or s is None:
        return r
    dy = 2.0 * (final - s)
    return (r[0], r[1] + dy, r[2], r[3] + dy)


def framed_window(beat, name, clip_dur, full=True, tol=6):
    """(enter, exit) clip-time window when a target sits inside frame_rect.

    full=True requires the whole rect inside the band (tol px slack); full=False
    only requires intersection. Used to time highlights to when a target is framed.
    """
    fr = frame_rect(beat)
    if not fr:
        return (0.0, clip_dur)
    _, by0, _, by1 = fr
    hits = []
    t = 0.0
    while t <= clip_dur + 1e-6:
        r = target_rect_at(beat, name, t)
        if r:
            ok = (r[1] >= by0 - tol and r[3] <= by1 + tol) if full \
                else (r[3] > by0 and r[1] < by1)
            if ok:
                hits.append(t)
        t += 0.02
    if not hits:
        return None
    return (hits[0], hits[-1])


def rect_mapper(box, t, dur, crop, src_size, push=0.06, fit='cover'):
    """Map native-source pixels -> composited box coords through crop + fit + push.
    crop is the band used at time t (same as composite_footage). fit='contain' shows
    the WHOLE band (letterboxed) so no UI is ever cut off; 'cover' fills + crops."""
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    cx0, cy0, cx1, cy1 = crop
    cw, ch = max(1, cx1 - cx0), max(1, cy1 - cy0)
    scale = 1.0 + push * ds.ease_standard(min(1.0, t / max(0.001, dur)))
    if fit == 'contain':
        r = min(bw / cw, bh / ch) * scale / (1.0 + push)
        ox = (bw - cw * r) / 2
        oy = (bh - ch * r) / 2

        def mc(fx, fy):
            return (x0 + (fx - cx0) * r + ox, y0 + (fy - cy0) * r + oy)
        return mc
    r = max(bw * scale / cw, bh * scale / ch)
    left = (cw * r - bw * scale) / 2
    top = (ch * r - bh * scale) / 2

    def m(fx, fy):
        return (x0 + ((fx - cx0) * r - left) / scale,
                y0 + ((fy - cy0) * r - top) / scale)
    return m


# ------------------------------------------------------------------ flow diagram
def flow_diagram(base, box, t, t0, decision, agent_label='Agent',
                 world_label='Outside world', stamp_size=30):
    """agent -> gate -> world row. Animated dashes + a travelling pulse.

    decision: 'block' (path ends in a red X), 'hold' (amber pause), 'allow'
    (green path through to the world). The gate node carries a mini stamp.
    """
    x0, y0, x1, y1 = box
    cy = (y0 + y1) / 2
    ax = x0 + 90
    gx = (x0 + x1) / 2
    wx = x1 - 90
    p_in = ds.anim(t, t0, 0.5)
    if p_in <= 0:
        return
    d = ImageDraw.Draw(base)
    col = {'block': ds.BLOCK_BORDER, 'hold': ds.WAIT_BORDER, 'allow': ds.DONE_BORDER}[decision]
    # agent node
    ds.ic_person(d, ax, cy - 14, 26, ds.rgba(ds.ON_DARK_2, 255), 3, p_in)
    f_l = ds.font('mono', 500, 24)
    aw = d.textlength(agent_label, font=f_l)
    d.text((ax - aw / 2, cy + 34), agent_label, font=f_l, fill=ds.rgba(ds.ON_DARK_2, 255))
    # gate node: dark rounded square with an arch (the app logo)
    gs = 44
    gp = ds.anim(t, t0 + 0.25, 0.35)
    if gp > 0:
        gsz = gs * ds.lerp(0.8, 1.0, gp)
        d.rounded_rectangle([gx - gsz, cy - 14 - gsz, gx + gsz, cy - 14 + gsz],
                            radius=14, fill=ds.rgba(ds.INK, 255),
                            outline=ds.rgba(ds.BORDER_ST, 255), width=2)
        d.arc([gx - gsz * 0.5, cy - 14 - gsz * 0.45, gx + gsz * 0.5, cy - 14 + gsz * 0.55],
              180, 360, fill=ds.rgba(ds.ON_DARK, 255), width=4)
        d.line([gx - gsz * 0.5, cy - 14 + gsz * 0.05, gx - gsz * 0.5, cy - 14 + gsz * 0.5],
               fill=ds.rgba(ds.ON_DARK, 255), width=4)
        d.line([gx + gsz * 0.5, cy - 14 + gsz * 0.05, gx + gsz * 0.5, cy - 14 + gsz * 0.5],
               fill=ds.rgba(ds.ON_DARK, 255), width=4)
    # agent -> gate dashed line + pulse
    ds.dashed_line(d, (ax + 44, cy - 14), (gx - gs - 12, cy - 14),
                   ds.rgba(ds.ON_DARK_3, 255), width=3, progress=p_in)
    if p_in >= 1.0:
        pulse = ((t - t0) * 0.55) % 1.0
        px = ds.lerp(ax + 44, gx - gs - 12, pulse)
        d.ellipse([px - 6, cy - 20, px + 6, cy - 8], fill=ds.rgba(ds.ON_DARK, 255))
    # gate -> world outcome
    p_out = ds.anim(t, t0 + 0.7, 0.45)
    if p_out > 0:
        if decision == 'allow':
            ds.dashed_line(d, (gx + gs + 12, cy - 14), (wx - 44, cy - 14),
                           ds.rgba(col, 255), width=3, progress=p_out)
            ds.ic_check_circle(d, wx, cy - 14, 26, ds.rgba(col, 255), 3, p_out)
        else:
            stub = gx + gs + 12 + 70 * p_out
            ds.dashed_line(d, (gx + gs + 12, cy - 14), (stub, cy - 14),
                           ds.rgba(col, 255), width=3, progress=p_out)
            if decision == 'block':
                ds.ic_cross_circle(d, gx + gs + 108, cy - 14, 26, ds.rgba(col, 255), 3,
                                   ds.anim(t, t0 + 0.95, 0.4))
            else:
                ds.ic_pause_circle(d, gx + gs + 108, cy - 14, 26, ds.rgba(col, 255), 3,
                                   ds.anim(t, t0 + 0.95, 0.4))
            ww = d.textlength(world_label, font=f_l)
            ds.fade_layer(base, lambda dd, off: dd.text(
                (wx - ww / 2 - off[0], cy + 34 - off[1]), world_label,
                font=f_l, fill=ds.rgba(ds.ON_DARK_3, 255)), p_out * 0.7,
                box=(int(wx - ww / 2) - 4, int(cy + 30), int(wx + ww / 2) + 4, int(cy + 66)))
    if decision == 'allow':
        ww = d.textlength(world_label, font=f_l)
        d.text((wx - ww / 2, cy + 34), world_label, font=f_l, fill=ds.rgba(ds.ON_DARK_2, 255))
    # mini stamp under the gate (never over the nodes)
    decision_stamp(base, (gx, cy + 96), decision, t, t0 + 1.05, size=stamp_size,
                   subscript=None)


# ------------------------------------------------------------------ S8 maths
def s8_maths(base, box, t, t0):
    """750 + 750 = 1,500 > 1,000 — chips slide in on the spoken sums, the total
    SNAPS straight to 1,500 (scale-pop, no transient wrong value), limit flip, HOLD.

    All figures are the engine's: two SGD 750 payments against one invoice total
    SGD 1,500 in 24h, over the owner's SGD 1,000 approval limit. Round-7 delays are
    synced to the narration (t0=0.5 local): chip1 '750' @79.0, plus @80.0, chip2
    '750' @80.8, total '1,500' @81.7, '>1,000 limit' @83.1, HOLD @86.5 ('holds').
    """
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    cx = (x0 + x1) / 2
    d = ImageDraw.Draw(base)
    ds.paste_card(base, box, fill=ds.ON_DARK_LINE, border=ds.BORDER_ST, radius=18, width=1)
    f_k = ds.font('heading', 600, 30)
    kick = 'S8 · TWO PAYMENTS, ONE INVOICE'
    kw = ds.tracked_w(d, kick, f_k, 0.10)
    ds.tracked(d, (cx - kw / 2, y0 + 30), kick, f_k, ds.rgba(ds.ON_DARK_2, 255), 0.10)
    # left group: two amount chips + plus + rule + sum bar
    chip_w, chip_h = int(bw * 0.15), 92
    gap = int(bw * 0.05)
    total_w = chip_w * 2 + gap
    lcx = x0 + bw * 0.28
    lx = lcx - total_w / 2
    row_y = y0 + int(bh * 0.24)
    f_amt = ds.font('mono', 600, 48)
    for i, delay in enumerate((0.0, 1.8)):
        p = ds.anim(t, t0 + delay, 0.35)
        if p <= 0:
            continue
        x = lx + i * (chip_w + gap) + ds.lerp(24, 0, p)
        ds.fade_layer(base, lambda dd, off, x=x, p=p: dd.rounded_rectangle(
            [x - off[0], row_y - off[1], x + chip_w - off[0], row_y + chip_h - off[1]],
            radius=12, fill=ds.rgba(ds.INK, 255), outline=ds.rgba(ds.BORDER_ST, 255), width=2),
            p, box=(int(x) - 2, row_y - 2, int(x) + chip_w + 2, row_y + chip_h + 2))
        tw = d.textlength('SGD 750', font=f_amt)
        ds.fade_layer(base, lambda dd, off, x=x: dd.text(
            (x + chip_w / 2 - tw / 2 - off[0], row_y + 22 - off[1]), 'SGD 750',
            font=f_amt, fill=ds.rgba(ds.ON_DARK, 255)), p,
            box=(int(x), row_y, int(x) + chip_w, row_y + chip_h))
    pp = ds.anim(t, t0 + 1.0, 0.3)
    if pp > 0:
        f_plus = ds.font('heading', 600, 56)
        pw = d.textlength('+', font=f_plus)
        ds.fade_layer(base, lambda dd, off: dd.text(
            (lcx - pw / 2 - off[0], row_y + 18 - off[1]), '+', font=f_plus,
            fill=ds.rgba(ds.ON_DARK_2, 255)), pp,
            box=(int(lcx - pw / 2) - 4, row_y, int(lcx + pw / 2) + 4, row_y + chip_h))
    pr = ds.anim(t, t0 + 2.3, 0.3)
    if pr > 0:
        ds.poly_partial(d, [(lx, row_y + chip_h + 24), (lx + total_w, row_y + chip_h + 24)],
                        pr, fill=ds.rgba(ds.BORDER_ST, 255), width=2)
    # running total (centre column) — SNAPS to 1,500 (no transient 1,209 on a pause)
    p_tot = ds.anim(t, t0 + 2.7, 0.25)
    tx = x0 + bw * 0.56
    if p_tot > 0:
        f_cur = ds.font('mono', 500, 30)
        d.text((tx, row_y - 8), 'SGD', font=f_cur, fill=ds.rgba(ds.ON_DARK_2, 255))
        pop = ds.anim(t, t0 + 2.7, 0.25)
        tsize = int(128 * ds.lerp(1.22, 1.0, pop))
        f_tot = ds.font('mono', 700, tsize)
        d.text((tx, row_y + 18), '1,500', font=f_tot, fill=ds.rgba(ds.ON_DARK, 255))
    # limit comparison (right column)
    p_cmp = ds.anim(t, t0 + 4.1, 0.35)
    cmpx = x0 + bw * 0.80
    if p_cmp > 0:
        f_cmp = ds.font('mono', 600, 50)
        txt = '> 1,000 limit'
        c = ds.mix(ds.ON_DARK_2, ds.WAIT_BORDER, p_cmp)
        d.text((cmpx, row_y + 44), txt, font=f_cmp, fill=ds.rgba(c, 255))
    # sum bar grows past the limit marker and turns amber
    bar_y = row_y + chip_h + 56
    bar_w = total_w
    lim_x = lx + bar_w * (1000 / 1500)
    p_bar = ds.anim(t, t0 + 4.3, 0.7)
    if p_bar > 0:
        ds.dashed_line(d, (lim_x, bar_y - 12), (lim_x, bar_y + 22),
                       ds.rgba(ds.ON_DARK_2, 255), width=2, dash=6, gap=6)
        fill_w = bar_w * p_bar
        crossed = fill_w > (lim_x - lx)
        bc = ds.WAIT_BORDER if crossed else ds.ACCENT
        if fill_w > 1:
            d.rounded_rectangle([lx, bar_y, lx + fill_w, bar_y + 14], radius=7,
                                fill=ds.rgba(bc, 255))
        f_bl = ds.font('mono', 500, 28)
        d.text((lim_x - d.textlength('1,000', font=f_bl) / 2, bar_y + 28), '1,000',
               font=f_bl, fill=ds.rgba(ds.ON_DARK_2, 255))
    p_cap = ds.anim(t, t0 + 3.4, 0.4)
    if p_cap > 0:
        f_cap = ds.font('mono', 500, 28)
        cap = '2 payments attempted against this one invoice in 24h'
        ds.fade_layer(base, lambda dd, off: dd.text(
            (lx - off[0], bar_y + 72 - off[1]), cap, font=f_cap,
            fill=ds.rgba(ds.ON_DARK_2, 255)), p_cap,
            box=(int(lx) - 4, bar_y + 68, int(lx + bar_w) + 4, bar_y + 106))
    # Round-8 J2: the file-evidence citation is BACK — S8 must show "the exact
    # line in your files" like every other scenario. Verbatim line 6 of
    # data/finance/invoice_2026-038_quickprint.md (the invoice the two payments
    # hit), >=28px, lands on the spoken "Chaperone adds them up" (~84.9s global).
    p_ev = ds.anim(t, t0 + 5.6, 0.4)
    if p_ev > 0:
        ev_y = int(y0 + bh * 0.80)
        d.rounded_rectangle([x0 + 36, ev_y - 6, x0 + 42, ev_y + 92], radius=3,
                            fill=ds.rgba(ds.ACCENT, int(255 * p_ev)))
        f_fn = ds.font('mono', 500, 30)
        fn = 'finance/invoice_2026-038_quickprint.md · line 6'
        ds.fade_layer(base, lambda dd, off: dd.text(
            (x0 + 64 - off[0], ev_y - off[1]), fn, font=f_fn,
            fill=ds.rgba(ds.ON_DARK_2, 255)), p_ev,
            box=(x0 + 60, ev_y - 4, x0 + 64 + int(d.textlength(fn, font=f_fn)) + 4, ev_y + 36))
        f_q = ds.font('body', 500, 32)
        quote = ('“Harbourbean menu boards reprint, 10 units, SGD 1,500. '
                 'Due 16 Dec 2026. Status: unpaid.”')
        ds.fade_layer(base, lambda dd, off: dd.text(
            (x0 + 64 - off[0], ev_y + 46 - off[1]), quote, font=f_q,
            fill=ds.rgba(ds.ON_DARK, 255)), p_ev,
            box=(x0 + 60, ev_y + 42, x1 - 24, ev_y + 90))
    # HOLD stamp lands on the spoken "holds both payments" (~86.4s global)
    decision_stamp(base, (x0 + bw * 0.82, row_y + 250), 'hold', t, t0 + 7.4,
                   size=60, subscript=None)


# ------------------------------------------------------------------ counters
def counter(base, cxy, value, t, t0, dur=1.2, size=110, denom=None, label=None,
            sub=None, color=None, snap=False, prefill=None):
    """Ease-out count-up with tabular mono digits; lands exactly on `value`.

    snap=True: the numerator SLAMS straight to `value` (scale-pop 1.3->1.0 over
    0.3 s) — no transient wrong totals (e.g. never 29/30 during a perfection pitch).
    prefill: if set, the FULL fraction (numerator at ~35% alpha + denominator +
    label) renders from this earlier time so the card is never empty and never a
    floating '/30'; the numerator slams to full alpha at t0.
    """
    color = color or ds.ON_DARK
    d = ImageDraw.Draw(base)
    p = ds.anim(t, t0, dur)
    if snap:
        shown = f'{value:,.0f}' if isinstance(value, (int, float)) else str(value)
        pop = ds.anim(t, t0, 0.3)
        nsize = int(size * ds.lerp(1.3, 1.0, pop)) if pop > 0 else size
        if t >= t0:
            num_a = 1.0
        elif prefill is not None and t >= prefill:
            num_a = 0.35
        else:
            num_a = 0.0
    else:
        if p <= 0:
            if prefill is not None and t >= prefill:
                shown = f'{value:,.0f}' if isinstance(value, (int, float)) else str(value)
                num_a = 0.35
            else:
                shown = None
                num_a = 0.0
        else:
            shown = ds.count_up(value, p)
            num_a = 1.0
        nsize = size
    pre_a = 1.0 if (prefill is not None and t >= prefill) else (1.0 if p > 0 else 0.0)
    f_n = ds.font('mono', 700, nsize)
    f_d = ds.font('mono', 500, int(size * 0.5))
    nw = d.textlength(shown, font=f_n) if shown else 0
    dw = d.textlength(f' / {denom}', font=f_d) if denom else 0
    x = cxy[0] - (nw + dw) / 2
    y = cxy[1] - size * 0.62
    if shown and num_a > 0:
        d.text((x, y), shown, font=f_n, fill=ds.rgba(color, int(255 * num_a)))
    if denom and pre_a > 0:
        d.text((x + nw, y + size * 0.34), f' / {denom}', font=f_d,
               fill=ds.rgba(ds.ON_DARK_2, int(255 * pre_a)))
    if label and pre_a > 0:
        f_l = ds.font('body', 600, 34)
        lw = d.textlength(label, font=f_l)
        d.text((cxy[0] - lw / 2, cxy[1] + size * 0.52), label, font=f_l,
               fill=ds.rgba(ds.ON_DARK_2, int(255 * pre_a)))
    if sub and pre_a > 0:
        f_s = ds.font('mono', 400, 26)
        sw = d.textlength(sub, font=f_s)
        d.text((cxy[0] - sw / 2, cxy[1] + size * 0.52 + 48), sub, font=f_s,
               fill=ds.rgba(ds.ON_DARK_2, int(255 * pre_a)))


# ------------------------------------------------------------------ chapter bar
_CHAPTER_ABBREV = {'LIVE DEMO': 'DEMO', 'QWENWORK': 'QWEN', 'BUSINESS': 'BIZ',
                   'PROBLEM': 'PROB', 'HOOK': 'HOOK', 'PROOF': 'PROOF', 'CTA': 'CTA'}


def chapter_bar(base, t_global, chapters, total):
    """Top progress bar: 6 px track, labelled segments, current chapter lit.

    Labels are 28 px (inactive ON_DARK_2, active white + accent underline). A label
    is NEVER dropped: if a segment is too narrow we shrink tracking, then abbreviate,
    then shrink the font — so wayfinding stays consistent across the whole film.
    """
    d = ImageDraw.Draw(base)
    d.rectangle([0, 0, W, 6], fill=ds.rgba(ds.ON_DARK_LINE, 255))
    prog = max(0.0, min(1.0, t_global / max(0.001, total)))
    if prog > 0:
        d.rectangle([0, 0, int(W * prog), 6], fill=ds.rgba(ds.ACCENT, 255))
    for name, s0, s1 in chapters:
        x0 = int(W * s0 / total)
        x1 = int(W * s1 / total)
        if s0 > 0:
            d.rectangle([x0, 0, x0 + 2, 6], fill=ds.rgba(ds.DARK_BG, 255))
        active = s0 - 1e-6 <= t_global < s1
        avail = (x1 - x0) - 16
        label = name.upper()
        size, track = 28, 0.08
        f = ds.font('heading', 600, size)
        lw = ds.tracked_w(d, label, f, track)
        if lw > avail:                      # 1) tighten tracking
            track = 0.02
            lw = ds.tracked_w(d, label, f, track)
        if lw > avail:                      # 2) abbreviate
            label = _CHAPTER_ABBREV.get(label, label)
            lw = ds.tracked_w(d, label, f, track)
        while lw > avail and size > 18:     # 3) shrink font as a last resort
            size -= 2
            f = ds.font('heading', 600, size)
            lw = ds.tracked_w(d, label, f, track)
        col = ds.ON_DARK if active else ds.ON_DARK_2
        lx = x0 + max(8, ((x1 - x0) - lw) / 2)
        ds.tracked(d, (lx, 14), label, f, ds.rgba(col, 255), track)
        if active:
            d.rectangle([int(lx), 46, int(lx + lw), 49], fill=ds.rgba(ds.ACCENT, 255))


# ------------------------------------------------------------------ kinetic type
def kinetic_line(base, cxy, text, t, t0, size=88, color=None, stagger=0.06,
                 maxw=None, align='center', weight=700, line_gap=1.22):
    """Word-stagger slide-up reveal (18 px, 0.35 s each). Returns bottom y."""
    color = color or ds.ON_DARK
    f = ds.font('heading', weight, size)
    d0 = ImageDraw.Draw(base)
    maxw = maxw or (W - 280)
    lines = ds.wrap(d0, text, f, maxw)
    y = cxy[1]
    for ln in lines:
        words = ln.split()
        widths = [d0.textlength(w, font=f) for w in words]
        space = d0.textlength(' ', font=f)
        lw = sum(widths) + space * (len(words) - 1)
        x = cxy[0] - lw / 2 if align == 'center' else cxy[0]
        for i, w in enumerate(words):
            p = ds.anim(t, t0 + i * stagger, 0.35)
            if p > 0:
                dy = ds.lerp(18, 0, p)
                ds.fade_layer(base, lambda dd, off, x=x, w=w, dy=dy: dd.text(
                    (x - off[0], y + dy - off[1]), w, font=f, fill=ds.rgba(color, 255)),
                    p, box=(int(x) - 4, int(y + dy) - 6, int(x + widths[i]) + 6,
                            int(y + dy + size * 1.2)))
            x += widths[i] + space
        y += int(size * line_gap)
        t0 += len(words) * stagger
    return y


def kicker(base, text, t, t0=0.1, x=140, y=100, color=None):
    p = ds.anim(t, t0, 0.3)
    if p <= 0:
        return
    color = color or ds.ON_DARK_3
    f = ds.font('heading', 600, 24)
    ds.fade_layer(base, lambda dd, off: ds.tracked(
        dd, (x - off[0], y + ds.lerp(10, 0, p) - off[1]), text, f,
        ds.rgba(color, 255), 0.16), p, box=(x - 4, y - 4, W - 100, y + 40))