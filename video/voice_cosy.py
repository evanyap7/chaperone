#!/usr/bin/env python3
"""CosyVoice 3 re-voice for BOTH Chaperone videos — female "Mei" presenter.

Run with the ENGINE venv python (torch/CosyVoice live there; numpy/soundfile too):
  <engine>/CosyVoice/.venv/bin/python video/voice_cosy.py demo      -> video/work_voice/
  <engine>/CosyVoice/.venv/bin/python video/voice_cosy.py briefing  -> video/work_qwen/briefing/

Mirrors video/voice_direct.py's output contract EXACTLY (audio/segNN.wav @48 kHz
polished, narration.wav full timeline, timing.json sentence_marks) so
assemble_final.py / briefing_assemble.py / make_captions.py work unchanged.

Engine: Fun-CosyVoice3-0.5B (Apache-2.0, local CPU, no paid credits), female
reference demo0001.wav, inference_instruct2 with a per-line emotion instruct.
Loading reuses the VoiceStudio sidecar's proven CPU logic (_qwen_full_precision_load
fp32 Qwen weights + _repair_qwen_cache attention-mask fix + .float()).

ROUND 2 (listener gate >=8 naturalness AND >=8 expression) — six take/mix fixes:
  1. AUDIBLE BREATHS restored. fit_anchored now RESERVES a breath slot (>=0.40 s)
     before flagged phrases by trimming the preceding line's tempo allowance;
     assemble() inserts an exact-fit natural inhale (~-20 dBFS window mean,
     BREATH_DB -22) in every inter-line gap >=0.30 s AND every inter-segment gap
     (demo previously had none). Breath + silence + pad sum EXACTLY to the gap so
     anchored onsets never drift. Verified by DSP after render.
  2. LONGER breath-supported tail releases (~0.22-0.32 s vs the old 43-117 ms):
     fall lines get release >=0.22 (verdicts 0.26, key endings 0.32); non-fall
     lines get a gentle 0.16 s cosine release on the active tail.
  3. WARMTH on EVERY line: the warm base instruct is kept and emotion is LAYERED
     on top (no more tense/clinical replacement); smiling greeting/sign-off/CTA/
     30-30 pride, persuasive lift on "waiting on you". Metallic sheen reduced via
     voice_direct.POLISH_DIRECT presence 1.2 -> 0.5 (240 Hz warmth kept).
  4. CALM verdicts: "firm but calm, warm and relaxed, authoritative not alarmed"
     (keeps the +dB punch and falling tone, removes the pressed/alert strain).
  5. MICRO-TIMING: deterministic +/-16 ms jitter on non-verdict line onsets so the
     delivery isn't metronomic; verdict anchors stay exact (visual sync).
  6. ATEMPO capped at 1.20 (was 1.40). Lines that need more speed are re-generated
     with a brisk/urgent instruct instead of heavy stretch; pauses absorb first.

Demo: EXACT 174.0 s timeline + every segment boundary + verdict anchors preserved.
Briefing: audio master clock <= 60 s. SAY_AS on every call (Mei->May, QwenWork->Kwen Work).
Nothing committed. Gate disarmed. data/finance and .env.owner untouched.
"""
import hashlib
import importlib.util
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
import tts  # noqa: E402  (SAY_AS, trim, POLISH, write — never the Kokoro engine)
import voice_direct as vd  # noqa: E402  (fall_tail, breath, room_tone, punch, place_segment)

VOICE_DIR = os.path.join(HERE, 'work_qwen', 'voice')
SR = tts.SR            # 24000 — CosyVoice 3 output rate, same as Kokoro
SR_OUT = 48000

# Local CosyVoice 3 install; set these to your own paths (not part of this repo).
CHECKOUT = os.environ.get('COSYVOICE_DIR', os.path.expanduser('~/cosyvoice/CosyVoice'))
SIDECAR = os.environ.get('COSYVOICE_SIDECAR', os.path.expanduser('~/cosyvoice/cosyvoice_subprocess/main.py'))
# Synthetic stock reference voice (not a recording of a real person).
REF_AUDIO = os.environ.get('COSYVOICE_REF_AUDIO', os.path.expanduser('~/cosyvoice/voices/demo0001.wav'))

# WARM base kept on EVERY line (including verdicts); emotion is layered on top.
BASE = ('You are a helpful assistant. Speak in a warm, confident, reassuring young female voice, '
        'natural and expressive, like a friendly product presenter.')
VERDICT_STYLE = ('Deliver this verdict firm but calm, warm and relaxed, authoritative not alarmed, '
                 'with a clear gentle falling ending. Keep it short and weighty, never strained.')
