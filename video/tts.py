#!/usr/bin/env python3
"""Local, human-sounding narration with Kokoro-82M (kokoro-onnx). Shared by both videos.

Run with the venv from setup_tts.sh:  video/.venv/bin/python video/tts.py "Some text." out.wav

What makes it sound like a person rather than a system:
  * sentence-by-sentence synthesis, each sentence's own silence trimmed, then re-joined
    with natural, slightly varied pauses (deterministic: seeded from the text);
  * a tiny per-sentence speed drift around the base speed, like a real speaker;
  * a speech-only pronunciation map (names the model would otherwise misread);
  * gentle studio polish in ffmpeg (see POLISH): high-pass, de-ess, light compression.
Loudness normalisation happens once, on the final mix.
"""
import hashlib, os, random, re, subprocess, sys
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, 'models', 'kokoro-v1.0.onnx')
VOICES = os.path.join(HERE, 'models', 'voices-v1.0.bin')

# af_heart is the top-graded Kokoro voice (A); a little af_bella (A-) adds warmth and
# breathiness without losing clarity. Override with TTS_VOICE="af_heart" or "af_heart:0.7,af_bella:0.3".
VOICE = os.environ.get('TTS_VOICE', 'af_heart:0.8,af_bella:0.2')
SPEED = float(os.environ.get('TTS_SPEED', '1.0'))
SR = 24000

# Spoken-only fixes; the script and slides keep the real spelling.
SAY_AS = {
    r'\bMei\b': 'May',
    r'\bcashflow\b': 'cash-flow',
    r'\bQuickPrint\b': 'Quick Print',
    r'\bokay\b': 'okay',
}

# Pauses (seconds) after a sentence, before the next one, by how the sentence ends.
PAUSE = {'.': (0.26, 0.40), '?': (0.30, 0.44), '!': (0.26, 0.38)}

POLISH = ('highpass=f=80,lowpass=f=15000,'
          'deesser=i=0.35:m=0.5:f=0.5,'
          'acompressor=threshold=-20dB:ratio=2.2:attack=10:release=160:knee=4:makeup=1.5')

_kokoro = None
def _engine():
    global _kokoro
    if _kokoro is None:
        if not os.path.exists(MODEL):
            raise SystemExit('Kokoro model missing: run video/setup_tts.sh first')
        from kokoro_onnx import Kokoro
        _kokoro = Kokoro(MODEL, VOICES)
    return _kokoro

def _voice():
    k = _engine()
    parts = [p.split(':') for p in VOICE.split(',')]
    if len(parts) == 1 and len(parts[0]) == 1:
        return parts[0][0]
    total = sum(float(w) for _, w in parts)
    return sum(k.get_voice_style(name) * (float(w) / total) for name, w in parts)

def say_as(text):
    for pat, rep in SAY_AS.items():
        text = re.sub(pat, rep, text)
    return text

def sentences(text):
    """Split into spoken sentences, keeping the terminal punctuation."""
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z"“‘\'])', text.strip())
    return [p for p in (s.strip() for s in parts) if p]

def _trim(x, thresh=0.006, keep=0.035):
    idx = np.where(np.abs(x) > thresh)[0]
    if not len(idx):
        return x[:0]
    a = max(0, idx[0] - int(keep * SR)); b = min(len(x), idx[-1] + int(keep * 2 * SR))
    y = x[a:b].copy()
    f = int(0.008 * SR)  # 8 ms fades: no clicks at the joins
    if len(y) > 2 * f:
        y[:f] *= np.linspace(0, 1, f); y[-f:] *= np.linspace(1, 0, f)
    return y

def synth(text, seed=None):
    """Synthesize text sentence by sentence. Returns (samples float32 @24k, [(start, end, sentence)])."""
    rng = random.Random(seed if seed is not None else int(hashlib.md5(text.encode()).hexdigest()[:8], 16))
    k, voice = _engine(), _voice()
    out, marks, t = [], [], 0.0
    sents = sentences(text)
    for i, s in enumerate(sents):
        speed = SPEED * rng.uniform(0.975, 1.025)
        audio, sr = k.create(say_as(s), voice=voice, speed=speed, lang='en-us')
        assert sr == SR, sr
        y = _trim(np.asarray(audio, dtype=np.float32))
        out.append(y); marks.append((t, t + len(y) / SR, s)); t += len(y) / SR
        if i < len(sents) - 1:
            lo, hi = PAUSE.get(s[-1], (0.24, 0.34))
            gap = np.zeros(int(rng.uniform(lo, hi) * SR), dtype=np.float32)
            out.append(gap); t += len(gap) / SR
    return (np.concatenate(out) if out else np.zeros(0, np.float32)), marks

def write(path, samples):
    sf.write(path, samples, SR, subtype='PCM_16')

def polish(src, dst, sr=48000):
    """Studio polish for a voice-only track: high-pass, de-ess, light compression, resample."""
    r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', src, '-af', POLISH,
                        '-ar', str(sr), '-ac', '1', dst], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr[-1500:])

if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit('usage: tts.py "text" out.wav')
    y, marks = synth(sys.argv[1])
    raw = sys.argv[2] + '.raw.wav'
    write(raw, y); polish(raw, sys.argv[2]); os.remove(raw)
    for a, b, s in marks:
        print(f'{a:6.2f}-{b:6.2f}  {s}')
    print(f'{len(y) / SR:.2f}s -> {sys.argv[2]}')
