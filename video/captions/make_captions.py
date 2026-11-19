#!/usr/bin/env python3
"""3-minute demo, step B: word-accurate burned-in captions.

Usage: video/.venv/bin/python video/captions/make_captions.py [work-dir]

Input:  video/script/demo-script.json  (authoritative cue text + nominal timing)
        <work>/timing.json             (real measured audio + sentence marks, voice3.py)

The script's cue times came from the marketer's measured render. This regenerates
them against OUR actual audio: every cue is mapped into the sentence that speaks
it (character-position interpolation inside each measured sentence mark), so the
captions stay word-accurate even if a segment needed a speed fix. Cue TEXT is
never changed — the script covers 100 % of narration words and that is preserved.

Outputs (all deterministic):
    <work>/captions.json            final absolute cue times (renderer + assembler)
    video/captions/captions.ass     canonical re-timeable ASS (styled per demo-script.md §3)
    video/captions/captions.srt     SRT twin (reference / sidecar use)
    <work>/captions/cueNNN.png      per-cue 1920x1080 RGBA pill overlays (the actual
                                    burn-in pixels; homebrew ffmpeg has no libass, so
                                    the assembler overlays these with enable windows)
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, os.path.join(HERE, '..', 'motion'))
import ds  # noqa: E402

WORK = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(HERE, '..', 'work3')
WORK = os.path.normpath(WORK)
SCRIPT = os.path.normpath(os.path.join(HERE, '..', 'script', 'demo-script.json'))

script = json.load(open(SCRIPT))
timing = json.load(open(os.path.join(WORK, 'timing.json')))
tseg = {r['id']: r for r in timing['segments']}

def norm(s):
    return ' '.join(s.split())

cues_out = []
problems = []
n = 0
for seg in script['segments']:
    sid = seg['id']
    ts = tseg[sid]
    narration = norm(seg['narration'])
    marks = ts['sentence_marks']

    # sentence character spans inside the normalised narration
    sent_spans, pos = [], 0
    for m in marks:
        mt = norm(m['text'])
        i = narration.find(mt, pos)
        assert i == pos, f'seg{sid}: sentence not at expected position: {mt[:40]!r}'
        sent_spans.append((pos, pos + len(mt), m['start'], m['end']))
        pos += len(mt) + 1
    assert pos - 1 == len(narration), f'seg{sid}: sentences do not tile the narration'

    # cue character spans; concatenation must equal the narration (100 % coverage)
    cpos = 0
    for cue in seg['captions']:
        ct = norm(cue['text'])
        i = narration.find(ct, cpos)
        if i != cpos:
            problems.append(f'seg{sid}: cue not contiguous at {cpos}: {ct[:40]!r}')
            i = cpos  # keep going; proportional fallback below still yields sane times
        c0, c1 = i, i + len(ct)
        cpos = c1 + 1

        def time_at(idx):
            for s0, s1, a, b in sent_spans:
                if s0 <= idx <= s1 and s1 > s0:
                    return a + (idx - s0) / (s1 - s0) * (b - a)
            return sent_spans[-1][3]

        # start from the first char, end after the last char of the cue
        st = time_at(min(c0, len(narration)))
        en = time_at(min(max(c1 - 1, c0 + 1), len(narration)))
        n += 1
        cues_out.append({'id': n, 'seg': sid, 'text': cue['text'],
                         'start': st, 'end': max(en, st + 0.40),
                         'script_start': cue['start'], 'script_end': cue['end']})
    assert cpos - 1 == len(narration), f'seg{sid}: cues do not cover the narration'

# ---- constraints: inside segment, ordered, non-overlapping, min visible ----------
MIN_GAP = 0.02
MIN_SHOW = 0.45
for seg in script['segments']:
    lo, hi = seg['start'] + 0.05, seg['start'] + seg['duration'] - 0.08
    seg_cues = [c for c in cues_out if c['seg'] == seg['id']]
    prev_end = lo
    for c in seg_cues:
        c['start'] = min(max(c['start'], prev_end + MIN_GAP, lo), hi - MIN_SHOW)
        c['end'] = max(c['end'], c['start'] + MIN_SHOW)
        prev_end = c['end']
    # pull back from the segment tail if the last cue overran
    for c in reversed(seg_cues):
        if c['end'] > hi:
            shift = c['end'] - hi
            c['end'] -= shift
            c['start'] = max(lo, c['start'] - shift)
        hi = c['start'] - MIN_GAP
    for c in seg_cues:
        c['start'] = round(c['start'], 2)
        c['end'] = round(c['end'], 2)

# ---- verify ------------------------------------------------------------------------
for a, b in zip(cues_out, cues_out[1:]):
    assert a['end'] <= b['start'] + 1e-9, f'overlap: cue{a["id"]} {a["end"]} > cue{b["id"]} {b["start"]}'
for c in cues_out:
    seg = next(s for s in script['segments'] if s['id'] == c['seg'])
    assert seg['start'] <= c['start'] and c['end'] <= seg['start'] + seg['duration'], \
        f'cue {c["id"]} escapes segment {c["seg"]}'
    assert c['end'] - c['start'] >= 0.4, f'cue {c["id"]} too short'
if problems:
    print('WARNINGS:'); [print(' ', p) for p in problems]

# ---- write captions.json ------------------------------------------------------------
os.makedirs(os.path.join(WORK, 'captions'), exist_ok=True)
json.dump({'style': {'font': 'Source Sans 3 SemiBold', 'size': ds.CAP_FONT_SIZE,
                     'pill': 'rgba(15,23,42,0.92)', 'bottom_y': ds.CAP_BOTTOM,
                     'max_lines': 2, 'max_chars': 42},
           'cues': cues_out},
          open(os.path.join(WORK, 'captions.json'), 'w'), indent=2)

# ---- ASS + SRT ------------------------------------------------------------------------
def ass_t(x):
    h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60
    return f'{h}:{m:02d}:{s:05.2f}'

def srt_t(x):
    h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60
    ms = int(round((s - int(s)) * 1000)); s = int(s)
    if ms == 1000: s, ms = s + 1, 0
    return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'

# ASS mirrors the PNG pill: white Source Sans 3 semibold on a ~92 % opaque #0F172A box
# (BorderStyle=3), bottom-centre, 48 px margin. Kept as the re-timeable source artefact.
style = ('Style: Cap,Source Sans 3 SemiBold,54,&H00FFFFFF,&H00FFFFFF,&H00FFFFFF,'
         '&HEB2A170F,-1,0,0,0,100,0,0,3,18,0,2,160,160,48,1')
with open(os.path.join(HERE, 'captions.ass'), 'w') as f:
    f.write('[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n'
            'WrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\n'
            'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, '
            'BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, '
            'BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
            f'{style}\n\n[Events]\n'
            'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n')
    for c in cues_out:
        f.write(f'Dialogue: 0,{ass_t(c["start"])},{ass_t(c["end"])},Cap,,0,0,0,,{c["text"]}\n')

with open(os.path.join(HERE, 'captions.srt'), 'w') as f:
    for i, c in enumerate(cues_out, 1):
        f.write(f'{i}\n{srt_t(c["start"])} --> {srt_t(c["end"])}\n{c["text"]}\n\n')

# ---- pill PNGs (the actual burn-in pixels) --------------------------------------------
for c in cues_out:
    ds.caption_pill_image(c['text']).save(os.path.join(WORK, 'captions', f'cue{c["id"]:03d}.png'))

drift = max(abs(c['start'] - c['script_start']) for c in cues_out)
print(f'{len(cues_out)} cues -> captions.json / captions.ass / captions.srt / {len(cues_out)} pill PNGs')
print(f'max drift vs script cue times: {drift:.3f}s (our audio vs the marketer\'s measured render)')