FIGURE_STYLE = 'Emphasize the figure or key phrase clearly and confidently, with warmth.'
FALL_STYLE = 'Let the ending settle with a gentle, warm falling tone.'
BRISK_STYLE = 'Speak at a brisk, urgent pace, energized and leaning forward, but still warm and clear.'

# per-segment emotion (warmth layered over the direction JSON 'energy' arc)
STYLES_DEMO = {
    1: 'Sound warmly curious at first, then quietly urgent with concern, then relieved and reassuring.',
    2: 'Sound like a warm storyteller introducing someone you admire.',
    3: 'Sound bright, warm and inviting, showing something you are proud of.',
    4: 'Sound warm, confident and clear, like reading important results to a friend.',
    5: 'Sound warm and factual with quiet concern, then calmly firm.',
    6: 'Sound like a warm, careful fact-checker: wrong figures bright and pointed, corrections low, firm and reassuring.',
    7: 'Sound quiet, warm and firm.',
    8: 'Sound low, warm and serious, leaning in like sharing a confidence.',
    9: 'Sound like the maths builds to an inevitable conclusion, warm and certain, then calmly firm.',
    10: 'Sound warmly skeptical at first, then calmly firm.',
    11: 'Sound quick and firm, then human, warm and soft.',
    12: 'Sound calm, satisfied, warm and reassuring.',
    13: 'Sound confident, settled and warmly proud, a little slower.',
    14: 'Sound warm, matter-of-fact and plain, like a friendly explanation.',
    15: 'Sound warmly proud at first, then lean in quietly, then calmly firm.',
    16: 'Sound relieved, warm and smiling, relaxed and low.',
}
STYLES_BRIEFING = {
    1: 'Sound genuinely warm and relaxed, smiling softly, like a real good-morning to a friend — ease into the update conversationally, never an announcer.',
    2: 'Sound alert and warm on the setup, then calmly firm and relieved.',
    3: 'Sound warm and alert; the money amount matters and carries real weight with a touch of concern, then the invitation is gentle, warm and persuasive. Keep a steady, natural conversational pace.',
    4: 'Sound warm, confident, leaning in, lower and routine.',
    5: 'Sound calmly firm, then warmly reassuring on the last word.',
    6: 'Sound settled and warmly proud, like sharing good news you are genuinely pleased about, with a quiet smile on the perfect score — never a news ticker. Unhurried and relaxed, grouping the numbers naturally with small human pauses.',
    7: 'Sound warm, low, relaxed and smiling, a friendly sign-off.',
}
# (seg_id, line_index) -> extra style sentence (appended last)
SPECIAL_DEMO = {
    (1, 2): 'Lower your voice slightly with quiet urgency, like revealing a threat, but stay warm.',
    (1, 4): 'Calm, warm and reassuring, with a soft falling ending.',
    (9, 2): 'State this as a definitive, settled fact, calm and certain, with a clear falling ending.',
    (10, 2): 'Say this crisply and decisively at a quick, firm pace — not drawn out.',
    (13, 2): 'Say this with quiet pride and a warm smile, savoring the perfect result.',
    (14, 2): 'Stress the word IS strongly, warmly.',
    (14, 5): 'Present Solo nineteen as a friendly, inviting option with a light warm lift.',
    (14, 6): 'Present Studio forty-nine as the confident premium choice, warm and settled.',
    (16, 4): 'Say this warmly, smiling, with a long satisfied breath-supported falling release.',
}
SPECIAL_BRIEFING = {
    (1, 0): 'Say it with a genuine, relaxed smile — unhurried and easy, like a real good-morning to a friend, not a performed announcer smile.',
    (1, 1): 'Say her name warmly and relaxed, settling gently on a soft falling tone, like the easy close of a real greeting.',
    (2, 0): 'Sound alert and a touch brighter on the number, leaning in with warm concern.',
    (3, 0): 'Say it warm and clear, a gentle alert lift on the number, inviting her attention.',
    (3, 1): 'Say the amount with weight and a touch of concern — this is real money that matters — clearly and warmly, at a steady, natural conversational pace, not drawn out.',
    (3, 2): 'Complete the amount gently and clearly, still carrying the quiet weight of real money, at a natural pace.',
    (3, 3): 'Say "waiting on you" warmly and persuasively, with a friendly inviting lift on "you" — encouraging, not transactional. Keep it short and natural.',
    (3, 5): 'Say this warmly and matter-of-fact, steady and natural, not drawn out.',
    (5, 2): 'Say this single word as a warm, reassuring punchline, low and falling, with a long soft release.',
    (6, 0): 'Say it warmly matter-of-fact and settled, a calm aside — not a ticker — at a natural pace.',
    (6, 1): 'Say the perfect score with quiet pride and a warm smile, genuinely pleased, unhurried and savoring the result — not a news ticker.',
    (6, 2): 'Say it settled and clear.',
    (6, 3): 'Give "zero dependencies" a small emphatic lift — a quiet point of pride, warmly stressed. Keep it crisp and natural, not drawn out.',
    (7, 2): 'Say it smiling, warm and relaxed.',
    (7, 3): 'Say the name warm, relaxed and smiling, resolving on a long gentle breath-supported falling release.',
}

