#!/usr/bin/env python3
"""Briefing video, step 1: slides (exact figures, calm typography) + human narration + timeline.

Usage: video/.venv/bin/python video/render.py <work-dir>     (work-dir holds briefing.json)
Writes slide*.png, voice.wav (polished, 48 kHz) and manifest.json (timeline for assemble.py).
"""
import datetime, json, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tts  # noqa: E402

WORK = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(HERE, 'work')
os.makedirs(WORK, exist_ok=True)
BRIEF = json.load(open(os.path.join(WORK, 'briefing.json')))
SEGS = BRIEF['narration_segments']
ART = os.path.join(HERE, 'title_artwork.png')
TARGET = float(os.environ.get('VIDEO_SECONDS', '60'))
# Business name for the header: whatever the title slide's sub names after the dot (from narration.js).
BIZ = (SEGS[0].get('sub') or '').split('·')[-1].strip() if '·' in (SEGS[0].get('sub') or '') else ''

W, H = 1920, 1080
PAPER = (250, 247, 241); INK = (44, 39, 33); SOFT = (112, 103, 92); FAINT = (160, 150, 138)
LINE = (231, 223, 211); TEAL = (47, 127, 111); AMBER = (168, 116, 28); RED = (170, 72, 56)
GREEN = (70, 120, 66); BLUE = (70, 106, 160)
RED_SOFT = (246, 230, 225); GREEN_SOFT = (229, 239, 227)
ACCENT = {'title': TEAL, 'stat': AMBER, 'facts': RED, 'shield': TEAL, 'eye': BLUE, 'done': GREEN}

AVENIR = '/System/Library/Fonts/Avenir Next.ttc'
FACE = {'bold': 0, 'demi': 2, 'medium': 5, 'regular': 7}
_fonts = {}
def font(weight, size):
    key = (weight, size)
    if key not in _fonts:
        try: _fonts[key] = ImageFont.truetype(AVENIR, size, index=FACE[weight])
        except OSError: _fonts[key] = ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', size, index=1 if weight in ('bold', 'demi') else 0)
    return _fonts[key]

def tracked(d, xy, text, fnt, fill, spacing=0.12):
    """Letter-spaced caps (for small labels)."""
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=fnt, fill=fill)
        x += d.textlength(ch, font=fnt) + fnt.size * spacing
    return x

def balanced(d, text, fnt, maxw):
    """Wrap, and if it takes two lines, split where the lines are most even (no orphans)."""
    lines = wrap(d, text, fnt, maxw)
    if len(lines) != 2: return lines
    words = text.split(); best = None
    for k in range(1, len(words)):
        a, b = ' '.join(words[:k]), ' '.join(words[k:])
        wa, wb = d.textlength(a, font=fnt), d.textlength(b, font=fnt)
        if max(wa, wb) <= maxw and (best is None or max(wa, wb) < best[0]): best = (max(wa, wb), [a, b])
    return best[1] if best else lines

def wrap(d, text, fnt, maxw):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = f'{cur} {w}'.strip()
        if d.textlength(t, font=fnt) <= maxw: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

try:
    DAY = datetime.datetime.fromisoformat(BRIEF['generated_at'].replace('Z', '+00:00')).strftime('%-d %b %Y')
except (KeyError, ValueError):
    DAY = ''

def frame(idx, kind):
    img = Image.new('RGB', (W, H), PAPER)
    if kind == 'title' and os.path.exists(ART):
        art = Image.open(ART).convert('RGB').resize((W, H), Image.LANCZOS)
        # Paper wash that is strong on the left (behind the words) and fades out to the right.
        x = np.linspace(0, 1, W)
        ramp = np.clip((0.80 - x) / 0.32, 0.0, 1.0)          # solid behind the words, gone by ~80% width
        ramp = ramp * ramp * (3 - 2 * ramp)                   # smoothstep
        alpha = (np.tile(0.25 + 0.70 * ramp, (H, 1)) * 255).astype(np.uint8)
        wash = Image.new('RGB', (W, H), PAPER)
        img = Image.composite(wash, art, Image.fromarray(alpha, 'L'))
    d = ImageDraw.Draw(img)
    tracked(d, (140, 92), 'CHAPERONE   ·   MORNING BRIEFING', font('demi', 24), SOFT, 0.14)
    if kind != 'title':
        right = '  ·  '.join(x for x in (BIZ, DAY) if x)
        f = font('medium', 26)
        d.text((W - 140 - d.textlength(right, font=f), 90), right, font=f, fill=SOFT)
        # progress: thin segmented rule
        n = len(SEGS); gap = 10; seg_w = (W - 280 - gap * (n - 1)) / n
        for i in range(n):
            x0 = 140 + i * (seg_w + gap)
            d.rounded_rectangle([x0, 1000, x0 + seg_w, 1006], radius=3, fill=TEAL if i <= idx else LINE)
        d.text((140, 1022), 'Every number traces to a file.', font=font('medium', 24), fill=FAINT)
    return img, d

