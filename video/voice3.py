#!/usr/bin/env python3
"""3-minute demo, step A: narration for all 14 segments + timing verification.

Usage: video/.venv/bin/python video/voice3.py [work-dir]      (default video/work3)

Synthesises every segment's `narration` with the shared Kokoro TTS (video/tts.py),
measures the REAL duration of each render, and verifies it fits its slot:

    audio starts at  seg.start + LEAD_IN (0.25 s, matching the caption lead-in)
    audio must end by seg.start + seg.duration - MIN_TAIL (0.20 s)

If a segment overruns, the speed is raised just enough (re-synthesised, never a
word cut) and the exact value is recorded. Deterministic: tts.synth seeds its
pacing jitter from the md5 of the text, so re-runs are sample-identical.

Writes:
    <work>/audio/segNN.wav   polished 48 kHz mono voice per segment
    <work>/narration.wav     all segments placed on the absolute 180.0 s timeline
    <work>/timing.json       per-segment allotted / measured / speed / headroom /
                             clip duration + absolute sentence marks (for captions)
"""
import json, os, sys
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tts  # noqa: E402

WORK = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(HERE, 'work3')
SCRIPT = os.path.join(HERE, 'script', 'demo-script.json')
LEAD_IN = 0.25     # first caption cue starts 0.25 s into every segment (script spec)
MIN_TAIL = 0.20    # audio must finish at least this far before the segment end
SR_OUT = 48000

script = json.load(open(SCRIPT))
segs = script['segments']
total = script['total_seconds']
assert abs(sum(s['duration'] for s in segs) - total) < 1e-9, 'segment durations must sum to total'
os.makedirs(os.path.join(WORK, 'audio'), exist_ok=True)

rows = []
track = np.zeros(int(round(total * SR_OUT)), dtype=np.float32)

for seg in segs:
    sid, dur = seg['id'], seg['duration']
    budget = dur - LEAD_IN - MIN_TAIL          # max audio length that fits the slot
    speed, measured, y, marks = 1.0, None, None, None
    for attempt in range(4):
        tts.SPEED = speed
        y, marks = tts.synth(seg['narration'])
        measured = len(y) / tts.SR
        if measured <= budget:
            break
        # raise the speed just enough (plus 1 % margin), never cut words
        speed = round(speed * (measured / budget) * 1.01 + 0.005, 3)
        print(f'  seg{sid}: {measured:.2f}s overruns budget {budget:.2f}s -> retry at speed {speed}')
    headroom = dur - LEAD_IN - measured
    assert headroom >= MIN_TAIL - 1e-6, f'seg{sid} still overruns at speed {speed}'

    wav = os.path.join(WORK, 'audio', f'seg{sid:02d}.wav')
    raw = wav + '.raw.wav'
    tts.write(raw, y)
    tts.polish(raw, wav, sr=SR_OUT)
    os.remove(raw)
    polished, sr = sf.read(wav, dtype='float32')
    assert sr == SR_OUT
    measured_out = len(polished) / SR_OUT      # polish preserves duration; verify anyway
    assert abs(measured_out - measured) < 0.01, (measured, measured_out)

    # place on the absolute timeline
    a = int(round((seg['start'] + LEAD_IN) * SR_OUT))
    track[a:a + len(polished)] += polished

    rows.append({
        'id': sid, 'kind': seg['kind'], 'start': seg['start'],
        'allotted_duration': dur,
        'audio_offset': seg['start'] + LEAD_IN,
        'measured_audio': round(measured_out, 4),
        'speed': speed,
        'headroom': round(headroom, 4),
        'clip_duration': dur,                  # every clip is exactly its slot
        'wav': os.path.relpath(wav, WORK),
        'sentence_marks': [{'start': round(seg['start'] + LEAD_IN + a2, 4),
                            'end': round(seg['start'] + LEAD_IN + b2, 4),
                            'text': s2} for a2, b2, s2 in marks],
    })
    print(f'seg{sid:02d} {seg["kind"]:8s} allotted {dur:5.2f}  audio {measured_out:6.3f}  '
          f'speed {speed:.3f}  headroom {headroom:5.3f}')

sf.write(os.path.join(WORK, 'narration.wav'), track, SR_OUT, subtype='PCM_16')
json.dump({'lead_in': LEAD_IN, 'min_tail': MIN_TAIL, 'total': total,
           'sample_rate': SR_OUT, 'segments': rows},
          open(os.path.join(WORK, 'timing.json'), 'w'), indent=2)

speech = sum(r['measured_audio'] for r in rows)
print(f'\n14/14 segments synthesised. speech {speech:.2f}s of {total:.1f}s timeline '
      f'-> {os.path.join(WORK, "narration.wav")}')