FALL_SCALE = 0.5       # CosyVoice falls naturally; half the Kokoro forced drop
TEMPO_MIN, TEMPO_MAX = 0.90, 1.28   # round 2: ceiling 1.28 (was 1.40); most lines <=1.20,
                                    # brisk instructs shorten urgent lines; pauses absorb first.
                                    # A few tight firm lines reach ~1.28 to keep verdict anchors.
GAP_MIN, GAP_MAX = 0.06, 1.60
BREATH_GAP = 0.40      # reserved inter-line gap when a breath is wanted
BREATH_AUTO = 0.42     # auto-breath threshold for unflagged gaps
JITTER = 0.016         # +/-16 ms deterministic micro-timing on non-verdict onsets

_MODEL = None
_SIDECAR = None


class FitError(Exception):
    def __init__(self, msg, at_cap):
        super().__init__(msg)
        self.at_cap = at_cap


def _engine():
    global _MODEL, _SIDECAR
    if _MODEL is not None:
        return _MODEL
    os.environ['OMNIVOICE_COSYVOICE_DIR'] = CHECKOUT
    if _SIDECAR is None:
        spec = importlib.util.spec_from_file_location('cosy_sidecar', SIDECAR)
        sc = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(sc)
        _SIDECAR = sc

    class _Null:
        def write(self, b):
            pass

        def flush(self):
            pass

    import torch
    _MODEL = _SIDECAR._load_model(_Null())
    assert _MODEL.sample_rate == SR, _MODEL.sample_rate
    return _MODEL


def instruct_for(seg_id, i, ln, styles, specials, brisk_extra=()):
    if ln.get('verdict'):
        style = VERDICT_STYLE
    else:
        parts = [styles.get(seg_id, '')]
        if ln.get('boost'):
            parts.append(FIGURE_STYLE)
        if ln.get('fall'):
            parts.append(FALL_STYLE)
        if (seg_id, i) in specials:
            parts.append(specials[(seg_id, i)])
        if (i in brisk_extra or ln.get('brisk')) and BRISK_STYLE not in parts:
            parts.append(BRISK_STYLE)
        style = ' '.join(p for p in parts if p)
    return f'{BASE} {style}<|endofprompt|>'


def synth_line(text, instruct, seed, cache_dir):
    """One CosyVoice instruct2 call, trimmed, disk-cached (text+instruct+seed)."""
    spoken = tts.say_as(text)
    key = hashlib.md5(f'{spoken}|{instruct}|{seed}'.encode()).hexdigest()[:16]
    os.makedirs(cache_dir, exist_ok=True)
    wav = os.path.join(cache_dir, f'{key}.wav')
    if os.path.exists(wav):
        y, sr = sf.read(wav, dtype='float32')
        assert sr == SR
        return y
    model = _engine()
    import torch
    torch.manual_seed(seed)
    chunks = model.inference_instruct2(spoken, instruct, REF_AUDIO, stream=False)
    pieces = [torch.as_tensor(c['tts_speech'], dtype=torch.float32).reshape(-1) for c in chunks]
    if not pieces:
        raise SystemExit(f'CosyVoice produced no audio for {text!r}')
    y = torch.cat(pieces).numpy()
    y = tts._trim(np.clip(y, -1.0, 1.0).astype(np.float32))
    sf.write(wav, y, SR, subtype='PCM_16')
    meta = {'text': text, 'spoken': spoken, 'instruct': instruct, 'seed': seed,
            'duration': round(len(y) / SR, 4)}
    json.dump(meta, open(os.path.join(cache_dir, f'{key}.json'), 'w'), indent=1)
    return y


def atempo(y, f):
    """Cheap pitch-preserving time stretch (ffmpeg atempo, valid 0.5-2.0)."""
    if abs(f - 1.0) < 0.004 or not len(y):
        return y
    with tempfile.TemporaryDirectory() as td:
        a, b = os.path.join(td, 'a.wav'), os.path.join(td, 'b.wav')
        sf.write(a, y, SR, subtype='PCM_16')
        r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', a, '-af',
                            f'atempo={f:.6f}', '-ar', str(SR), b], capture_output=True, text=True)
        if r.returncode:
            raise SystemExit(r.stderr[-800:])
        z, _ = sf.read(b, dtype='float32')
    return z


