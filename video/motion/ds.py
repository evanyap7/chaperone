#!/usr/bin/env python3
"""Chaperone design-system drawing kit for the motion graphics (video/motion/*).

Single source of truth for the video's look, mirroring
design-system/chaperone/tokens.css and MASTER.md:
  * palette: slate field #F8FAFC, white surfaces, navy ink #0F172A, accent #0369A1,
    the six semantic status triples (done/waiting/held/blocked/fabricated/regulated);
  * fonts: Lexend (headings/metrics), Source Sans 3 (body), JetBrains Mono
    (numbers, paths, rule/scenario IDs) — variable TTFs in video/motion/fonts/,
    weight selected through the FreeType variation API;
  * motion feel: 300–450 ms transitions, ease-out cubic (power2.out class), 60 ms stagger;
  * flat: no gradients, no shadows, hairline borders, status = colour + icon + label.

All drawing helpers are deterministic pure functions of (state, time).
"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTDIR = os.path.join(HERE, 'fonts')

W, H = 1920, 1080
FPS = 30

# ---- tokens.css :root --------------------------------------------------------
def hx(s):
    s = s.lstrip('#')
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))

BG          = hx('#F8FAFC'); SURFACE    = hx('#FFFFFF'); SUNKEN   = hx('#E8ECF1')
BORDER      = hx('#E2E8F0'); BORDER_ST = hx('#94A3B8')
INK         = hx('#0F172A'); INK2       = hx('#334155'); MUTED    = hx('#475569')
INVERSE     = hx('#FFFFFF')
ACCENT      = hx('#0369A1'); ACCENT_ST  = hx('#075985'); ACCENT_TINT = hx('#E1F1FC')
DESTRUCTIVE = hx('#DC2626'); DESTRUCT_ST = hx('#B42318')
BADGE_AMBER = hx('#F2B544')
DONE_FG     = hx('#146C33'); DONE_BG    = hx('#E9F7EE'); DONE_BORDER = hx('#A9D9B8')
WAIT_FG     = hx('#8A5300'); WAIT_BG    = hx('#FDF1D7'); WAIT_BORDER = hx('#E8C988')
HELD_FG     = hx('#075985'); HELD_BG    = hx('#E1F1FC'); HELD_BORDER = hx('#9CC9E8')
BLOCK_FG    = hx('#B42318'); BLOCK_BG   = hx('#FBEAE7'); BLOCK_BORDER = hx('#EDA69C')
FAB_FG      = hx('#9D174D'); FAB_BG     = hx('#FCE8F1'); FAB_BORDER = hx('#EBAAC8')
REG_FG      = hx('#3730A3'); REG_BG     = hx('#E7E8FB'); REG_BORDER = hx('#ABAFE3')
# dark cards (title/endcard): navy field, slate ramp for secondary text (same ramp
# the tokens already use: #94A3B8 border-strong, #E2E8F0 border, #E1F1FC accent tint)
DARK_BG     = INK
DARK_FADE   = hx('#0B1120')   # --color-primary-active, the endcard fade-to
ON_DARK     = INVERSE
ON_DARK_2   = hx('#CBD5E1')
ON_DARK_3   = BORDER_ST
ON_DARK_LINE = hx('#1E293B')  # --color-primary-hover, hairlines on navy

STATUS = {  # name -> (fg, bg, border)
    'done': (DONE_FG, DONE_BG, DONE_BORDER), 'waiting': (WAIT_FG, WAIT_BG, WAIT_BORDER),
    'held': (HELD_FG, HELD_BG, HELD_BORDER), 'blocked': (BLOCK_FG, BLOCK_BG, BLOCK_BORDER),
    'fabricated': (FAB_FG, FAB_BG, FAB_BORDER), 'regulated': (REG_FG, REG_BG, REG_BORDER),
}

# ---- motion tokens ------------------------------------------------------------
DUR_FAST, DUR_BASE, DUR_SLOW, DUR_STAGGER = 0.120, 0.200, 0.350, 0.060

def ease_out_cubic(x):
    """--ease-out: cubic-bezier(0.33, 1, 0.68, 1) — power2/3.out class."""
    x = min(1.0, max(0.0, x))
    return 1.0 - (1.0 - x) ** 3

def ease_standard(x):
    """--ease-standard: cubic-bezier(0.2, 0, 0, 1), approximated with smoothstep."""
    x = min(1.0, max(0.0, x))
    return x * x * (3.0 - 2.0 * x)

def anim(t, start, dur=DUR_SLOW, ease=ease_out_cubic):
    """Eased 0→1 progress of a transition that begins at `start` (seconds)."""
    if dur <= 0:
        return 1.0 if t >= start else 0.0
    return ease((t - start) / dur)

def lerp(a, b, p):
    return a + (b - a) * p

def mix(c1, c2, p):
    return tuple(int(round(lerp(a, b, p))) for a, b in zip(c1, c2))

def rgba(c, a=255):
    return (c[0], c[1], c[2], int(round(a)))

# ---- fonts ---------------------------------------------------------------------
_FAMILIES = {'heading': 'Lexend.ttf', 'body': 'SourceSans3.ttf',
             'body_it': 'SourceSans3-Italic.ttf', 'mono': 'JetBrainsMono.ttf'}
_fonts = {}

def font(family, weight, size):
    """Cached variable-font instance pinned to an exact weight (deterministic)."""
    key = (family, weight, size)
    if key not in _fonts:
        f = ImageFont.truetype(os.path.join(FONTDIR, _FAMILIES[family]), size)
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
        _fonts[key] = f
    return _fonts[key]

def text_w(d, s, f):
    return d.textlength(s, font=f)

def tracked(d, xy, s, f, fill, spacing=0.14, alpha_layer=None):
    """Letter-spaced small caps (overlines, kickers)."""
    x, y = xy
    for ch in s:
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f) + f.size * spacing
    return x

def tracked_w(d, s, f, spacing=0.14):
    return sum(d.textlength(ch, font=f) + f.size * spacing for ch in s) - f.size * spacing

def wrap(d, text, f, maxw):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = f'{cur} {w}'.strip()
        if d.textlength(t, font=f) <= maxw:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    return lines

# ---- compositing helpers ---------------------------------------------------------
def fade_layer(base, draw_fn, alpha, box=None):
    """Run draw_fn(ImageDraw on a transparent layer) and paste it at `alpha` 0..1.

    box=(x0,y0,x1,y1) limits the layer (faster); default is the full frame.
    draw_fn receives (layer_draw, offset_xy).
    """
    if alpha <= 0.003:
        return
    x0, y0, x1, y1 = box or (0, 0, W, H)
    layer = Image.new('RGBA', (x1 - x0, y1 - y0), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    draw_fn(ld, (x0, y0))
    if alpha < 0.999:
        a = layer.getchannel('A').point(lambda v: int(v * alpha))
        layer.putalpha(a)
    base.alpha_composite(layer, (x0, y0))

def rotated_text_layer(base, cxy, s, f, fill, angle, alpha=1.0, stroke=0, stroke_fill=None):
    """Text rendered on its own layer, rotated about its centre, pasted at alpha."""
    if alpha <= 0.003:
        return
    pad = 40
    tmp = Image.new('RGBA', (16, 16))
    td = ImageDraw.Draw(tmp)
    tw, th = td.textbbox((0, 0), s, font=f, stroke_width=stroke)[2:]
    layer = Image.new('RGBA', (int(tw) + pad * 2, int(th) + pad * 2), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.text((pad, pad), s, font=f, fill=rgba(fill, 255),
            stroke_width=stroke, stroke_fill=rgba(stroke_fill or fill, 255))
    if angle:
        layer = layer.rotate(angle, expand=True, resample=Image.BICUBIC)
    if alpha < 0.999:
        a = layer.getchannel('A').point(lambda v: int(v * alpha))
        layer.putalpha(a)
    base.alpha_composite(layer, (int(cxy[0] - layer.width / 2), int(cxy[1] - layer.height / 2)))

# ---- primitives -------------------------------------------------------------------
def card(d, box, fill=SURFACE, border=BORDER, radius=14, width=1, alpha=1.0):
    """Flat card: surface + hairline border, --radius-lg. No shadow (flat design)."""
    if alpha >= 0.999:
        d.rounded_rectangle(box, radius=radius, fill=fill, outline=border, width=width)
        return
    x0, y0, x1, y1 = [int(v) for v in box]
    layer = Image.new('RGBA', (x1 - x0, y1 - y0), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle([0, 0, x1 - x0 - 1, y1 - y0 - 1], radius=radius,
                         fill=rgba(fill, 255), outline=rgba(border, 255), width=width)
    a = layer.getchannel('A').point(lambda v: int(v * alpha))
    layer.putalpha(a)
    layer._chaperone_target = (x0, y0)
    return layer

def paste_card(base, box, fill=SURFACE, border=BORDER, radius=14, width=1, alpha=1.0):
    if alpha <= 0.003:
        return
    x0, y0, x1, y1 = [int(v) for v in box]
    layer = Image.new('RGBA', (max(1, x1 - x0), max(1, y1 - y0)), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle([0, 0, layer.width - 1, layer.height - 1], radius=radius,
                         fill=rgba(fill, 255), outline=rgba(border, 255), width=width)
    if alpha < 0.999:
        a = layer.getchannel('A').point(lambda v: int(v * alpha))
        layer.putalpha(a)
    base.alpha_composite(layer, (x0, y0))

def pill(base, cxy_or_xy, label, fg, bg, border, icon=None, f=None, height=52,
         pad_x=24, gap=10, center=False, alpha=1.0, icon_scale=0.62):
    """Status pill: colour + icon + text label, always together (MASTER §3.4/§6.4).

    Returns the drawn width. cxy_or_xy is the left-middle point unless center=True.
    """
    if alpha <= 0.003:
        return 0
    f = f or font('body', 600, int(height * 0.52))
    d0 = ImageDraw.Draw(base)
    tw = d0.textlength(label, font=f)
    icon_d = int(height * icon_scale) if icon else 0
    wdt = int(pad_x * 2 + tw + (icon_d + gap if icon else 0))
    x = int(cxy_or_xy[0] - wdt / 2) if center else int(cxy_or_xy[0])
    y = int(cxy_or_xy[1] - height / 2)
    layer = Image.new('RGBA', (wdt, height), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle([0, 0, wdt - 1, height - 1], radius=height // 2,
                         fill=rgba(bg, 255), outline=rgba(border, 255), width=2)
    cx = pad_x
    if icon:
        ICONS[icon](ld, cx + icon_d / 2, height / 2, icon_d / 2, fg, max(2, int(icon_d / 9)))
        cx += icon_d + gap
    ld.text((cx, (height - f.size * 1.18) / 2), label, font=f, fill=rgba(fg, 255))
    if alpha < 0.999:
        a = layer.getchannel('A').point(lambda v: int(v * alpha))
        layer.putalpha(a)
    base.alpha_composite(layer, (x, y))
    return wdt

def chip_mono(base, xy, label, alpha=1.0, size=28, fg=None, bg=None, border=None, center=False):
    """Small monospace chip for scenario/rule IDs (pill-scenario), never spoken."""
    fg = fg or MUTED; bg = bg or SURFACE; border = border or BORDER
    return pill(base, xy, label, fg, bg, border, icon=None,
                f=font('mono', 500, size), height=int(size * 1.9),
                pad_x=int(size * 0.7), alpha=alpha, center=center)

def dashed_line(d, p0, p1, color, width=3, dash=14, gap=10, progress=1.0):
    x0, y0 = p0; x1, y1 = p1
    L = math.hypot(x1 - x0, y1 - y0)
    if L == 0 or progress <= 0:
        return
    L *= min(1.0, progress)
    ux, uy = (x1 - x0) / math.hypot(x1 - x0, y1 - y0), (y1 - y0) / math.hypot(x1 - x0, y1 - y0)
    pos = 0.0
    while pos < L:
        e = min(pos + dash, L)
        d.line([x0 + ux * pos, y0 + uy * pos, x0 + ux * e, y0 + uy * e], fill=color, width=width)
        pos = e + gap

def arrow_head(d, tip, angle_deg, color, size=14):
    a = math.radians(angle_deg)
    p1 = (tip[0] - size * math.cos(a - 0.42), tip[1] - size * math.sin(a - 0.42))
    p2 = (tip[0] - size * math.cos(a + 0.42), tip[1] - size * math.sin(a + 0.42))
    d.polygon([tip, p1, p2], fill=color)

def poly_partial(d, pts, progress, fill=None, width=2, joint='curve'):
    """Draw a polyline truncated to `progress` of its total length (line-draw anim)."""
    if progress <= 0:
        return
    segs = [(pts[i], pts[i + 1], math.dist(pts[i], pts[i + 1])) for i in range(len(pts) - 1)]
    total = sum(s[2] for s in segs)
    budget = total * min(1.0, progress)
    out = []
    for a, b, L in segs:
        if budget <= 0:
            break
        if L <= budget:
            out.extend([a, b]); budget -= L
        else:
            f = budget / L
            out.extend([a, (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)]); budget = 0
    if len(out) >= 2:
        d.line(out, fill=fill, width=width, joint=joint)

# ---- icons: 2px-stroke-on-24-viewbox geometry, scaled (MASTER §5) --------------------
def _sw(r):
    return max(2, int(round(2 * r / 12.0)))

def ic_check(d, cx, cy, r, color, sw=None, progress=1.0):
    sw = sw or _sw(r)
    k = r / 12.0
    poly_partial(d, [(cx - 6 * k, cy + 0.5 * k), (cx - 1.5 * k, cy + 5 * k), (cx + 7 * k, cy - 5 * k)],
                 progress, fill=color, width=sw)

def ic_check_circle(d, cx, cy, r, color, sw=None, progress=1.0):
    sw = sw or _sw(r)
    p = min(1.0, progress)
    if p > 0:
        d.arc([cx - r, cy - r, cx + r, cy + r], -90, -90 + 360 * min(1.0, p / 0.6), fill=color, width=sw)
    if p > 0.6:
        ic_check(d, cx, cy, r * 0.62, color, sw, (p - 0.6) / 0.4)

def ic_cross_circle(d, cx, cy, r, color, sw=None, progress=1.0):
    sw = sw or _sw(r)
    d.arc([cx - r, cy - r, cx + r, cy + r], 0, 360 * min(1.0, progress / 0.5), fill=color, width=sw)
    if progress > 0.5:
        k = r * 0.5 * min(1.0, (progress - 0.5) / 0.5)
        d.line([cx - k, cy - k, cx + k, cy + k], fill=color, width=sw)
        d.line([cx - k, cy + k, cx + k, cy - k], fill=color, width=sw)

def ic_stop(d, cx, cy, r, color, sw=None, progress=1.0):
    """Octagon + minus bar (the 'Stopped' silhouette)."""
    sw = sw or _sw(r)
    pts = []
    for i in range(8):
        a = math.radians(22.5 + 45 * i)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    pts.append(pts[0])
    poly_partial(d, pts, min(1.0, progress / 0.65), fill=color, width=sw)
    if progress > 0.65:
        k = r * 0.52 * min(1.0, (progress - 0.65) / 0.35)
        d.line([cx - k, cy, cx + k, cy], fill=color, width=sw)

def ic_pause_circle(d, cx, cy, r, color, sw=None, progress=1.0):
    """Circle + two pause bars ('Waiting for you')."""
    sw = sw or _sw(r)
    d.arc([cx - r, cy - r, cx + r, cy + r], -90, -90 + 360 * min(1.0, progress / 0.6), fill=color, width=sw)
    if progress > 0.6:
        p = min(1.0, (progress - 0.6) / 0.4)
        bh = r * 0.62 * p
        for dx in (-r * 0.28, r * 0.28):
            d.line([cx + dx, cy - bh, cx + dx, cy + bh], fill=color, width=sw)

def ic_eye(d, cx, cy, r, color, sw=None, progress=1.0):
    sw = sw or _sw(r)
    k = r / 12.0
    poly_partial(d, [(cx - 9.2 * k, cy), (cx - 4.6 * k, cy - 5.4 * k), (cx + 4.6 * k, cy - 5.4 * k),
                     (cx + 9.2 * k, cy), (cx + 4.6 * k, cy + 5.4 * k), (cx - 4.6 * k, cy + 5.4 * k),
                     (cx - 9.2 * k, cy)], min(1.0, progress / 0.6), fill=color, width=sw)
    if progress > 0.6:
        rr = 3 * k * min(1.0, (progress - 0.6) / 0.4)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=color, width=sw)

def ic_lock(d, cx, cy, r, color, sw=None, progress=1.0):
    sw = sw or _sw(r)
    k = r / 12.0
    p = min(1.0, progress)
    if p > 0.4:
        q = min(1.0, (p - 0.4) / 0.6)
        d.rounded_rectangle([cx - 6.75 * k, cy - 1.5 * k, cx + 6.75 * k, cy - 1.5 * k + 10 * k * q],
                            radius=2 * k, outline=color, width=sw)
    if p > 0:
        q = min(1.0, p / 0.4)
        d.arc([cx - 3.5 * k, cy - 8.6 * k, cx + 3.5 * k, cy - 1.6 * k], 180, 180 + 180 * q, fill=color, width=sw)
        if q >= 1:
            d.line([cx + 3.5 * k, cy - 5.1 * k, cx + 3.5 * k, cy - 1.6 * k], fill=color, width=sw)

def ic_mail(d, cx, cy, r, color, sw=None, progress=1.0):
    sw = sw or _sw(r)
    k = r / 12.0
    x0, y0, x1, y1 = cx - 9 * k, cy - 6.5 * k, cx + 9 * k, cy + 6.5 * k
    d.rectangle([x0, y0, x1, y1], outline=color, width=sw)
    poly_partial(d, [(x0, y0), (cx, cy + 1 * k), (x1, y0)], min(1.0, progress), fill=color, width=sw)

def ic_file(d, cx, cy, r, color, sw=None, progress=1.0):
    sw = sw or _sw(r)
    k = r / 12.0
    poly_partial(d, [(cx - 6 * k, cy - 9 * k), (cx + 2 * k, cy - 9 * k), (cx + 6 * k, cy - 5 * k),
                     (cx + 6 * k, cy + 9 * k), (cx - 6 * k, cy + 9 * k), (cx - 6 * k, cy - 9 * k)],
                 min(1.0, progress), fill=color, width=sw)

def ic_person(d, cx, cy, r, color, sw=None, progress=1.0):
    sw = sw or _sw(r)
    k = r / 12.0
    hr = 4 * k * min(1.0, progress / 0.5)
    if hr > 0.5:
        d.ellipse([cx - hr, cy - 8.5 * k, cx + hr, cy - 8.5 * k + 2 * hr], outline=color, width=sw)
    if progress > 0.5:
        q = min(1.0, (progress - 0.5) / 0.5)
        d.arc([cx - 7.5 * k, cy - 1 * k, cx + 7.5 * k, cy + 14 * k], 180, 180 + 180 * q, fill=color, width=sw)

def ic_shield(d, cx, cy, r, color, sw=None, progress=1.0, fill=None):
    """Brand mark: shield outline that can draw itself."""
    sw = sw or _sw(r)
    k = r / 12.0
    pts = [(cx, cy - 10.5 * k), (cx + 8.5 * k, cy - 7 * k), (cx + 8.5 * k, cy + 0.5 * k),
           (cx + 5 * k, cy + 6.5 * k), (cx, cy + 10.5 * k), (cx - 5 * k, cy + 6.5 * k),
           (cx - 8.5 * k, cy + 0.5 * k), (cx - 8.5 * k, cy - 7 * k), (cx, cy - 10.5 * k)]
    if fill and progress >= 1.0:
        d.polygon(pts[:-1], fill=fill)
    poly_partial(d, pts, progress, fill=color, width=sw)

def ic_arrow_right(d, cx, cy, r, color, sw=None, progress=1.0):
    sw = sw or _sw(r)
    k = r / 12.0
    poly_partial(d, [(cx - 9 * k, cy), (cx + 9 * k, cy)], min(1.0, progress / 0.7), fill=color, width=sw)
    if progress > 0.7:
        q = min(1.0, (progress - 0.7) / 0.3)
        poly_partial(d, [(cx + 3 * k, cy - 5 * k), (cx + 9 * k, cy), (cx + 3 * k, cy + 5 * k)],
                     q, fill=color, width=sw)

ICONS = {'check': ic_check, 'done': ic_check_circle, 'cross': ic_cross_circle, 'stop': ic_stop,
         'wait': ic_pause_circle, 'eye': ic_eye, 'lock': ic_lock, 'mail': ic_mail,
         'file': ic_file, 'person': ic_person, 'shield': ic_shield, 'arrow': ic_arrow_right}

def status_pill(base, xy, status, label=None, height=52, alpha=1.0, center=False, size=None):
    """Semantic status pill with its mandatory icon + exact label (MASTER §3.2)."""
    fg, bg, bd = STATUS[status]
    icon = {'done': 'done', 'waiting': 'wait', 'held': 'eye', 'blocked': 'stop',
            'fabricated': 'cross', 'regulated': 'lock'}[status]
    label = label or {'done': 'Done', 'waiting': 'Waiting for you', 'held': 'Needs a look',
                      'blocked': 'Stopped', 'fabricated': 'Figure not on file',
                      'regulated': 'Regulated data'}[status]
    f = font('body', 600, size) if size else None
    return pill(base, xy, label, fg, bg, bd, icon=icon, f=f, height=height, alpha=alpha, center=center)

# ---- caption pill (single source of truth for burned-in caption pixels) ------------
CAP_FONT_SIZE = 40
CAP_BOTTOM = 1032          # pill bottom edge (bottom-third safe area at 1080p)
CAP_MAXW = 1560
CAP_BG = INK               # #0F172A
CAP_BG_ALPHA = 235         # ~92 % opaque
CAP_PAD_X, CAP_PAD_Y, CAP_RADIUS = 40, 18, 999

def caption_pill_image(text):
    """Full-frame transparent RGBA with the caption pill for one cue, bottom-centred."""
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font('body', 600, CAP_FONT_SIZE)
    lines = wrap(d, text, f, CAP_MAXW - 2 * CAP_PAD_X)[:2]
    lh = int(CAP_FONT_SIZE * 1.28)
    tw = max(d.textlength(ln, font=f) for ln in lines)
    bw = int(tw + 2 * CAP_PAD_X)
    bh = int(len(lines) * lh + 2 * CAP_PAD_Y - (lh - CAP_FONT_SIZE))
    x0 = (W - bw) // 2
    y1 = CAP_BOTTOM
    y0 = y1 - bh
    d.rounded_rectangle([x0, y0, x0 + bw, y1], radius=min(CAP_RADIUS, bh // 2),
                        fill=rgba(CAP_BG, CAP_BG_ALPHA))
    y = y0 + CAP_PAD_Y - int((lh - CAP_FONT_SIZE) / 2)
    for ln in lines:
        d.text(((W - d.textlength(ln, font=f)) / 2, y), ln, font=f, fill=rgba(INVERSE, 255))
        y += lh
    return img

# ---- shared segment chrome -----------------------------------------------------------
def light_bg():
    img = Image.new('RGBA', (W, H), rgba(BG, 255))
    return img

def brand_row(base, alpha=1.0, dark=False):
    """Tiny brand mark top-left: shield + CHAPERONE (Lexend semibold, tracked)."""
    if alpha <= 0.003:
        return
    col = ON_DARK if dark else INK
    def draw(d, off):
        x, y = off
        ic_shield(d, x + 15, y + 15, 13, col, 2, 1.0)
        tracked(d, (x + 42, y + 2), 'CHAPERONE', font('heading', 600, 24), col, 0.18)
    fade_layer(base, draw, alpha, box=(140, 56, 560, 100))

def seg_header(base, t, headline, sub=None, t0=0.15, dark=False, x=140, y=132, hsize=72):
    """Heading + sub with the standard slide-up/fade entrance."""
    ink = ON_DARK if dark else INK
    mut = ON_DARK_2 if dark else MUTED
    p = anim(t, t0, 0.45)
    if p <= 0:
        return
    dy = lerp(26, 0, p)
    fh = font('heading', 600, hsize)
    d = ImageDraw.Draw(base)
    def draw(dd, off):
        dd.text((x - off[0], y + dy - off[1]), headline, font=fh, fill=rgba(ink, 255))
    fade_layer(base, draw, p, box=(x - 10, int(y + dy) - 10, W - 100, int(y + dy) + hsize + 30))
    if sub:
        ps = anim(t, t0 + 0.12, 0.45)
        if ps > 0:
            fs = font('body', 400, 36)
            def draw2(dd, off):
                dd.text((x - off[0], y + hsize + 22 + lerp(18, 0, ps) - off[1]),
                        sub, font=fs, fill=rgba(mut, 255))
            fade_layer(base, draw2, ps,
                       box=(x - 10, y + hsize, W - 100, y + hsize + 80))

def stamp(base, cxy, text, color, t, t0, size=44, angle=-7, dur=0.28):
    """Rubber-stamp entrance: shrink from 1.5×, slight rotation (state-explaining motion)."""
    p = anim(t, t0, dur)
    if p <= 0:
        return
    f = font('heading', 700, size)
    d0 = ImageDraw.Draw(base)
    tw = d0.textlength(text, font=f)
    scale = lerp(1.5, 1.0, p)
    fs = font('heading', 700, max(8, int(size * scale)))
    dtmp = ImageDraw.Draw(Image.new('RGBA', (8, 8)))
    tw2 = dtmp.textlength(text, font=fs)
    pad = 34
    layer = Image.new('RGBA', (int(tw2) + pad * 2, int(size * scale * 1.6) + pad * 2), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    cxl, cyl = layer.width / 2, layer.height / 2
    ld.rounded_rectangle([cxl - tw2 / 2 - 14, cyl - size * scale * 0.62,
                          cxl + tw2 / 2 + 14, cyl + size * scale * 0.62],
                         radius=10, outline=rgba(color, 255), width=5)
    ld.text((cxl - tw2 / 2, cyl - size * scale * 0.55), text, font=fs, fill=rgba(color, 255))
    layer = layer.rotate(angle, expand=True, resample=Image.BICUBIC)
    a = layer.getchannel('A').point(lambda v: int(v * min(1.0, p * 1.4)))
    layer.putalpha(a)
    base.alpha_composite(layer, (int(cxy[0] - layer.width / 2), int(cxy[1] - layer.height / 2)))

def strike_through(base, x, y, w, color, progress, thickness=5, dy=0):
    if progress <= 0:
        return
    d = ImageDraw.Draw(base)
    d.line([x, y + dy, x + w * min(1.0, progress), y + dy], fill=color, width=thickness)

def count_up(value, p, fmt='{:,.0f}'):
    """Deterministic count-up for stats; lands exactly on the real value."""
    v = value * ease_out_cubic(p)
    if p >= 1.0:
        return fmt.format(value)
    return fmt.format(v)
