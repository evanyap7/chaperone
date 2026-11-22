#!/usr/bin/env python3
"""Directed narration for BOTH Chaperone videos — Kokoro af_sarah with the
voice-actor direction in video/work_qwen/voice/{demo,briefing}-direction.json.

Usage:
  video/.venv/bin/python video/voice_direct.py demo      -> video/work_voice/
  video/.venv/bin/python video/voice_direct.py briefing  -> video/work_qwen/briefing/

Fixes the red-team defects (video/work_qwen/voice/redteam.md) with the proven
directed bake-off techniques (bakeoff/directed/NOTES.md):
  * per-LINE synthesis with per-line speed + register (asetrate+atempo, st);
  * verdicts ("Blocked."/"Stopped."/"Held.") as their OWN call: speed 0.85,
    +3.5 dB over context RMS, forced falling terminal contour (drop 0.12);
  * dramatic beats before verdicts, varied pauses (±6 % deterministic jitter);
  * subtle synthesized breaths inside beats >= 0.42 s (never over speech);
  * forced falls on key declarative tails; key figures lifted +1.2…2 dB;
  * continuous low-level room tone + gentle presence/warmth EQ in the polish;
  * SAY_AS pronunciation map on every call (Mei->May, QwenWork->Kwen Work).

Demo: keeps the EXACT 174.0 s timeline and every segment boundary (all visual
beats stay synced). Each segment is fitted into its slot: pauses tighten first,
then the global line-speed multiplier rises (cap per segment, never a word cut).
Briefing: audio is the master clock; pads capped at 0.9 s (no dead air), total
<= 60 s. Outputs are voice3/briefing_voice-compatible: audio/segNN.wav (48 kHz
polished), narration.wav (full timeline), timing.json (sentence marks; the
caption aligner adds word times later).

Local only, stock af_sarah, no cloning, no paid credits. Nothing committed.
"""
import hashlib
import json
import os
import random
import re
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import tts  # noqa: E402  (engine, SAY_AS, trim)

VOICE_DIR = os.path.join(HERE, 'work_qwen', 'voice')
SR = tts.SR            # 24000 synthesis rate
SR_OUT = 48000
ROOM_DB = -62.0        # continuous soft-air bed under the whole narration
BREATH_DB = -22.0      # round 3: audible inhale (~-20 dBFS window mean, was -29.5)

# gentle EQ on top of the existing studio polish: warmth + presence.
# CosyVoice round 2: presence lowered 1.2 -> 0.5 to remove the metallic high-frequency
# sheen the listener flagged (warmth at 240 Hz kept). Kokoro cuts are not re-rendered.
POLISH_DIRECT = (tts.POLISH +
                 ',equalizer=f=240:t=q:w=1.1:g=0.8,'
                 'equalizer=f=3000:t=q:w=1.3:g=0.5')


def polish(src, dst):
    r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', src, '-af', POLISH_DIRECT,
                        '-ar', str(SR_OUT), '-ac', '1', dst], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr[-1500:])


def pitch_shift(y, st):
    """Register shift without tempo change (ffmpeg asetrate + atempo)."""
    if abs(st) < 0.05 or not len(y):
        return y
    f = 2 ** (st / 12.0)
    with tempfile.TemporaryDirectory() as td:
        a, b = os.path.join(td, 'a.wav'), os.path.join(td, 'b.wav')
        sf.write(a, y, SR, subtype='PCM_16')
        r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', a, '-af',
                            f'asetrate={SR * f:.3f},atempo={1 / f:.6f},aresample={SR}',
                            b], capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(r.stderr[-800:])
        z, _ = sf.read(b, dtype='float32')
    return z