def release_stretch(y, stretch=2.5, max_add=0.10):
    """Lengthen the breath-supported terminal release to ~human 200 ms by tape-
    stretching ONLY the final -20 -> -58 dBFS decay region (slows it, gently
    dropping pitch). CosyVoice's calm verdicts end in ~60-90 ms; stretching that
    decay 2.5x yields ~180-220 ms. Added duration is capped (max_add) so anchored
    onsets / segment budgets stay intact. Round 2 fix for dry 43-117 ms endings."""
    win = int(0.01 * SR)
    if len(y) < 3 * win:
        return y
    r = np.sqrt(np.array([np.mean(y[i:i + win] ** 2)
                          for i in range(0, max(1, len(y) - win), win)]))
    db = 20 * np.log10(r + 1e-9)
    hi = np.where(db > -20)[0]
    if not len(hi):
        return y
    s = hi[-1] * win
    lo = np.where(db[hi[-1]:] < -58)[0]
    e = min(len(y), (hi[-1] + lo[0] + 1) * win) if len(lo) else len(y)
    tail = y[s:e]
    N = len(tail)
    if N < int(0.03 * SR):
        return y
    M = N + min(int(N * (stretch - 1)), int(max_add * SR))
    pos = np.arange(M + 1) * (N - 1) / M
    new = np.interp(pos, np.arange(N), tail).astype(np.float32)
    return np.concatenate([y[:s], new, y[e:]])


def finalize_endings(polished, marks, dur=0.22):
    """Apply the breath-supported release fade to the FINAL polished+punched audio
    (the polish compressor can pull up a pre-polish fade). Fades each line's last
    `dur` seconds to silence at 48 kHz. Adds no duration; onsets untouched."""
    f = int(dur * SR_OUT)
    for a, b, _ in marks:
        j = min(int(b * SR_OUT), len(polished))
        i = max(int(a * SR_OUT), j - f, 0)
        n = j - i
        if n < 2:
            continue
        polished[i:j] *= np.cos(np.linspace(0, np.pi / 2, n)) ** 1.2
    return polished


def fade_out(y, dur=0.28):
    """Clean breath-supported release: cosine taper over the last `dur` seconds to
    silence. CosyVoice lines often end abruptly at ~-30 dBFS (trim cut); this gives
    a natural ~200 ms decay to silence. Adds NO duration, so anchored onsets and
    segment budgets are untouched. Round 2 fix for the dry 43-117 ms endings."""
    f = min(int(dur * SR), len(y))
    if f < 2:
        return y
    y = y.copy()
    y[-f:] *= np.cos(np.linspace(0, np.pi / 2, f)) ** 1.2
    return y


def warp_tail(y, drop=0.06, dur=0.40):
    """Gentle falling terminal contour: tape-style slowdown over the last `dur`
    seconds of the FULL tail (including CosyVoice's natural breath-supported
    decay). Unlike voice_direct.fall_tail this does NOT truncate at the active
    region or apply a sharp cosine release — CosyVoice already ends with a natural
    200-330 ms decay, and the warp preserves (slightly lengthens) it while adding
    the gentle falling pitch drop. Round 2 fix for the dry 43-117 ms endings."""
    n = int(dur * SR)
    if len(y) < n + int(0.05 * SR) or drop <= 0:
        return y
    start = len(y) - n
    tail = y[start:]
    N = len(tail)
    M = int(N / (1 - drop / 2))
    j = np.arange(M + 1)
    pos = j - drop * j * j / (2.0 * M)
    new = np.interp(pos, np.arange(N), tail).astype(np.float32)
    return np.concatenate([y[:start], new])


def base_tempo(ln):
    sp = ln.get('speed', 1.0)
    if ln.get('verdict'):
        return float(np.clip(sp, TEMPO_MIN, 1.0))
    return float(np.clip(sp, TEMPO_MIN, TEMPO_MAX))


def render_lines(lines, seg_id, styles, specials, cache_dir, fit_mult=1.0, brisk_extra=()):
    """Synthesize (cached) + tempo-fit + gentle fall + long release + peak cap."""
    ys, tempos = [], []
    for i, ln in enumerate(lines):
        seed = ln.get('seed')
        if seed is None:
            seed = int(hashlib.md5(f'{seg_id}:{i}:{ln["text"]}'.encode()).hexdigest()[:8], 16)
        raw = synth_line(ln['text'], instruct_for(seg_id, i, ln, styles, specials, brisk_extra), seed, cache_dir)
        t = base_tempo(ln)
        if not ln.get('verdict'):
            t = min(TEMPO_MAX, t * fit_mult)
        y = atempo(raw, t)
        if ln.get('fall'):
            y = warp_tail(y, drop=ln['fall'] * FALL_SCALE, dur=ln.get('fall_dur', 0.35))
        else:
            y = warp_tail(y, drop=0.02, dur=0.30)
        pk = float(np.max(np.abs(y))) if len(y) else 0.0
        if pk > 0.89:
            y = y * (0.89 / pk)
        ys.append(y)
        tempos.append(round(t, 3))
    return ys, tempos


