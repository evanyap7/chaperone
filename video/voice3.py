#!/usr/bin/env python3
"""Demo v3, step A: narration for all 16 segments of the 175 s cut + timing.

Usage: video/.venv/bin/python video/voice3.py [work-dir] [--only 13,14]
       (default work dir video/work_voice; --only re-synthesises just those
       segment ids and reuses the existing wavs/timing for the rest — segment
       starts stay locked for V2/V5)

Synthesises every segment's `narration` with Kokoro (video/tts.py, voice taken
from demo-script.json["voice"], af_heart), measures the REAL duration of each
render, and verifies it fits its slot:

    audio starts at  seg.start + lead_in   (0.25 s; hook uses 0.10 s)
    audio must end by seg.start + seg.duration - min_tail (0.20 s; hook 0.05 s)

If a segment overruns, the speed is raised just enough (re-synthesised, never a
word cut) and the exact value is recorded. Deterministic: tts.synth seeds its
pacing jitter from the md5 of the text, so re-runs are sample-identical.

Writes:
    <work>/audio/segNN.wav   polished 48 kHz mono voice per segment
    <work>/narration.wav     all segments placed on the absolute 175.0 s timeline
                             (V5 assembly reads THIS file)
    <work>/timing.json       per-segment allotted / measured / speed / headroom /
                             audio offset + absolute sentence marks. Step B
                             (video/captions/make_captions.py) adds per-word
                             whisper-aligned timestamps to the same file.
"""
import json, os, re, sys
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tts  # noqa: E402

args = [a for a in sys.argv[1:]]
only_ids = set()
if '--only' in args:
    i = args.index('--only')
    only_ids = {int(x) for x in args[i + 1].split(',')}
    del args[i:i + 2]
WORK = os.path.abspath(args[0]) if args else os.path.join(HERE, 'work_voice')
SCRIPT = os.path.join(HERE, 'script', 'demo-script.json')
LEAD_IN = 0.25     # first caption cue starts ~0.25 s into every segment
MIN_TAIL = 0.20    # audio must finish at least this far before the segment end
SR_OUT = 48000
old_timing = None
if only_ids:
    old_timing = {r['id']: r for r in json.load(open(os.path.join(WORK, 'timing.json')))['segments']}

script = json.load(open(SCRIPT))
assert script.get('schema_version') == 2, 'expected schema_version 2'
segs = script['segments']
total = script['total_seconds']
assert 170.0 <= total <= 178.0, f'total {total} outside the 170-178 s window'
assert abs(sum(s['duration'] for s in segs) - total) < 1e-9, 'segment durations must sum to total'
pos = 0.0
for s in segs:
    assert abs(s['start'] - pos) < 1e-9, f'seg{s["id"]} start {s["start"]} != running {pos}'
    pos += s['duration']

tts.VOICE = script['voice']['voice']
base_speed = float(script['voice'].get('speed', 1.0))
os.makedirs(os.path.join(WORK, 'audio'), exist_ok=True)

rows = []
track = np.zeros(int(round(total * SR_OUT)), dtype=np.float32)
word_total = 0

for seg in segs:
    sid, dur = seg['id'], seg['duration']
    if only_ids and sid not in only_ids:
        r = dict(old_timing[sid])
        r.pop('words', None)
        assert r['start'] == seg['start'] and r['allotted_duration'] == dur, \
            f'seg{sid}: locked timing changed — full re-run required'
        wav = os.path.join(WORK, r['wav'])
        polished, sr = sf.read(wav, dtype='float32')
        assert sr == SR_OUT and abs(len(polished) / SR_OUT - r['measured_audio']) < 0.01
        a = int(round(r['audio_offset'] * SR_OUT))
        track[a:a + len(polished)] += polished
        r['words'] = len(seg['narration'].split())
        word_total += r['words']
        rows.append(r)
        print(f'seg{sid:02d} reused   audio {r["measured_audio"]:6.3f}  (byte-identical wav)')
        continue
    hook = seg['kind'] == 'hook'
    lead, tail = (0.10, 0.05) if hook else (LEAD_IN, MIN_TAIL)
    pause_scale = 0.55 if hook else 1.0   # urgent hook delivery, natural elsewhere
    budget = dur - lead - tail
    speed, measured, y, marks = base_speed, None, None, None
    for attempt in range(5):
        tts.SPEED = speed
        y, marks = tts.synth(seg['narration'], pause_scale=pause_scale)
        measured = len(y) / tts.SR
        if measured <= budget:
            break
        speed = round(speed * (measured / budget) * 1.01 + 0.005, 3)
        print(f'  seg{sid}: {measured:.2f}s overruns budget {budget:.2f}s -> retry at speed {speed}')
    assert speed <= 1.08, f'seg{sid} needs speed {speed} > 1.08 — rebalance the slot or trim words'
    headroom = dur - lead - measured
    assert headroom >= tail - 1e-6, f'seg{sid} still overruns at speed {speed}'

    wav = os.path.join(WORK, 'audio', f'seg{sid:02d}.wav')
    raw = wav + '.raw.wav'
    tts.write(raw, y)
    tts.polish(raw, wav, sr=SR_OUT)
    os.remove(raw)
    polished, sr = sf.read(wav, dtype='float32')
    assert sr == SR_OUT
    measured_out = len(polished) / SR_OUT
    assert abs(measured_out - measured) < 0.01, (measured, measured_out)

    a = int(round((seg['start'] + lead) * SR_OUT))
    track[a:a + len(polished)] += polished

    nwords = len(seg['narration'].split())
    word_total += nwords
    rows.append({
        'id': sid, 'kind': seg['kind'], 'chapter': seg.get('chapter'),
        'start': seg['start'], 'allotted_duration': dur,
        'lead_in': lead, 'min_tail': tail, 'pause_scale': pause_scale,
        'audio_offset': round(seg['start'] + lead, 4),
        'measured_audio': round(measured_out, 4),
        'speed': speed,
        'headroom': round(headroom, 4),
        'clip_duration': dur,
        'words': nwords,
        'wav': os.path.relpath(wav, WORK),
        'sentence_marks': [{'start': round(seg['start'] + lead + a2, 4),
                            'end': round(seg['start'] + lead + b2, 4),
                            'text': s2} for a2, b2, s2 in marks],
    })
    print(f'seg{sid:02d} {seg["kind"]:8s} allotted {dur:5.2f}  audio {measured_out:6.3f}  '
          f'speed {speed:.3f}  headroom {headroom:5.3f}  words {nwords}')

sf.write(os.path.join(WORK, 'narration.wav'), track, SR_OUT, subtype='PCM_16')
json.dump({'lead_in': LEAD_IN, 'min_tail': MIN_TAIL, 'total': total,
           'sample_rate': SR_OUT, 'word_count': word_total, 'segments': rows},
          open(os.path.join(WORK, 'timing.json'), 'w'), indent=2)

speech = sum(r['measured_audio'] for r in rows)
print(f'\n{len(rows)}/{len(segs)} segments synthesised. speech {speech:.2f}s of {total:.1f}s '
      f'timeline, {word_total} words ({word_total / speech:.2f} w/s in speech, '
      f'{word_total / total:.2f} w/s overall)')
print(f'narration -> {os.path.join(WORK, "narration.wav")}')