def fall_tail(y, drop=0.12, dur=0.35, release=0.09, lp=None):
    """Forced falling terminal contour: tape-style slowdown over the last `dur`
    seconds of the final ACTIVE region (the voiced vowel, not the unvoiced
    release), playback rate 1.0 -> 1-drop (0.12 ~= -2.2 st at the very end).
    The release is a cosine taper (breath-supported decay); `release` sets its
    length (round 3: up to ~0.22 s on the briefing sign-off / punchline so the
    vowel settles instead of flicking). Optional `lp` (Hz) gently low-passes the
    warped tail to de-ess / smooth creak-brightness before the release."""
    win = int(0.01 * SR)
    rms = np.sqrt(np.array([np.mean(y[i:i + win] ** 2)
                            for i in range(0, max(1, len(y) - win), win)]))
    active = rms > rms.max() * 0.15
    mi = int(np.argmax(rms))
    lo = mi
    while lo > 0 and active[lo - 1]:
        lo -= 1
    hi = mi
    while hi < len(active) - 1 and active[hi + 1]:
        hi += 1
    end = min(len(y), (hi + 1) * win + int(0.03 * SR))
    n = min(int(dur * SR), end - 1)
    if n < int(0.08 * SR):
        return y
    start = end - n
    tail = y[start:end]
    N = len(tail)
    M = int(N / (1 - drop / 2))
    j = np.arange(M + 1)
    pos = j - drop * j * j / (2.0 * M)
    new = np.interp(pos, np.arange(N), tail).astype(np.float32)
    if lp:
        X = np.fft.rfft(new)
        fr = np.fft.rfftfreq(len(new), 1 / SR)
        gain = np.ones(len(fr))
        hi_f = fr > lp
        gain[hi_f] = np.clip(1 - (fr[hi_f] - lp) / (lp * 0.6), 0, 1)
        new = np.fft.irfft(X * gain, len(new)).astype(np.float32)
    f = min(int(release * SR), max(1, len(new) // 2))
    new[-f:] *= np.cos(np.linspace(0, np.pi / 2, f)) ** 1.5
    return np.concatenate([y[:start], new, y[end:]])


def breath(dur=0.34, level_db=BREATH_DB, seed=7):
    """Audible natural inhale: soft band-limited noise, gentle attack / long
    release, light turbulence. Round 3 level ~-22 dBFS RMS (window mean ~-20,
    clearly audible under the bed); the old -29.5 was masked on the mux."""
    n = int(dur * SR)
    rng = np.random.default_rng(seed)
    x = rng.standard_normal(n)
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(n, 1 / SR)
    X[(fr < 300) | (fr > 2000)] = 0
    X[(fr >= 300) & (fr <= 2000)] *= np.exp(-(fr[(fr >= 300) & (fr <= 2000)] - 300) / 1200.0)
    x = np.fft.irfft(X, n)
    t = np.linspace(0, 1, n)
    env = np.clip(t / 0.40, 0, 1) ** 0.8 * np.clip((1 - t) / 0.60, 0, 1) ** 1.3
    turb = 1.0 + 0.10 * np.sin(2 * np.pi * (5.5 + seed % 3) * t + seed) \
               + 0.06 * np.sin(2 * np.pi * 13.0 * t + seed * 2)
    x = x * env * turb
    x = x / (np.sqrt(np.mean(x * x)) + 1e-9) * 10 ** (level_db / 20)
    f = int(0.015 * SR)
    x[:f] *= np.linspace(0, 1, f)
    x[-f:] *= np.linspace(1, 0, f)
    return x.astype(np.float32)


def room_tone(n, seed=11):
    """Continuous soft-air bed: low-passed noise at ROOM_DB, no hum, no vacuum."""
    x = np.random.default_rng(seed).standard_normal(n)
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(n, 1 / SR)
    X[fr > 450] *= np.exp(-(fr[fr > 450] - 450) / 220.0)
    X[fr < 60] = 0
    x = np.fft.irfft(X, n)
    x = x / (np.sqrt(np.mean(x * x)) + 1e-9) * 10 ** (ROOM_DB / 20)
    f = int(0.05 * SR)
    x[:f] *= np.linspace(0, 1, f)
    x[-f:] *= np.linspace(1, 0, f)
    return x.astype(np.float32)


def rms_db(y):
    return 20 * np.log10(np.sqrt(np.mean(y * y)) + 1e-9)


def words_of(text):
    return re.findall(r"[a-z0-9']+", text.lower().replace('’', "'"))


def validate_lines(seg, lines):
    want = words_of(seg['narration'])
    got = words_of(' '.join(ln['text'] for ln in lines))
    assert want == got, (f'seg{seg["id"]} direction words != script narration\n'
                         f'  script: {want}\n  lines:  {got}')


def synth_segment(lines, fit_speed=1.0, pause_scale=1.0, seed=0):
    """Render the directed lines. Returns (samples @24k, marks, params)."""
    tts.VOICE = 'af_sarah'
    k, voice = tts._engine(), tts._voice()
    rng = random.Random(seed)
    out, marks, t = [], [], 0.0
    ctx_rms = None
    if lines and lines[0].get('pre_breath'):
        b = breath(dur=0.32, seed=(seed + 17) % 1000)
        out.append(b)
        out.append(np.zeros(int(0.07 * SR), dtype=np.float32))
        t += len(b) / SR + 0.07
    for i, ln in enumerate(lines):
        speed = ln['speed'] if ln.get('verdict') else ln['speed'] * fit_speed
        audio, sr = k.create(tts.say_as(ln['text']), voice=voice, speed=speed, lang='en-us')
        assert sr == SR, sr
        y = tts._trim(np.asarray(audio, dtype=np.float32))
        y = pitch_shift(y, ln.get('st', 0.0))
        if ln.get('fall'):
            y = fall_tail(y, drop=ln['fall'], dur=ln.get('fall_dur', 0.35),
                          release=ln.get('release', 0.09), lp=ln.get('tail_lp'))
        pk = float(np.max(np.abs(y))) if len(y) else 0.0
        if pk > 0.89:
            y = y * (0.89 / pk)
        out.append(y)
        marks.append((t, t + len(y) / SR, ln['text']))
        t += len(y) / SR
        if not ln.get('boost'):
            ctx_rms = rms_db(y)        # context = the un-punched delivery level
        if i < len(lines) - 1:
            pause = ln.get('pause', 0.30) * pause_scale * rng.uniform(0.88, 1.14)
            if lines[i + 1].get('breath') and pause >= 0.40:
                b = breath(dur=0.30 + 0.02 * ((seed + i) % 4),
                           seed=(seed + i * 31) % 1000)
                pad = 0.08
                silence = max(0.04, pause - len(b) / SR - pad)
                out.append(np.zeros(int(silence * SR), dtype=np.float32))
                out.append(b)
                out.append(np.zeros(int(pad * SR), dtype=np.float32))
                t += silence + len(b) / SR + pad
            else:
                out.append(np.zeros(int(pause * SR), dtype=np.float32))
                t += pause
    y = np.concatenate(out) if out else np.zeros(0, np.float32)
    return y, marks


def fit_segment(lines, budget, seed, max_speed=1.08, min_pause_scale=0.6):
    """Fit the directed delivery into the slot: raise the global speed multiplier
    first (keep the dramatic beats), then tighten pauses. Never cuts a word."""
    ps, fs = 1.0, 1.0
    y, marks = synth_segment(lines, fs, ps, seed)
    dur = len(y) / SR
    for _ in range(8):
        if dur <= budget + 0.002:
            return y, marks, fs, ps
        speech = sum(b - a for a, b, _ in marks)
        gaps = max(0.01, dur - speech)
        if fs < max_speed:
            fs = min(max_speed, round(fs * (dur / budget) * 1.01 + 0.005, 3))
        elif ps > min_pause_scale:
            ps = max(min_pause_scale, round(ps * (budget - speech * 1.0) / gaps, 3))
        else:
            raise SystemExit(f'segment needs speed > {max_speed} at pause_scale {ps}: '
                             f'{dur:.2f}s vs budget {budget:.2f}s (speech {speech:.2f}s, '
                             f'gaps {gaps:.2f}s) — rebalance the direction')
        y, marks = synth_segment(lines, fs, ps, seed)
        dur = len(y) / SR
    raise SystemExit(f'fit loop exhausted: {dur:.2f}s vs {budget:.2f}s')


def _compress_region(reg):
    """Gentle compression for percussive verdict onsets (bake-off technique):
    lowers the crest factor so the +3.5 dB RMS punch fits under the peak cap."""
    with tempfile.TemporaryDirectory() as td:
        a, b = os.path.join(td, 'a.wav'), os.path.join(td, 'b.wav')
        sf.write(a, reg, SR_OUT, subtype='PCM_16')
        r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', a, '-af',
                            'acompressor=threshold=-22dB:ratio=4:attack=5:release=80',
                            b], capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(r.stderr[-800:])
        z, _ = sf.read(b, dtype='float32')
    return z[:len(reg)] if len(z) >= len(reg) else np.pad(z, (0, len(reg) - len(z)))


def punch_polished(polished, marks, lines):
    """Verdict/figure punch AFTER the polish compressor (which otherwise eats
    2-3 dB of the boost): gain each boosted line to context-RMS + boost dB on
    the polished 48 kHz audio, 8 ms edge ramps, 0.95 peak cap. Polish preserves
    duration, so the 24 kHz mark times map 1:1."""
    ctx = None
    for (a, b, _), ln in zip(marks, lines):
        i, j = int(a * SR_OUT), int(b * SR_OUT)
        reg = polished[i:j]
        if not len(reg):
            continue
        if ln.get('boost'):
            target = (ctx if ctx is not None else rms_db(reg)) + ln['boost']
            g = 10 ** ((target - rms_db(reg)) / 20)
            if float(np.max(np.abs(reg))) * g > 0.95:
                reg = _compress_region(reg)
                g = 10 ** ((target - rms_db(reg)) / 20)
            f = int(0.008 * SR_OUT)
            env = np.ones(len(reg), dtype=np.float32)
            if len(reg) > 2 * f:
                env[:f] = np.linspace(1, g, f)
                env[-f:] = np.linspace(g, 1, f)
                env[f:-f] = g
            else:
                env[:] = g
            reg = reg * env
            pk = float(np.max(np.abs(reg)))
            if pk > 0.95:
                reg = reg * (0.95 / pk)
            polished[i:j] = reg
        else:
            ctx = rms_db(reg)
    return polished


def place_segment(work, sid, y, marks, start, lead, dur, extra, lines=None):
    """Polish to 48 kHz, apply the directed punch, write audio/segNN.wav."""
    wav = os.path.join(work, 'audio', f'seg{sid:02d}.wav')
    raw = wav + '.raw.wav'
    tts.write(raw, y)
    polish(raw, wav)
    os.remove(raw)
    polished, sr = sf.read(wav, dtype='float32')
    assert sr == SR_OUT
    if lines:
        polished = punch_polished(polished, marks, lines)
        sf.write(wav, polished, SR_OUT, subtype='PCM_16')
    measured = len(polished) / SR_OUT
    row = dict(extra)
    row.update({
        'id': sid, 'start': start, 'allotted_duration': dur,
        'lead_in': lead, 'audio_offset': round(start + lead, 4),
        'measured_audio': round(measured, 4),
        'headroom': round(dur - lead - measured, 4),
        'wav': os.path.relpath(wav, work),
        'sentence_marks': [{'start': round(start + lead + a, 4),
                            'end': round(start + lead + b, 4), 'text': s}
                           for a, b, s in marks],
    })
    return row, polished


def run_demo(only_ids=()):
    script = json.load(open(os.path.join(HERE, 'script', 'demo-script.json')))
    direction = json.load(open(os.path.join(VOICE_DIR, 'demo-direction.json')))
    dseg = {d['id']: d for d in direction['segments']}
    work = os.path.join(HERE, 'work_voice')
    os.makedirs(os.path.join(work, 'audio'), exist_ok=True)
    old = None
    if only_ids:
        old = {r['id']: r for r in json.load(open(os.path.join(work, 'timing.json')))['segments']}
    total = script['total_seconds']
    assert 170.0 <= total <= 178.0
    track = np.zeros(int(round(total * SR_OUT)), dtype=np.float32)
    rows, word_total = [], 0
    for seg in script['segments']:
        sid, dur = seg['id'], seg['duration']
        d = dseg[sid]
        validate_lines(seg, d['lines'])
        hook = seg['kind'] == 'hook'
        lead, tail = (0.10, 0.05) if hook else (0.25, 0.20)
        budget = dur - lead - tail
        nwords = len(seg['narration'].split())
        word_total += nwords
        if only_ids and sid not in only_ids:
            r = dict(old[sid])
            r.pop('words', None)
            assert r['start'] == seg['start'] and r['allotted_duration'] == dur
            polished, sr = sf.read(os.path.join(work, r['wav']), dtype='float32')
            assert sr == SR_OUT
            a = int(round(r['audio_offset'] * SR_OUT))
            track[a:a + len(polished)] += polished
            r['words'] = nwords
            rows.append(r)
            print(f'seg{sid:02d} reused   audio {r["measured_audio"]:6.3f}')
            continue
        seed = int(hashlib.md5(seg['narration'].encode()).hexdigest()[:8], 16)
        y, marks, fs, ps = fit_segment(d['lines'], budget, seed,
                                       d.get('max_speed', 1.08), d.get('min_pause_scale', 0.6))
        row, polished = place_segment(work, sid, y, marks, seg['start'], lead, dur, {
            'kind': seg['kind'], 'chapter': seg.get('chapter'),
            'min_tail': tail, 'pause_scale': ps, 'speed': fs,
            'clip_duration': dur, 'words': nwords,
            'energy': d.get('energy'), 'direction': d['lines'],
        }, lines=d['lines'])
        a = int(round(row['audio_offset'] * SR_OUT))
        track[a:a + len(polished)] += polished
        rows.append(row)
        print(f'seg{sid:02d} {seg["kind"]:8s} allotted {dur:5.2f}  audio {row["measured_audio"]:6.3f}  '
              f'fit_speed {fs:.3f}  pause_scale {ps:.2f}  headroom {row["headroom"]:5.3f}  '
              f'{d.get("energy", "")}')
    track += room_tone(len(track))
    sf.write(os.path.join(work, 'narration.wav'), track, SR_OUT, subtype='PCM_16')
    json.dump({'lead_in': 0.25, 'min_tail': 0.20, 'total': total, 'sample_rate': SR_OUT,
               'voice': 'af_sarah', 'engine': 'kokoro (directed)',
               'direction': 'video/work_qwen/voice/demo-direction.json',
               'word_count': word_total, 'segments': rows},
              open(os.path.join(work, 'timing.json'), 'w'), indent=2)
    speech = sum(r['measured_audio'] for r in rows)
    print(f'\ndemo: {len(rows)} segments, speech {speech:.2f}s of {total:.1f}s, '
          f'{word_total} words -> {work}/narration.wav + timing.json')


def run_briefing():
    bdir = os.path.join(HERE, 'work_qwen', 'briefing')
    script = json.load(open(os.path.join(bdir, 'briefing-script.json')))
    direction = json.load(open(os.path.join(VOICE_DIR, 'briefing-direction.json')))
    dseg = {d['id']: d for d in direction['segments']}
    os.makedirs(os.path.join(bdir, 'audio'), exist_ok=True)
    segs = script['segments']
    res = []
    for seg in segs:
        d = dseg[seg['id']]
        validate_lines(seg, d['lines'])
        seed = int(hashlib.md5(seg['narration'].encode()).hexdigest()[:8], 16)
        y, marks = synth_segment(d['lines'], 1.0, 1.0, seed)
        res.append((y, marks, len(y) / SR))
    speech = sum(r[2] for r in res)
    leads = [0.15 if s['kind'] == 'title' else 0.25 for s in segs]
    tails = [0.65 if s['kind'] == 'endcard' else 0.30 for s in segs]
    fixed = sum(leads) + sum(tails)
    speed = 1.0
    if speech + fixed + 0.3 * len(segs) > 60.0:
        speed = round(speech / (60.0 - fixed - 0.3 * len(segs)) * 1.005 + 0.005, 3)
        assert speed <= 1.08, f'briefing speech too long: needs speed {speed}'
        print(f'briefing speech {speech:.2f}s overruns -> re-synth at speed {speed}')
        res = []
        for seg in segs:
            d = dseg[seg['id']]
            seed = int(hashlib.md5(seg['narration'].encode()).hexdigest()[:8], 16)
            y, marks = synth_segment(d['lines'], speed, 1.0, seed)
            res.append((y, marks, len(y) / SR))
        speech = sum(r[2] for r in res)
    # breathing pads: proportional to speech, capped 0.9 s (red-team: no dead air)
    pad_budget = max(0.0, 59.0 - speech - fixed)
    wsum = sum(r[2] for r in res)
    pads = [min(0.9, max(0.3, pad_budget * r[2] / wsum)) for r in res]
    total = round(speech + fixed + sum(pads), 3)
    assert total <= 60.0, total
    track = np.zeros(int(round(total * SR_OUT)), dtype=np.float32)
    rows, pos = [], 0.0
    for i, (s, (y, marks, _)) in enumerate(zip(segs, res)):
        lead, tail, pad = leads[i], tails[i], pads[i]
        dur = lead + y_len(y) + tail + pad
        d = dseg[s['id']]
        row, polished = place_segment(bdir, s['id'], y, marks, pos, lead, dur, {
            'key': s['key'], 'kind': s['kind'], 'footage': s.get('footage'),
            'kicker': s.get('kicker'), 'title': s.get('title'), 'stamp': s.get('stamp'),
            'duration': round(dur, 4), 'tail': tail, 'pad': round(pad, 4),
            'speed': speed, 'narration': s['narration'],
            'words': len(s['narration'].split()),
            'energy': d.get('energy'), 'direction': d['lines'],
        }, lines=d['lines'])
        a = int(round(row['audio_offset'] * SR_OUT))
        track[a:a + len(polished)] += polished
        rows.append(row)
        print(f'seg{s["id"]} {s["key"]:9s} start {pos:6.2f} dur {dur:5.2f} '
              f'speech {row["measured_audio"]:5.2f} pad {pad:4.2f}  {d.get("energy", "")}')
        pos += dur
    # round 3: audible natural inhales in the inter-segment gaps (topic shifts),
    # never overlapping speech; each ends ~0.10 s before the next segment's onset.
    for i in range(1, len(rows)):
        cur, prev = rows[i], rows[i - 1]
        prev_end = prev['audio_offset'] + prev['measured_audio']
        gap = cur['audio_offset'] - prev_end
        if gap >= 0.55:
            b = breath(dur=0.30 + 0.02 * (i % 4), seed=(i * 137 + 5) % 1000)
            n48 = int(round(len(b) * SR_OUT / SR))
            b48 = np.interp(np.linspace(0, len(b) - 1, n48),
                            np.arange(len(b)), b).astype(np.float32)
            start = cur['audio_offset'] - 0.10 - len(b48) / SR_OUT
            if start >= prev_end + 0.06:
                a = int(round(start * SR_OUT))
                track[a:a + len(b48)] += b48
    track += room_tone(len(track))
    sf.write(os.path.join(bdir, 'narration.wav'), track, SR_OUT, subtype='PCM_16')
    json.dump({'total': total, 'sample_rate': SR_OUT, 'voice': 'af_sarah',
               'engine': 'kokoro (directed)',
               'direction': 'video/work_qwen/voice/briefing-direction.json',
               'speed': speed, 'word_count': sum(r['words'] for r in rows),
               'segments': rows},
              open(os.path.join(bdir, 'timing.json'), 'w'), indent=2)
    print(f'\nbriefing: total {pos:.3f}s (<=60), speech {speech:.2f}s, '
          f'{sum(r["words"] for r in rows)} words -> {bdir}/narration.wav + timing.json')


def y_len(y):
    return len(y) / SR


if __name__ == '__main__':
    args = sys.argv[1:]
    only = set()
    if '--only' in args:
        i = args.index('--only')
        only = {int(x) for x in args[i + 1].split(',')}
        del args[i:i + 2]
    mode = args[0] if args else 'demo'
    if mode == 'demo':
        run_demo(only)
    elif mode == 'briefing':
        run_briefing()
    else:
        raise SystemExit('usage: voice_direct.py demo|briefing [--only 5,6]')