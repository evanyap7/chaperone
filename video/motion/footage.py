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

Safe zones: captions burn at y~950 (V3 owns them). Keep scene content above
y~880; composite_footage clamps its box bottom to 880 by default.
"""
import glob
import json
import math
import os
import subprocess

from PIL import Image, ImageDraw, ImageFilter

import ds

W, H, FPS = ds.W, ds.H, ds.FPS
HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.dirname(HERE)
FOOTAGE_DIR = os.path.join(VIDEO, 'work_footage')
QWEN_DIR = os.path.join(VIDEO, 'work_qwen')
CACHE_DIR = os.path.join(VIDEO, 'work_motion', 'footage_cache')

CAPTION_SAFE_Y = 880          # nothing below this line (captions live at ~950)
STAMP_COLORS = {              # light tints, legible on the navy field
    'allow': ds.DONE_BORDER,   # #A9D9B8
    'hold': ds.WAIT_BORDER,    # #E8C988
    'block': ds.BLOCK_BORDER,  # #EDA69C
    'stopped': ds.BLOCK_BORDER,
}
STAMP_WORDS = {'allow': 'ALLOW', 'hold': 'HOLD', 'block': 'BLOCK', 'stopped': 'STOPPED'}
STAMP_SUB = {'allow': 'ALLOW', 'hold': 'HOLD_FOR_APPROVAL', 'block': 'BLOCK', 'stopped': 'BLOCK'}


# ------------------------------------------------------------------ stamps
def decision_stamp(base, cxy, kind, t, t0, size=56, angle=-7, subscript=None,
                   exit_t=None):
    """Slam-in decision stamp: scale 1.6->1.0 over 7 frames, rotation settles.

    kind: 'allow' | 'hold' | 'block' | 'stopped'. 'stopped' is the solid red
    variant (BLOCK_FG fill, white word). Outlined variants use the light tint
    on dark. Optional mono API subscript lands 0.22 s after the stamp.
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
    fs = ds.font('heading', 700, max(10, int(size * scale)))
    dtmp = ImageDraw.Draw(Image.new('RGBA', (8, 8)))
    tw = dtmp.textlength(word, font=fs)
    th = size * scale
    pad = 30
    bw, bh = int(tw + 44), int(th * 1.5)
    layer = Image.new('RGBA', (bw + pad * 2, bh + pad * 2), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    cxl, cyl = layer.width / 2, layer.height / 2
    rect = [cxl - bw / 2, cyl - bh / 2, cxl + bw / 2, cyl + bh / 2]
    if kind == 'stopped':
        ld.rounded_rectangle(rect, radius=12, fill=ds.rgba(ds.BLOCK_FG, 255),
                             outline=ds.rgba(col, 255), width=4)
        tcol = ds.INVERSE
    else:
        ld.rounded_rectangle(rect, radius=12, outline=ds.rgba(col, 255),
                             width=max(4, int(size / 12)))
        tcol = col
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
                  glow=True, exit_t=None, label_pos='above'):
    """Rounded-rect outline draws on clockwise (stroke progress 0->1), soft glow.

    Optional label chip sits above (or below) the box — never over its content.
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
        f = ds.font('mono', 500, 24)
        d0 = ImageDraw.Draw(base)
        lw = d0.textlength(label, font=f) + 36
        lx = max(8, min(x0, W - int(lw) - 8))
        ly = y0 - 46 if label_pos == 'above' else y1 + 12
        if ly < 56:
            ly = y1 + 12
        if ly + 40 > CAPTION_SAFE_Y:
            ly = y0 - 46
        ds.chip_mono(base, (lx, ly + 20), label, alpha=la, size=24,
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
    return img, True


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


def content_rect(beat):
    e = load_rects().get(beat) or {}
    return tuple(e['content']) if e.get('content') else None


def target_rect(beat, name):
    e = load_rects().get(beat) or {}
    t = (e.get('targets') or {}).get(name)
    return tuple(t) if t else None


# Per-beat content band: x spans the content column; a ~560px-tall window pans
# from y0 to y1 across the segment so the key targets stay in frame at >=28px.
# Native frame is 1920x1560; content column x 64..1856 (1792 wide). Box 1640 wide
# -> scale ~0.915 -> 16px CSS body text * 2 DPR * 0.915 ~= 29px on the 1080p frame.
CROP_PLAN = {
    'run-demo': {'x0': 64, 'x1': 1856, 'y0': 430, 'y1': 430, 'h': 560},
    'briefing': {'x0': 64, 'x1': 1856, 'y0': 360, 'y1': 360, 'h': 560},
    's1':       {'x0': 64, 'x1': 1856, 'y0': 360, 'y1': 690, 'h': 560},
    's7':       {'x0': 64, 'x1': 1856, 'y0': 380, 'y1': 760, 'h': 560},
    's4':       {'x0': 64, 'x1': 1856, 'y0': 400, 'y1': 720, 'h': 560},
    's5':       {'x0': 64, 'x1': 1856, 'y0': 400, 'y1': 400, 'h': 560},
    's8':       {'x0': 64, 'x1': 1856, 'y0': 880, 'y1': 880, 'h': 560},
    's9':       {'x0': 64, 'x1': 1856, 'y0': 380, 'y1': 560, 'h': 560},
    's10':      {'x0': 64, 'x1': 1856, 'y0': 400, 'y1': 400, 'h': 560},
    'scorecard':{'x0': 64, 'x1': 1856, 'y0': 600, 'y1': 600, 'h': 560},
    's3-deny':  {'x0': 64, 'x1': 1856, 'y0': 380, 'y1': 380, 'h': 560},
}


def crop_at(beat, t, dur):
    """The content band shown at segment-local t (panning y0->y1 with the push)."""
    plan = CROP_PLAN.get(beat)
    if not plan:
        return content_rect(beat)
    p = ds.ease_standard(min(1.0, t / max(0.001, dur)))
    y0 = ds.lerp(plan['y0'], plan['y1'], p)
    return (plan['x0'], y0, plan['x1'], y0 + plan['h'])


def rect_mapper(box, t, dur, crop, src_size, push=0.06):
    """Map native-source pixels -> composited box coords through crop + cover-fit
    + push-in. crop is the band used at time t (same as composite_footage)."""
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    cx0, cy0, cx1, cy1 = crop
    cw, ch = max(1, cx1 - cx0), max(1, cy1 - cy0)
    scale = 1.0 + push * ds.ease_standard(min(1.0, t / max(0.001, dur)))
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
    """750 + 750 = 1,500 > 1,000 — chips slide in, running total, limit flip, HOLD.

    All figures are the engine's: invoice QP-88901 totals SGD 1,500 against the
    owner's SGD 1,000 approval limit. Compact layout fits the 210..720 box so the
    HOLD stamp never reaches the caption pill.
    """
    x0, y0, x1, y1 = box
    cx = (x0 + x1) / 2
    d = ImageDraw.Draw(base)
    ds.paste_card(base, box, fill=ds.ON_DARK_LINE, border=ds.BORDER_ST, radius=18, width=1)
    f_k = ds.font('heading', 600, 22)
    kick = 'S8 · SPLIT PAYMENT · INVOICE QP-88901'
    kw = ds.tracked_w(d, kick, f_k, 0.10)
    ds.tracked(d, (cx - kw / 2, y0 + 20), kick, f_k, ds.rgba(ds.ON_DARK_3, 255), 0.10)
    f_amt = ds.font('mono', 600, 40)
    chip_w, chip_h = 210, 60
    gap = 56
    total_w = chip_w * 2 + gap
    lx = cx - total_w / 2
    row_y = y0 + 60
    for i, delay in enumerate((0.0, 0.4)):
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
            (x + chip_w / 2 - tw / 2 - off[0], row_y + 12 - off[1]), 'SGD 750',
            font=f_amt, fill=ds.rgba(ds.ON_DARK, 255)), p,
            box=(int(x), row_y, int(x) + chip_w, row_y + chip_h))
    pp = ds.anim(t, t0 + 0.25, 0.3)
    if pp > 0:
        f_plus = ds.font('heading', 600, 44)
        pw = d.textlength('+', font=f_plus)
        ds.fade_layer(base, lambda dd, off: dd.text(
            (cx - pw / 2 - off[0], row_y + 6 - off[1]), '+', font=f_plus,
            fill=ds.rgba(ds.ON_DARK_2, 255)), pp,
            box=(int(cx - pw / 2) - 4, row_y, int(cx + pw / 2) + 4, row_y + chip_h))
    pr = ds.anim(t, t0 + 0.8, 0.3)
    if pr > 0:
        ds.poly_partial(d, [(lx, row_y + chip_h + 14), (lx + total_w, row_y + chip_h + 14)],
                        pr, fill=ds.rgba(ds.BORDER_ST, 255), width=2)
    p_tot = ds.anim(t, t0 + 1.0, 0.6)
    if p_tot > 0:
        f_tot = ds.font('mono', 700, 76)
        shown = ds.count_up(1500, p_tot)
        tw = d.textlength(shown, font=f_tot)
        d.text((cx - tw / 2, row_y + chip_h + 24), shown, font=f_tot,
               fill=ds.rgba(ds.ON_DARK, 255))
        f_cur = ds.font('mono', 500, 24)
        d.text((cx - d.textlength('SGD', font=f_cur) / 2, row_y + chip_h + 104), 'SGD',
               font=f_cur, fill=ds.rgba(ds.ON_DARK_3, 255))
    p_cmp = ds.anim(t, t0 + 1.8, 0.35)
    if p_cmp > 0:
        cmp_y = row_y + chip_h + 142
        f_cmp = ds.font('mono', 600, 38)
        txt = '> 1,000 limit'
        tw = d.textlength(txt, font=f_cmp)
        c = ds.mix(ds.ON_DARK_2, ds.WAIT_BORDER, p_cmp)
        d.text((cx - tw / 2, cmp_y), txt, font=f_cmp, fill=ds.rgba(c, 255))
        bar_y = cmp_y + 50
        bar_w = total_w
        lim_x = lx + bar_w * (1000 / 1500)
        ds.dashed_line(d, (lim_x, bar_y - 12), (lim_x, bar_y + 22),
                       ds.rgba(ds.ON_DARK_3, 255), width=2, dash=6, gap=6)
        p_bar = ds.anim(t, t0 + 2.0, 0.7)
        fill_w = bar_w * p_bar
        crossed = fill_w > (lim_x - lx)
        bc = ds.WAIT_BORDER if crossed else ds.ACCENT
        if fill_w > 1:
            d.rounded_rectangle([lx, bar_y, lx + fill_w, bar_y + 12], radius=6,
                                fill=ds.rgba(bc, 255))
    # HOLD stamp lands below the maths, clear of the caption pill (no subscript)
    decision_stamp(base, (cx, y1 - 46), 'hold', t, t0 + 2.6, size=40, subscript=None)


# ------------------------------------------------------------------ counters
def counter(base, cxy, value, t, t0, dur=1.2, size=110, denom=None, label=None,
            sub=None, color=None):
    """Ease-out count-up with tabular mono digits; lands exactly on `value`."""
    p = ds.anim(t, t0, dur)
    if p <= 0:
        return
    color = color or ds.ON_DARK
    d = ImageDraw.Draw(base)
    f_n = ds.font('mono', 700, size)
    shown = ds.count_up(value, p)
    parts = shown + (f' / {denom}' if denom else '')
    f_d = ds.font('mono', 500, int(size * 0.5))
    nw = d.textlength(shown, font=f_n)
    dw = d.textlength(f' / {denom}', font=f_d) if denom else 0
    x = cxy[0] - (nw + dw) / 2
    y = cxy[1] - size * 0.62
    d.text((x, y), shown, font=f_n, fill=ds.rgba(color, 255))
    if denom:
        d.text((x + nw, y + size * 0.34), f' / {denom}', font=f_d,
               fill=ds.rgba(ds.ON_DARK_3, 255))
    if label:
        f_l = ds.font('body', 600, 32)
        lw = d.textlength(label, font=f_l)
        d.text((cxy[0] - lw / 2, cxy[1] + size * 0.52), label, font=f_l,
               fill=ds.rgba(ds.ON_DARK_2, 255))
    if sub:
        f_s = ds.font('mono', 400, 24)
        sw = d.textlength(sub, font=f_s)
        d.text((cxy[0] - sw / 2, cxy[1] + size * 0.52 + 46), sub, font=f_s,
               fill=ds.rgba(ds.ON_DARK_3, 255))


# ------------------------------------------------------------------ chapter bar
def chapter_bar(base, t_global, chapters, total):
    """Top progress bar: 6 px track, labelled segments, current chapter lit."""
    d = ImageDraw.Draw(base)
    d.rectangle([0, 0, W, 6], fill=ds.rgba(ds.ON_DARK_LINE, 255))
    prog = max(0.0, min(1.0, t_global / max(0.001, total)))
    if prog > 0:
        d.rectangle([0, 0, int(W * prog), 6], fill=ds.rgba(ds.ACCENT, 255))
    f = ds.font('heading', 600, 22)
    for name, s0, s1 in chapters:
        x0 = int(W * s0 / total)
        x1 = int(W * s1 / total)
        if s0 > 0:
            d.rectangle([x0, 0, x0 + 2, 6], fill=ds.rgba(ds.DARK_BG, 255))
        active = s0 - 1e-6 <= t_global < s1
        label = name.upper()
        lw = ds.tracked_w(d, label, f, 0.12)
        if x1 - x0 < lw + 24:
            continue
        col = ds.ON_DARK if active else ds.ON_DARK_3
        ds.tracked(d, (x0 + 14, 16), label, f, ds.rgba(col, 255), 0.12)
        if active:
            d.rectangle([x0 + 14, 46, x0 + 14 + int(lw), 49], fill=ds.rgba(ds.ACCENT, 255))


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