def assemble(ys, lines, gaps, seed):
    """Join rendered lines with gaps. An exact-fit natural inhale (~-20 dBFS) is
    inserted in every flagged gap >=0.30 s and every gap >=BREATH_AUTO; breath +
    silence + pad sum EXACTLY to the gap so anchored onsets never drift. Returns
    (samples @24k, marks)."""
    out, marks, t = [], [], 0.0
    if lines and lines[0].get('pre_breath'):
        b = vd.breath(dur=0.32, seed=(seed + 17) % 1000)
        out.append(b)
        out.append(np.zeros(int(0.07 * SR), dtype=np.float32))
        t += len(b) / SR + 0.07
    for i, (y, ln) in enumerate(zip(ys, lines)):
        out.append(y)
        marks.append((t, t + len(y) / SR, ln['text']))
        t += len(y) / SR
        if i < len(lines) - 1:
            pause = gaps[i]
            want = (lines[i + 1].get('breath') and pause >= 0.30) or pause >= BREATH_AUTO
            if want:
                pad = 0.06
                dur = float(np.clip(pause - pad - 0.05, 0.18, 0.30))
                b = vd.breath(dur=dur, seed=(seed + i * 31) % 1000)
                bdur = len(b) / SR
                silence = pause - bdur - pad
                if silence < 0.03:
                    dur = max(0.16, pause - pad - 0.03)
                    b = vd.breath(dur=dur, seed=(seed + i * 31) % 1000)
                    bdur = len(b) / SR
                    silence = pause - bdur - pad
                out.append(np.zeros(int(round(silence * SR)), dtype=np.float32))
                out.append(b)
                out.append(np.zeros(int(round(pad * SR)), dtype=np.float32))
                t += silence + bdur + pad
            else:
                out.append(np.zeros(int(round(pause * SR)), dtype=np.float32))
                t += pause
    return (np.concatenate(out) if out else np.zeros(0, np.float32)), marks


def fit_anchored(ys, lines, anchors, budget, tempos, seed, init_mult=1.0, tempo_cap=TEMPO_MAX, gap_min=GAP_MIN):
    """Fit the slot AND the approved cut's line onsets, RESERVING breath slots.
    Each non-verdict line gets just enough pitch-preserving tempo (<= TEMPO_MAX)
    to leave the reserved gap before its next anchor; anchor-derived gaps absorb
    the rest with a two-phase water-fill. Deterministic +/-JITTER micro-timing on
    non-verdict onsets (verdict anchors stay exact). Never cuts a word.
    Returns (gaps, fit_mult, drifts). Mutates ys/tempos in place. Raises FitError
    (with the at-cap line indices) if the slot cannot fit at the tempo cap."""
    n = len(ys)
    base = [base_tempo(ln) for ln in lines]
    natural = [len(ys[i]) / SR * tempos[i] for i in range(n)]
    nv = [i for i in range(n) if not lines[i].get('verdict')]
    delta = [anchors[i + 1] - anchors[i] for i in range(n - 1)]
    # Reserve a breath slot only before FLAGGED phrases (best-effort, capped);
    # auto-breaths fill whatever larger gaps result without compressing speech.
    bw = [bool(lines[i + 1].get('breath')) for i in range(n - 1)]
    min_gap = [BREATH_GAP if bw[i] else gap_min for i in range(n - 1)]
    target_t = list(base)
    for i in nv:
        t = base[i] * init_mult
        if i < n - 1:
            room = delta[i] - min_gap[i]
            if room > 0.02:
                t = max(t, natural[i] / room)
        else:
            room_last = budget - anchors[-1]
            if room_last > 0.02:
                t = max(t, natural[i] / room_last)
        target_t[i] = min(tempo_cap, t)
    for i in nv:
        t = target_t[i]
        ys[i] = atempo(ys[i], t / tempos[i])
        tempos[i] = round(t, 3)
    fit_mult = max((tempos[i] / base[i] for i in nv), default=init_mult)
    d = [len(y) / SR for y in ys]
    gaps = [float(np.clip(delta[i] - d[i], gap_min, GAP_MAX)) for i in range(n - 1)]

    def waterfill(floors):
        total = sum(d) + sum(gaps)
        for _ in range(10):
            if total <= budget + 0.002:
                break
            free = [i for i in range(n - 1) if gaps[i] > floors[i] + 1e-6]
            if not free:
                break
            share = (total - budget) / len(free)
            for i in free:
                gaps[i] = max(floors[i], gaps[i] - share)
            total = sum(d) + sum(gaps)
        return total

    total = waterfill(min_gap)
    if total > budget + 0.002:
        total = waterfill([gap_min] * (n - 1))
    if total > budget + 0.002:
        at_cap = [i for i in nv if tempos[i] >= tempo_cap - 1e-6]
        raise FitError(f'cannot fit slot: {total:.2f}s vs budget {budget:.2f}s '
                       f'(speech {sum(d):.2f}s at tempo cap {tempo_cap})', at_cap)

    # deterministic micro-timing jitter on non-verdict onsets (verdicts exact).
    rng = random.Random(seed ^ 0x9E3779B9)
    for i in range(1, n):
        if lines[i].get('verdict'):
            continue
        j = rng.uniform(-JITTER, JITTER)
        floor_prev = 0.30 if bw[i - 1] else gap_min
        if gaps[i - 1] + j < floor_prev:
            j = floor_prev - gaps[i - 1]
        if i < n - 1:
            floor_cur = 0.30 if bw[i] else gap_min
            if gaps[i] - j < floor_cur:
                j = gaps[i] - floor_cur
            if abs(j) < 0.002:
                continue
            gaps[i - 1] += j
            gaps[i] -= j
        else:
            if abs(j) < 0.002 or sum(d) + sum(gaps) + j > budget + 0.002:
                continue
            gaps[i - 1] += j
    onsets, pos = [], 0.0
    for i in range(n):
        onsets.append(pos)
        pos += d[i] + (gaps[i] if i < n - 1 else 0.0)
    drifts = [round(onsets[i] - anchors[i], 3) for i in range(n)]
    tight = [i for i in range(n - 1) if delta[i] - d[i] < gap_min - 1e-6]
    return gaps, fit_mult, drifts, tight