def render(seg, idx):
    kind = seg['kind']
    acc = ACCENT.get(kind, TEAL)
    img, d = frame(idx, kind)
    kicker = (seg.get('kicker') or '').upper()
    if kind == 'title':
        y = 236
        tracked(d, (146, y), kicker, font('demi', 30), TEAL, 0.16)
        d.text((136, y + 40), seg['title'], font=font('bold', 150), fill=INK)
        d.text((146, y + 236), seg['sub'], font=font('regular', 46), fill=SOFT)
        d.text((146, y + 306), 'Watching your agents, so you don’t have to.', font=font('medium', 36), fill=TEAL)
        return img
    if kind == 'facts':
        tracked(d, (140, 214), kicker, font('demi', 28), acc, 0.16)
        d.text((136, 254), seg['title'], font=font('bold', 84), fill=INK)
        d.text((140, 368), seg['sub'], font=font('regular', 38), fill=SOFT)
        y = 470
        for row in seg.get('rows', [])[:3]:
            claimed = str(row['claimed']); real = row['real']
            try:
                rv = float(real)
                if claimed.strip().endswith('%'): real_s = f'{rv:g}%'
                elif 'day' in claimed: real_s = f'{rv:g} day' + ('' if rv == 1 else 's')
                else: real_s = f'{rv:,.0f}'
            except (ValueError, TypeError):
                real_s = str(real)
            d.rounded_rectangle([140, y, 820, y + 140], radius=22, fill=RED_SOFT)
            tracked(d, (176, y + 22), 'AGENT CLAIMED', font('demi', 20), SOFT, 0.14)
            d.text((174, y + 50), claimed, font=font('bold', 60), fill=RED)
            # strike-through on the made-up figure
            tw = d.textlength(claimed, font=font('bold', 60))
            d.line([176, y + 92, 176 + tw, y + 92], fill=RED, width=5)
            ay = y + 70  # drawn arrow (Avenir has no arrow glyph)
            d.line([850, ay, 922, ay], fill=FAINT, width=5)
            d.polygon([(930, ay), (906, ay - 15), (906, ay + 15)], fill=FAINT)
            d.rounded_rectangle([960, y, 1780, y + 140], radius=22, fill=GREEN_SOFT)
            tracked(d, (996, y + 22), 'ACTUALLY ON FILE', font('demi', 20), SOFT, 0.14)
            d.text((994, y + 50), real_s, font=font('bold', 60), fill=GREEN)
            src = row.get('file') or 'no file'
            sf = font('medium', 22)
            d.text((1748 - d.textlength(src, font=sf), y + 98), src, font=sf, fill=SOFT)
            y += 162
        return img
    # stat / shield / eye / done
    tf = font('bold', 104)
    lines = balanced(d, seg['title'], tf, 1600)[:2]
    sf = font('regular', 46)
    slines = wrap(d, seg['sub'], sf, 1500)[:3]
    block_h = 52 + len(lines) * 122 + 34 + len(slines) * 64
    y = max(230, (H - block_h) // 2 - 10)
    d.rounded_rectangle([140, y + 4, 150, y + 34], radius=5, fill=acc)
    tracked(d, (172, y), kicker, font('demi', 30), acc, 0.16)
    y += 58
    for ln in lines:
        d.text((134, y), ln, font=tf, fill=INK); y += 122
    y += 30
    for ln in slines:
        d.text((140, y), ln, font=sf, fill=SOFT); y += 64
    return img

# ---- narration -------------------------------------------------------------
voice, slides = [], []
for i, seg in enumerate(SEGS):
    y, marks = tts.synth(seg['say'])
    voice.append(y)
    png = os.path.join(WORK, f'slide{i}.png'); render(seg, i).save(png)
    slides.append(png)
    print(f'seg{i}: {len(y) / tts.SR:5.2f}s  {seg["kind"]:6s}  {seg["say"][:70]}')

speech = sum(len(v) for v in voice) / tts.SR
LEAD, TAIL, XFADE = 0.8, 1.8, 0.55
n = len(SEGS)
# Paragraph turns: a breath and a slide change. Slightly varied, never shorter than the crossfade.
base_gap = (TARGET - LEAD - TAIL - speech) / max(1, n - 1)
base_gap = max(XFADE + 0.35, min(1.8, base_gap))
rng = random.Random(7)
gaps = [base_gap * rng.uniform(0.88, 1.12) for _ in range(n - 1)]
# keep the total on target after jitter
if n > 1:
    corr = (TARGET - LEAD - TAIL - speech - sum(gaps)) / (n - 1)
    gaps = [max(XFADE + 0.35, g + corr) for g in gaps]

starts, t = [], LEAD
for i, v in enumerate(voice):
    starts.append(t); t += len(v) / tts.SR
    if i < n - 1: t += gaps[i]
total = t + TAIL

track = np.zeros(int(total * tts.SR) + 1, dtype=np.float32)
for s, v in zip(starts, voice):
    a = int(s * tts.SR); track[a:a + len(v)] += v
raw = os.path.join(WORK, 'voice_raw.wav'); tts.write(raw, track)
tts.polish(raw, os.path.join(WORK, 'voice.wav'))

# Slide i is on screen from the end of the crossfade into it; each change finishes just before the next line.
cuts = [starts[i + 1] - XFADE - 0.12 for i in range(n - 1)]
manifest = {
    'fps': 30, 'total': total, 'xfade': XFADE, 'speech': speech,
    'slides': [{'png': slides[i], 'kind': SEGS[i]['kind'], 'start': 0.0 if i == 0 else cuts[i - 1],
                'end': total if i == n - 1 else cuts[i] + XFADE, 'voice_at': starts[i],
                'voice_end': starts[i] + len(voice[i]) / tts.SR, 'say': SEGS[i]['say']} for i in range(n)],
    'voice': os.path.join(WORK, 'voice.wav'),
}
json.dump(manifest, open(os.path.join(WORK, 'manifest.json'), 'w'), indent=2)
print(f'speech {speech:.1f}s, gaps ~{base_gap:.2f}s, total {total:.1f}s')
