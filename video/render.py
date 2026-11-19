#!/usr/bin/env python3
"""Render briefing slides (exact figures, calm typography) and synthesize narration."""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(HERE, 'work')
os.makedirs(WORK, exist_ok=True)
BRIEF = json.load(open(os.path.join(WORK, 'briefing.json')))
SEGS = BRIEF['narration_segments']
ART = os.path.join(HERE, 'title_artwork.png')

W, H = 1920, 1080
PAPER = (250, 247, 241); CARD = (255, 255, 255); INK = (44, 39, 33); SOFT = (109, 100, 89)
LINE = (231, 223, 211); TEAL = (47, 127, 111); AMBER = (176, 122, 30); RED = (176, 74, 58)
GREEN = (74, 124, 70); BLUE = (74, 111, 165)
RED_SOFT = (246, 228, 224); GREEN_SOFT = (230, 239, 228); TEAL_SOFT = (227, 240, 236)
ACCENT = {'title': TEAL, 'stat': AMBER, 'facts': RED, 'shield': TEAL, 'eye': BLUE, 'done': GREEN}

FB = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
FR = '/System/Library/Fonts/Supplemental/Arial.ttf'
def font(path, size): return ImageFont.truetype(path, size)

def wrap(draw, text, fnt, maxw):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = f'{cur} {w}'.strip()
        if draw.textlength(t, font=fnt) <= maxw: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def rrect(d, xy, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=width)

def base(kind, idx):
    img = Image.new('RGB', (W, H), PAPER)
    d = ImageDraw.Draw(img)
    if kind == 'title' and os.path.exists(ART):
        art = Image.open(ART).convert('RGB').resize((W, H))
        img.paste(art, (0, 0))
        ov = Image.new('RGBA', (W, H), PAPER + (205,))
        img = Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB')
        d = ImageDraw.Draw(img)
    d.text((140, 84), 'CHAPERONE  ·  MORNING BRIEFING', font=font(FB, 30), fill=SOFT)
    # footer dots
    n = len(SEGS); dotr = 9; gap = 34; total = n * gap
    x0 = (W - total) // 2
    for i in range(n):
        cx = x0 + i * gap + gap // 2
        col = TEAL if i == idx else LINE
        d.ellipse([cx - dotr, 986 - dotr, cx + dotr, 986 + dotr], fill=col)
    d.text((140, 1014), 'Every number traces to a file.', font=font(FR, 28), fill=SOFT)
    d.text((W - 460, 1014), 'Lumen Studio · 19 Nov 2026', font=font(FR, 28), fill=SOFT)
    return img, d

def render(seg, idx):
    kind = seg['kind']
    img, d = base(kind, idx)
    acc = ACCENT.get(kind, TEAL)
    if kind == 'facts':
        rrect(d, [140, 230, 154, 350], 7, fill=acc)
        d.text((190, 232), seg['title'], font=font(FB, 84), fill=INK)
        d.text((190, 348), seg['sub'], font=font(FR, 42), fill=SOFT)
        y = 470
        for row in seg.get('rows', [])[:3]:
            claimed = str(row['claimed'])
            real = row['real']
            try:
                rv = float(real)
                if claimed.strip().endswith('%'): real_s = f'{rv:g}%'
                elif 'day' in claimed: real_s = f'{rv:g} days'
                else: real_s = f'{rv:,.0f}'
            except (ValueError, TypeError):
                real_s = str(real)
            rrect(d, [190, y, 890, y + 150], 18, fill=RED_SOFT)
            d.text((222, y + 18), 'AGENT CLAIMED', font=font(FB, 24), fill=SOFT)
            d.text((222, y + 52), claimed, font=font(FB, 56), fill=RED)
            d.text((925, y + 48), '→', font=font(FB, 60), fill=SOFT)
            rrect(d, [1010, y, 1780, y + 150], 18, fill=GREEN_SOFT)
            d.text((1042, y + 18), 'ACTUALLY ON FILE', font=font(FB, 24), fill=SOFT)
            d.text((1042, y + 52), real_s, font=font(FB, 56), fill=GREEN)
            src = (row.get('file') or 'no file')
            d.text((1250, y + 70), src, font=font(FR, 22), fill=SOFT)
            y += 172
        return img
    # title / stat / shield / eye / done
    rrect(d, [140, 300, 154, 420], 7, fill=acc)
    tf = font(FB, 96 if kind == 'title' else 88)
    lines = wrap(d, seg['title'], tf, 1560)
    y = 300 if kind == 'title' else 310
    for ln in lines[:2]:
        d.text((195, y), ln, font=tf, fill=INK); y += int(tf.size * 1.12)
    sf = font(FR, 46)
    slines = wrap(d, seg['sub'], sf, 1560)
    y += 36
    for ln in slines[:3]:
        d.text((195, y), ln, font=sf, fill=SOFT); y += 60
    if kind == 'title':
        d.text((195, y + 30), 'Watching your agents, so you don’t have to.', font=font(FR, 40), fill=TEAL)
    return img

def dur(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True)
    return float(out.stdout.strip())

manifest = []
speech_total = 0.0
for i, seg in enumerate(SEGS):
    aiff = os.path.join(WORK, f'seg{i}.aiff'); wav = os.path.join(WORK, f'seg{i}.wav')
    subprocess.run(['say', '-v', 'Samantha', '-r', '172', '-o', aiff, seg['say']], check=True)
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', aiff, '-ar', '44100', '-ac', '1', wav], check=True)
    dd = dur(wav); speech_total += dd
    png = os.path.join(WORK, f'slide{i}.png')
    render(seg, i).save(png)
    manifest.append({'i': i, 'slide': png, 'audio': wav, 'speech': dd, 'kind': seg['kind']})
    print(f'seg{i}: {dd:.2f}s  {seg["kind"]:6s}  {seg["say"][:60]}')

pad = max(0.35, min(1.2, (60.0 - speech_total) / len(SEGS)))
for m in manifest: m['clip'] = m['speech'] + pad
total = sum(m['clip'] for m in manifest)
json.dump({'pad': pad, 'total': total, 'segments': manifest}, open(os.path.join(WORK, 'manifest.json'), 'w'), indent=2)
print(f'speech {speech_total:.1f}s + pad {pad:.2f}s x{len(SEGS)} -> total {total:.1f}s')