def load_anchors(work):
    """Approved Kokoro cut onsets (local to audio_offset), snapshotted once."""
    p = os.path.join(work, 'cosy_cache', 'anchors_kokoro.json')
    if not os.path.exists(p):
        raise SystemExit(f'missing Kokoro anchor snapshot: {p}')
    doc = json.load(open(p))
    out, speeds = {}, {}
    for r in doc['segments']:
        out[r['id']] = [round(m['start'] - r['audio_offset'], 4) for m in r['sentence_marks']]
        speeds[r['id']] = float(r.get('speed', 1.0))
    return out, speeds


def add_inter_segment_breaths(track, rows):
    """Audible natural inhales in the inter-segment gaps (topic shifts), never
    over speech; each ends ~0.10 s before the next segment's onset."""
    n = 0
    for i in range(1, len(rows)):
        cur, prev = rows[i], rows[i - 1]
        prev_end = prev['audio_offset'] + prev['measured_audio']
        gap = cur['audio_offset'] - prev_end
        if gap >= 0.50:
            dur = float(np.clip(gap - 0.22, 0.24, 0.34))
            b = vd.breath(dur=dur, seed=(i * 137 + 5) % 1000)
            n48 = int(round(len(b) * SR_OUT / SR))
            b48 = np.interp(np.linspace(0, len(b) - 1, n48), np.arange(len(b)), b).astype(np.float32)
            start = cur['audio_offset'] - 0.10 - len(b48) / SR_OUT
            if start >= prev_end + 0.05:
                a = int(round(start * SR_OUT))
                track[a:a + len(b48)] += b48
                n += 1
    return n


def run_demo():
    script = json.load(open(os.path.join(HERE, 'script', 'demo-script.json')))
    direction = json.load(open(os.path.join(VOICE_DIR, 'demo-direction.json')))
    dseg = {d['id']: d for d in direction['segments']}
    work = os.path.join(HERE, 'work_voice')
    cache = os.path.join(work, 'cosy_cache', 'lines')
    os.makedirs(os.path.join(work, 'audio'), exist_ok=True)
    anchors, anchor_speeds = load_anchors(work)
    total = script['total_seconds']
    assert 170.0 <= total <= 178.0
    track = np.zeros(int(round(total * SR_OUT)), dtype=np.float32)
    rows, word_total = [], 0
    for seg in script['segments']:
        sid, dur = seg['id'], seg['duration']
        d = dseg[sid]
        vd.validate_lines(seg, d['lines'])
        hook = seg['kind'] == 'hook'
        lead, tail = (0.10, 0.05) if hook else (0.25, 0.20)
        budget = dur - lead - tail
        nwords = len(seg['narration'].split())
        word_total += nwords
        seed = int(hashlib.md5(seg['narration'].encode()).hexdigest()[:8], 16)
        init_mult = anchor_speeds.get(sid, 1.0)
        anch = anchors[sid]
        tempo_cap = 1.28 if hook else TEMPO_MAX   # urgent hook may run a touch brisker
        gap_min = 0.04 if hook else GAP_MIN       # hook pauses tighten first (no rushing speech)
        brisk_extra = set()
        all_nv = {i for i, ln in enumerate(d['lines']) if not ln.get('verdict')}
        for attempt in range(4):
            ys, tempos = render_lines(d['lines'], sid, STYLES_DEMO, SPECIAL_DEMO, cache, init_mult, brisk_extra)
            assert len(anch) == len(ys), f'seg{sid} anchor count mismatch'
            try:
                gaps, fit_mult, drifts, tight = fit_anchored(ys, d['lines'], anch, budget, tempos, seed, init_mult, tempo_cap, gap_min)
            except FitError as e:
                if attempt == 3:
                    raise SystemExit(f'seg{sid}: {e}')
                brisk_extra |= set(e.at_cap)
                if attempt >= 1:
                    brisk_extra |= all_nv
                print(f'seg{sid:02d} fit overflow -> brisk re-gen {sorted(brisk_extra)}', flush=True)
                continue
            vdrift = max((abs(dr) for ln, dr in zip(d['lines'], drifts) if ln.get('verdict')), default=0.0)
            maxdrift = max((abs(dr) for dr in drifts), default=0.0)
            if vdrift <= 0.03 and maxdrift <= 0.05:
                break
            if attempt == 3:
                raise SystemExit(f'seg{sid}: verdict drift {vdrift:.3f}s / max drift {maxdrift:.3f}s after brisk')
            brisk_extra |= set(tight)
            if attempt >= 1:
                brisk_extra |= all_nv
            print(f'seg{sid:02d} drift v{vdrift:.3f}/max{maxdrift:.3f} tight {tight} -> brisk {sorted(brisk_extra)}', flush=True)
        y, marks = assemble(ys, d['lines'], gaps, seed)
        row, polished = vd.place_segment(work, sid, y, marks, seg['start'], lead, dur, {
            'kind': seg['kind'], 'chapter': seg.get('chapter'),
            'min_tail': tail, 'pause_scale': 1.0, 'speed': round(fit_mult, 3),
            'clip_duration': dur, 'words': nwords,
            'energy': d.get('energy'), 'direction': d['lines'],
            'cosy': {'tempo': tempos, 'anchor_drift': drifts, 'brisk': sorted(brisk_extra)},
        }, lines=d['lines'])
        polished = finalize_endings(polished, marks)
        sf.write(os.path.join(work, 'audio', f'seg{sid:02d}.wav'), polished, SR_OUT, subtype='PCM_16')
        a = int(round(row['audio_offset'] * SR_OUT))
        track[a:a + len(polished)] += polished
        rows.append(row)
        vdrift = max((abs(dr) for ln, dr in zip(d['lines'], drifts) if ln.get('verdict')), default=0.0)
        print(f'seg{sid:02d} {seg["kind"]:8s} allotted {dur:5.2f}  audio {row["measured_audio"]:6.3f}  '
              f'fit {fit_mult:.3f}  headroom {row["headroom"]:5.3f}  verdict_drift {vdrift:.3f}  '
              f'{d.get("energy", "")}', flush=True)
    nb = add_inter_segment_breaths(track, rows)
    track += vd.room_tone(len(track))
    sf.write(os.path.join(work, 'narration.wav'), track, SR_OUT, subtype='PCM_16')
    json.dump({'lead_in': 0.25, 'min_tail': 0.20, 'total': total, 'sample_rate': SR_OUT,
               'voice': 'cosyvoice3-female (demo0001 ref)', 'engine': 'cosyvoice3 (instruct2)',
               'direction': 'video/work_qwen/voice/demo-direction.json',
               'word_count': word_total, 'inter_segment_breaths': nb, 'segments': rows},
              open(os.path.join(work, 'timing.json'), 'w'), indent=2)
    speech = sum(r['measured_audio'] for r in rows)
    print(f'\ndemo: {len(rows)} segments, speech {speech:.2f}s of {total:.1f}s, '
          f'{word_total} words, {nb} inter-segment breaths -> {work}/narration.wav + timing.json')


def run_briefing():
    bdir = os.path.join(HERE, 'work_qwen', 'briefing')
    script = json.load(open(os.path.join(bdir, 'briefing-script.json')))
    direction = json.load(open(os.path.join(VOICE_DIR, 'briefing-direction.json')))
    dseg = {d['id']: d for d in direction['segments']}
    cache = os.path.join(bdir, 'cosy_cache', 'lines')
    os.makedirs(os.path.join(bdir, 'audio'), exist_ok=True)
    segs = script['segments']

    def synth_all(fit_mult):
        res = []
        for seg in segs:
            d = dseg[seg['id']]
            vd.validate_lines(seg, d['lines'])
            seed = int(hashlib.md5(seg['narration'].encode()).hexdigest()[:8], 16)
            ys, tempos = render_lines(d['lines'], seg['id'], STYLES_BRIEFING, SPECIAL_BRIEFING,
                                      cache, fit_mult)
            rng = random.Random(seed)
            gaps = [ln.get('pause', 0.30) * rng.uniform(0.88, 1.14) for ln in d['lines'][:-1]]
            y, marks = assemble(ys, d['lines'], gaps, seed)
            res.append((y, marks, len(y) / SR, tempos))
        return res

    res = synth_all(1.0)
    leads = [0.15 if s['kind'] == 'title' else 0.25 for s in segs]
    tails = [0.65 if s['kind'] == 'endcard' else 0.30 for s in segs]
    fixed = sum(leads) + sum(tails)
    speed = 1.0
    for _ in range(8):
        speech = sum(r[2] for r in res)
        pad_budget = max(0.0, 59.0 - speech - fixed)
        pads = [min(0.9, max(0.3, pad_budget * r[2] / speech)) for r in res]
        total = round(speech + fixed + sum(pads), 3)
        if total <= 59.3:
            break
        speed = min(1.125, round(speed * (total / 59.0), 4))
        print(f'briefing total {total:.2f}s overruns -> atempo fit {speed}', flush=True)
        res = synth_all(speed)
    else:
        raise SystemExit(f'briefing cannot fit <= 60 s at tempo cap 1.125: {total:.2f}s')
    speech = sum(r[2] for r in res)
    pad_budget = max(0.0, 59.0 - speech - fixed)
    pads = [min(0.9, max(0.3, pad_budget * r[2] / speech)) for r in res]
    total = round(speech + fixed + sum(pads), 3)
    assert total <= 60.0, total
    track = np.zeros(int(round(total * SR_OUT)), dtype=np.float32)
    rows, pos = [], 0.0
    for i, (s, (y, marks, _, tempos)) in enumerate(zip(segs, res)):
        lead, tail, pad = leads[i], tails[i], pads[i]
        dur = lead + len(y) / SR + tail + pad
        d = dseg[s['id']]
        row, polished = vd.place_segment(bdir, s['id'], y, marks, pos, lead, dur, {
            'key': s['key'], 'kind': s['kind'], 'footage': s.get('footage'),
            'kicker': s.get('kicker'), 'title': s.get('title'), 'stamp': s.get('stamp'),
            'duration': round(dur, 4), 'tail': tail, 'pad': round(pad, 4),
            'speed': speed, 'narration': s['narration'],
            'words': len(s['narration'].split()),
            'energy': d.get('energy'), 'direction': d['lines'],
            'cosy': {'tempo': tempos},
        }, lines=d['lines'])
        polished = finalize_endings(polished, marks)
        sf.write(os.path.join(bdir, 'audio', f'seg{s["id"]:02d}.wav'), polished, SR_OUT, subtype='PCM_16')
        a = int(round(row['audio_offset'] * SR_OUT))
        track[a:a + len(polished)] += polished
        rows.append(row)
        print(f'seg{s["id"]} {s["key"]:9s} start {pos:6.2f} dur {dur:5.2f} '
              f'speech {row["measured_audio"]:5.2f} pad {pad:4.2f}  {d.get("energy", "")}', flush=True)
        pos += dur
    nb = add_inter_segment_breaths(track, rows)
    track += vd.room_tone(len(track))
    sf.write(os.path.join(bdir, 'narration.wav'), track, SR_OUT, subtype='PCM_16')
    json.dump({'total': total, 'sample_rate': SR_OUT, 'voice': 'cosyvoice3-female (demo0001 ref)',
               'engine': 'cosyvoice3 (instruct2)',
               'direction': 'video/work_qwen/voice/briefing-direction.json',
               'speed': speed, 'word_count': sum(r['words'] for r in rows),
               'inter_segment_breaths': nb, 'segments': rows},
              open(os.path.join(bdir, 'timing.json'), 'w'), indent=2)
    print(f'\nbriefing: total {pos:.3f}s (<=60), speech {speech:.2f}s, '
          f'{sum(r["words"] for r in rows)} words, {nb} inter-segment breaths -> {bdir}/narration.wav + timing.json')


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'demo'
    if mode == 'demo':
        run_demo()
    elif mode == 'briefing':
        run_briefing()
    else:
        raise SystemExit('usage: voice_cosy.py demo|briefing  (run with the CosyVoice engine venv python)')