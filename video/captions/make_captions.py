#!/usr/bin/env python3
"""Demo v3, step B: word-accurate karaoke captions from faster-whisper alignment.

Usage: video/.venv/bin/python video/captions/make_captions.py [work-dir]
       (default video/work_voice — must match voice3.py's work dir)

Inputs:  video/script/demo-script.json   (authoritative word text)
         <work>/timing.json              (measured per-segment audio, voice3.py)
         <work>/narration.wav            (the full 175 s voice track)

Method:  transcribe narration.wav with faster-whisper small.en (int8, CPU),
         word_timestamps=True; align whisper words to the script words inside
         each segment's known audio window (segment-anchored sequence alignment,
         number expansion, Mei->May synthesis map applied to the script side).
         Caption times ARE the whisper word times — no character interpolation
         (the old cut's ±0.6 s drift came from char-position interpolation).

Outputs: video/captions/captions.json    word-level times/colours + cue grouping
         video/captions/captions.ass     word-by-word highlight ASS (V5 reference)
         video/captions/captions.srt     SRT twin (<=44 chars/line, <=2 lines)
         assets/demo-video.srt           uploadable SRT (same content)
         <work>/caption_pngs/wNNN.png    per-word-state 1920x1080 RGBA overlays
                                         (this ffmpeg build has no libass; V5
                                         burns these with enable windows)
         <work>/timing.json              updated: per-word timestamps per segment

Display: spoken number-words render as digits in one token ("SGD 10,260",
         "5,800", "195", "30 out of 30"); cue lines block at phrase boundaries
         and never split a number run. Word windows stay per spoken word, so
         the karaoke underline tracks the digit token across the whole run.
"""
import difflib, glob, json, os, re, subprocess, sys
import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEO = os.path.normpath(os.path.join(HERE, '..'))
sys.path.insert(0, VIDEO)
import tts  # noqa: E402  (say_as: the synthesis-only pronunciation map)

WORK = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(VIDEO, 'work_voice')
SCRIPT = os.path.join(VIDEO, 'script', 'demo-script.json')
FONTS = os.path.join(VIDEO, 'motion', 'fonts')
PNG_DIR = os.path.join(WORK, 'caption_pngs')

MAX_CHARS = 44
MAX_LINES = 2
FONT_SIZE = 40
PILL_BOTTOM = 965
PAD_X, PAD_Y = 30, 12
PILL_RADIUS = 14
PILL_FILL = (15, 23, 42, 224)
PILL_STROKE = (30, 41, 59, 255)
WHITE = '#FFFFFF'
UPCOMING = '#94A3B8'
DECISION = {  # normalised token -> caption colour (editor report §1.4)
    # 'approval' intentionally NOT coloured: it appears inside BLOCK scenes
    # ("An email is not an approval.") where HOLD-yellow would mislead.
    'block': '#EDA69C', 'blocked': '#EDA69C', 'stopped': '#EDA69C',
    'hold': '#E8C988', 'held': '#E8C988', 'holds': '#E8C988',
    'waiting': '#E8C988', 'waits': '#E8C988',
    'allow': '#A9D9B8', 'allowed': '#A9D9B8', 'allows': '#A9D9B8', 'done': '#A9D9B8',
}

script = json.load(open(SCRIPT))
timing = json.load(open(os.path.join(WORK, 'timing.json')))
tseg = {r['id']: r for r in timing['segments']}

# ---------------------------------------------------------------- whisper ASR
def load_model():
    pat = os.path.expanduser('~/.cache/huggingface/hub/models--Systran--faster-whisper-small.en/snapshots/*')
    snaps = [p for p in glob.glob(pat) if os.path.exists(os.path.join(p, 'model.bin'))]
    from faster_whisper import WhisperModel
    if snaps:
        os.environ['HF_HUB_OFFLINE'] = '1'
        return WhisperModel(snaps[0], device='cpu', compute_type='int8')
    return WhisperModel('small.en', device='cpu', compute_type='int8')

wav16 = os.path.join(WORK, 'narration_16k.wav')
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', os.path.join(WORK, 'narration.wav'),
                '-ar', '16000', '-ac', '1', wav16], check=True)
import hashlib
nh = hashlib.md5(open(os.path.join(WORK, 'narration.wav'), 'rb').read()).hexdigest()
cache = os.path.join(WORK, f'asr_{nh}_default.json')
if os.path.exists(cache):
    asr = json.load(open(cache))
    print(f'using cached ASR ({len(asr)} words)')
else:
    x16, sr16 = sf.read(wav16, dtype='float32')
    assert sr16 == 16000
    print('transcribing with faster-whisper small.en int8 (default settings) ...')
    model = load_model()
    # default settings (condition_on_previous_text=True) — matches the
    # reviewer's measurement pipeline; word times are snapped verbatim below
    wsegs, _ = model.transcribe(x16, language='en', word_timestamps=True)
    asr = []
    for s in wsegs:
        for w in s.words:
            asr.append({'text': w.word.strip(), 'start': float(w.start),
                        'end': float(w.end), 'p': float(w.probability)})
    json.dump(asr, open(cache, 'w'))
    print(f'  {len(asr)} whisper words')

# ---------------------------------------------------------------- normalisation
ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
        'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
        'seventeen', 'eighteen', 'nineteen']
TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

def int_words(n):
    if n < 20:
        return [ONES[n]]
    if n < 100:
        return [TENS[n // 10]] + ([ONES[n % 10]] if n % 10 else [])
    if n < 1000:
        return [ONES[n // 100], 'hundred'] + (int_words(n % 100) if n % 100 else [])
    if n < 1000000:
        return int_words(n // 1000) + ['thousand'] + (int_words(n % 1000) if n % 1000 else [])
    return int_words(n // 1000000) + ['million'] + (int_words(n % 1000000) if n % 1000000 else [])

# Pronunciation canonicalisation (CosyVoice re-voice): whisper spells the spoken
# names variably ("Mei"/"May" for /meɪ/, "Quenwerk"/"Quinn Work" for "Kwen Work").
# Map both the script side (post SAY_AS) and the ASR side to one canonical form so
# alignment is exact. Captions/SRT still display the real spellings (Mei, QwenWork).
NAME_CANON = {
    'mei': 'may',
    'quenwerk': 'kwen work', 'qwenwork': 'kwen work', 'quenwork': 'kwen work',
    'qwen': 'kwen', 'quinn': 'kwen', 'qn': 'kwen',
    # punchy isolated verdicts whisper mishears phonetically (low confidence)
    'docked': 'stopped', 'stocked': 'stopped', 'locked': 'blocked', 'blocked': 'blocked',
    'held': 'held', 'hell': 'held', 'help': 'held',
    # stressed "IS" heard as "eyes" (the owner IS the whole company)
    'eyes': 'is',
}

def norm_subs(tok):
    """token -> list of comparable subtokens (whisper digits expanded to words)."""
    t = tok.lower().strip()
    t = t.replace('’', "'")
    t = t.replace('%', ' percent ').replace('+', ' plus ').replace('=', ' is ').replace('/', ' ')
    t = re.sub(r'(?<=\d)\s*,\s*(?=\d)', '', t)   # "10 ,260" -> "10260"
    t = re.sub(r'(?<=\d)\s+(?=\d)', '', t)
    t = re.sub(r'^[^a-z0-9\']+', '', t)
    t = re.sub(r'[^a-z0-9\']+$', '', t)
    if not t:
        return []
    out = []
    for part in t.split():
        for piece in part.split('-'):
            piece = piece.strip("'")
            if not piece:
                continue
            digits = re.sub(r'[^0-9]', '', piece)
            if digits and re.fullmatch(r'[0-9,.\']+', piece):
                out += int_words(int(digits))
            elif piece in NAME_CANON:
                out += NAME_CANON[piece].split()
            else:
                out.append(piece)
    return out

# Canonicalise number-word runs ("fifteen hundred" == "1500" == "one thousand
# five hundred") so spoken and digit forms align exactly.
NUM = {w: i for i, w in enumerate(ONES)}
for i, w in enumerate(TENS):
    if w:
        NUM[w] = i * 10
NUM.update({'hundred': 100, 'thousand': 1000, 'million': 1000000})

def parse_num(run):
    total, cur = 0, 0
    for w in run:
        v = NUM[w]
        if v < 100:
            cur += v
        elif v == 100:
            cur = (cur or 1) * 100
        else:
            total += (cur or 1) * v
            cur = 0
    return total + cur

def canon(subs):
    out, imap = [], {}
    i = 0
    while i < len(subs):
        if subs[i] == '\x00':      # sentence boundary: flush, never align
            imap[i] = len(out)
            i += 1
        elif subs[i] in NUM:
            j = i
            while j < len(subs) and subs[j] in NUM:
                j += 1
            for k in range(i, j):
                imap[k] = len(out)
            out.append(f'#{parse_num(subs[i:j])}')
            i = j
        else:
            imap[i] = len(out)
            out.append(subs[i])
            i += 1
    imap[len(subs)] = len(out)
    return out, imap

def ends_sentence(tok):
    return bool(re.search(r'[.!?;]["\')\]]*$', tok.strip()))

def dp_align(a, b):
    """Monotonic global alignment (Needleman-Wunsch). Exact subtoken match = 2,
    fuzzy ratio >= 0.6 counts, anything else is a mismatch. Returns {i: j}."""
    n, m = len(a), len(b)
    GAP = -1.0
    S = [[0.0] * (m + 1) for _ in range(n + 1)]
    P = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        S[i][0] = S[i - 1][0] + GAP
        P[i][0] = 1
    for j in range(1, m + 1):
        S[0][j] = S[0][j - 1] + GAP
        P[0][j] = 2
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if a[i - 1] == b[j - 1]:
                s = 2.0
            else:
                r = difflib.SequenceMatcher(a=a[i - 1], b=b[j - 1]).ratio()
                s = r if r >= 0.55 else -1.0
            diag, up, left = S[i - 1][j - 1] + s, S[i - 1][j] + GAP, S[i][j - 1] + GAP
            if diag >= up and diag >= left:
                S[i][j], P[i][j] = diag, 0
            elif up >= left:
                S[i][j], P[i][j] = up, 1
            else:
                S[i][j], P[i][j] = left, 2
    pairs, i, j = {}, n, m
    while i > 0 and j > 0:
        if P[i][j] == 0:
            if a[i - 1] == b[j - 1] or \
               difflib.SequenceMatcher(a=a[i - 1], b=b[j - 1]).ratio() >= 0.55:
                pairs[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif P[i][j] == 1:
            i -= 1
        else:
            j -= 1
    return pairs

def script_words(seg):
    """Display tokens + alignment subtokens. SAY_AS applied per display word on
    the ALIGNMENT side only (whisper hears 'May' / 'Kwen Work', the script and
    captions keep 'Mei' / 'QwenWork'). Per-word application supports 1->many
    respellings (QwenWork -> 'Kwen Work'). Standalone dashes attach to the
    previous word and get no time of their own."""
    disp = seg['narration'].split()
    words, subs = [], []
    for d in disp:
        if re.fullmatch(r'[—–-]+', d):
            if words:
                words[-1]['text'] += ' ' + d
            continue
        t = tts.say_as(d)
        ss = norm_subs(t)
        words.append({'text': d, 'sub0': len(subs), 'subn': len(subs) + len(ss),
                      'start': None, 'end': None, 'matched': False})
        subs += ss
        if ends_sentence(d):
            subs.append('\x00')   # keep "twenty. Five" from merging into #205
    subs, imap = canon(subs)
    for w in words:
        a, b = imap[w['sub0']], imap[w['subn']]
        if a == b and w['sub0'] < w['subn']:
            b = a + 1   # word inside a collapsed number run shares its token
        w['sub0'], w['subn'] = a, b
    return words, subs

# ---------------------------------------------------------------- alignment
def align_segment(seg, words, subs):
    ts = tseg[seg['id']]
    lo = ts['audio_offset'] - 0.20
    hi = ts['audio_offset'] + ts['measured_audio'] + 0.30
    aw = [w for w in asr if lo <= (w['start'] + w['end']) / 2 <= hi]
    # whisper splits numbers on comma-spaces ("5" + ",040") and hyphens
    # ("thirty" + "-six"); rejoin the fragments so each logical word keeps its
    # own ASR span
    merged = []
    for w in aw:
        if merged and re.search(r'\d$', merged[-1]['text']) and re.match(r'^[,.]?\d', w['text']):
            merged[-1] = {'text': merged[-1]['text'] + w['text'], 'start': merged[-1]['start'],
                          'end': w['end'], 'p': min(merged[-1]['p'], w['p'])}
        elif merged and w['text'].startswith('-') and re.search(r'[a-z]$', merged[-1]['text'], re.I):
            merged[-1] = {'text': merged[-1]['text'] + w['text'], 'start': merged[-1]['start'],
                          'end': w['end'], 'p': min(merged[-1]['p'], w['p'])}
        elif merged and merged[-1]['text'].lower() in ('qn', 'quinn') and w['text'].lower() == 'work':
            merged[-1] = {'text': merged[-1]['text'] + ' ' + w['text'], 'start': merged[-1]['start'],
                          'end': w['end'], 'p': min(merged[-1]['p'], w['p'])}
        else:
            merged.append(dict(w))
    aw = merged
    asubs, aowner = [], []
    for i, w in enumerate(aw):
        ss = norm_subs(w['text'])
        asubs += ss
        aowner += [i] * len(ss)
        if ends_sentence(w['text']):
            asubs.append('\x00')
            aowner.append(i)
        elif (w['text'].rstrip().endswith(',') and ss and all(s in NUM for s in ss)
              and parse_num(ss) <= 99 and i + 1 < len(aw)):
            # A comma-terminated complete small cardinal ("really two,") followed
            # by another number is a clause boundary, not one big number: keep it
            # separate so "two, 5,250" aligns as #2 | #5250 (script: "two. Five…").
            nxt = norm_subs(aw[i + 1]['text'])
            if nxt and nxt[0] in NUM:
                asubs.append('\x00')
                aowner.append(i)
    asubs_raw = asubs
    asubs, amap = canon(asubs)
    owner_runs = [[] for _ in asubs]
    for old_i in sorted(amap):
        ni = amap[old_i]
        if old_i < len(aowner) and ni < len(owner_runs) and asubs_raw[old_i] != '\x00':
            if aowner[old_i] not in owner_runs[ni]:
                owner_runs[ni].append(aowner[old_i])
    for r in owner_runs:
        if not r:
            r.append(0)
    # script subtoken -> canonical whisper token index
    smap = dict(dp_align(subs, asubs))
    for w in words:
        hits = sorted({smap[i] for i in range(w['sub0'], w['subn']) if i in smap})
        w['hits'] = hits
        w['owners'] = tuple(dict.fromkeys(o for h in hits for o in owner_runs[h]))
        if hits:
            w['start'] = aw[w['owners'][0]]['start']
            w['end'] = aw[w['owners'][-1]]['end']
            w['matched'] = True
    # stacked runs: several script words sharing the SAME whisper word(s)
    # ("one hundred thirty-six" vs "136", "Twenty-five percent" vs "25%.").
    # Spread them 1:1 across the ASR fragment words when counts match, else
    # proportionally by word length within the merged span — never stack them
    # all on the token start.
    i = 0
    while i < len(words):
        j = i
        if words[i]['matched'] and words[i]['owners']:
            while j + 1 < len(words) and words[j + 1]['matched'] \
                  and words[j + 1]['owners'] == words[i]['owners']:
                j += 1
        if j > i:
            run = words[i:j + 1]
            orun = list(run[0]['owners'])
            s0, s1 = aw[orun[0]]['start'], aw[orun[-1]]['end']
            if len(run) == len(orun):
                for w, o in zip(run, orun):
                    w['start'], w['end'] = aw[o]['start'], aw[o]['end']
                    w['distributed'] = '1:1'
            else:
                weights = [max(1, len(re.sub(r'[^a-z0-9]', '', w['text'].lower()))) for w in run]
                tot = sum(weights)
                acc = 0
                for w, wt in zip(run, weights):
                    w['start'] = s0 + (s1 - s0) * acc / tot
                    acc += wt
                    w['end'] = s0 + (s1 - s0) * acc / tot
                    w['distributed'] = 'proportional'
            i = j + 1
        else:
            i += 1
    # interpolate unmatched words between matched anchors (segment-anchored)
    a0 = ts['audio_offset']
    a1 = ts['audio_offset'] + ts['measured_audio']
    prev_end, prev_idx = a0, -1
    for i, w in enumerate(words):
        if w['matched']:
            prev_end, prev_idx = w['end'], i
            continue
        nxt = next((j for j in range(i + 1, len(words)) if words[j]['matched']), None)
        lo_t = prev_end
        hi_t = words[nxt]['start'] if nxt is not None else a1
        n_gap = (nxt if nxt is not None else len(words)) - prev_idx - 1
        k = i - prev_idx
        w['start'] = lo_t + (hi_t - lo_t) * (k - 0.5) / max(n_gap, 1)
        w['end'] = lo_t + (hi_t - lo_t) * (k + 0.5) / max(n_gap, 1)
    # Ground-truth fallback: whisper occasionally drops a short isolated verdict
    # ("Held.") or a small cardinal ("two.") in the warm CosyVoice take. Snap any
    # still-unmatched word to its own sentence_mark line window (the measured
    # narration onset/offset) — more accurate than interpolating across lines.
    def _wc(t):
        return len(re.findall(r"[a-z0-9']+", t.lower().replace('’', "'")))
    line_bounds, acc = [], 0
    for m in ts['sentence_marks']:
        n = _wc(m['text'])
        line_bounds.append((m['start'], m['end'], acc, acc + n))
        acc += n
    for i, w in enumerate(words):
        if w['matched']:
            continue
        for ms, me, wl, wh in line_bounds:
            if wl <= i < wh:
                span = max(wh - wl, 1)
                f0 = (i - wl) / span
                f1 = (i - wl + 1) / span
                w['start'] = ms + (me - ms) * f0
                w['end'] = ms + (me - ms) * f1
                w['matched'] = True
                w['distributed'] = 'mark-snap'
                break
    for w in words:  # trust ASR starts verbatim (whisper edge estimates may sit
        # slightly before the placed audio); cap tails, keep order. Cue windows
        # below clamp the visible highlight to the cue/segment bounds.
        w['start'] = min(w['start'], a1 + 0.15)
        w['end'] = max(w['start'] + 0.05, min(w['end'], a1 + 0.25))
    for a, b in zip(words, words[1:]):
        if b['start'] < a['start']:
            b['start'] = a['start']
        if b['end'] < b['start']:
            b['end'] = b['start'] + 0.05
    if os.environ.get('ALIGN_DEBUG'):
        print(f'--- seg{seg["id"]} alignment ---')
        print('  script subs:', subs)
        print('  whisper subs:', list(zip(asubs, [[aw[o]['text'] for o in r] for r in owner_runs])))
        for w in words:
            hits = w.get('hits', [])
            owners = [o for h in hits for o in owner_runs[h]]
            src = ' '.join(f'{aw[o]["text"]}@{aw[o]["start"]:.2f}' for o in owners) or 'INTERPOLATED'
            dist = w.get('distributed', '')
            print(f'  {w["text"]!r:22} -> {w["start"]:.2f}-{w["end"]:.2f}  [{src}] {dist}')
    return aw

def word_color(text):
    t = re.sub(r'[^a-z]', '', text.lower())
    return DECISION.get(t)

# ---------------------------------------------------------------- cue chunking
CONJ = {'and', 'but', 'or', 'so', 'because', 'when', 'then', 'that', 'which', 'while'}
DANGLE = {'a', 'an', 'the', 'to', 'of', 'for', 'in', 'on', 'at', 'with', 'by', 'from',
          'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
          'has', 'have', 'had', 'will', 'would', 'can', 'could', 'should', 'may',
          'might', 'must', 'do', 'does', 'did', 'not', 'no', 'her', 'his', 'its',
          'their', 'your', 'my', 'our', 'this', 'that', 'these', 'those', 'as',
          'than', 'into', 'over', 'under', 'between', 'each', 'through'}
VERB_OBJ = {'buys', 'makes', 'sends', 'holds', 'stops', 'needs', 'says', 'got',
            'is', 'are', 'was', 'were', 'inherits', 'hides'}
CURRENCY = {'sgd', 'usd', 's$'}
PUNCT_HARD = ('.', '!', '?')
PUNCT_SOFT = (',', ';', ':', '—', '–', '-')
MAX_MERGE_SPAN = 6.0   # merged sentences must stay within ~one breath of speech
LINE_PENALTY = 3.0     # per-line cost: fewer lines wins unless a break is ugly

def _core(t):
    return re.sub(r'[^a-z]', '', t.lower())

def display_map(words):
    """Render spoken number-words as digits in ONE visual token (red-team P2-6).
    Kokoro spells numbers as words; captions show '10,260' instead of 'ten
    thousand two hundred sixty'. Times/windows stay per spoken word: the digit
    token underlines from the run's first word to its last, so karaoke sync is
    preserved. Non-first run words get display='' (zero-width, no own token).
    Currency prefixes (SGD) and 'percent' suffixes ride along with the run."""
    def edge(t):
        m = re.match(r'^([^a-z0-9]*)(.*?)([^a-z0-9]*)$', t, re.I | re.S)
        return m.group(1), m.group(3)
    def numsubs(w):
        ss = norm_subs(tts.say_as(w['text']))
        return ss if ss and all(s in NUM for s in ss) else None
    rid, i, n = 0, 0, len(words)
    while i < n:
        if numsubs(words[i]) is None:
            words[i]['display'] = words[i]['text']
            i += 1
            continue
        j, run = i, []
        while j < n:
            ss = numsubs(words[j])
            if ss is None:
                break
            run += ss
            j += 1
            if ends_sentence(words[j - 1]['text']):
                break
        k, pct = j, ''
        if k < n and _core(words[k]['text']) == 'percent':
            pct = '%'
            k += 1
        lead, _ = edge(words[i]['text'])
        _, trail = edge(words[k - 1]['text'])
        rid += 1
        for x in range(i, k):
            words[x]['numrun'] = rid
            words[x]['display'] = ''
        words[i]['display'] = lead + f'{parse_num(run):,}' + pct + trail
        if i > 0 and re.sub(r'[^a-z$]', '', words[i - 1]['text'].lower()) in CURRENCY:
            words[i - 1]['numrun'] = rid
        i = k

def disp_len(ws):
    toks = [w['display'] for w in ws if w['display']]
    return sum(len(t) for t in toks) + max(0, len(toks) - 1)

def ulen(units):
    return disp_len([w for u in units for w in u])

def _utext(u):
    return (u[-1]['display'] or u[-1]['text']).rstrip()

def break_cost(units, j):
    """Cost of a line break BEFORE unit j. Sentence ends are free; commas,
    colons, dashes and pre-conjunction breaks are cheap; arbitrary mid-phrase
    breaks cost more; dangling line-ends, verb/object splits, number/noun
    splits and tiny remainder lines are penalised."""
    prev = _utext(units[j - 1])
    nxt = units[j][0]['display'] or units[j][0]['text']
    if prev.endswith(PUNCT_HARD):
        return 0.0
    c = 0.4 if prev.endswith(':') else (0.5 if prev.endswith(PUNCT_SOFT)
                                        else (1.0 if _core(nxt) in CONJ else 2.5))
    if not prev.endswith(PUNCT_SOFT):
        # clause punctuation already closes the phrase — only bare words dangle
        if _core(prev) in DANGLE:
            c += 6.0
        if _core(prev) in VERB_OBJ:
            c += 5.0
        if prev.endswith(("'s", '’s')):
            c += 5.0   # keep possessives with their noun ("Mei's files")
        if units[j - 1][-1].get('numrun') is not None:
            c += 5.0   # keep a spoken number with its noun ("30 actions")
    if ulen(units[j:]) < 12:
        c += 3.0   # don't strand a tiny remainder ("…AI / agent.")
    return c

def dp_pack(units):
    """Pack units into <=44-char lines at the cheapest phrase boundaries.
    Objective: break costs + LINE_PENALTY per line; ties prefer later breaks
    (fuller lines). Returns a list of lines (each a list of units)."""
    n = len(units)
    bc = [0.0] * (n + 1)
    for j in range(1, n):
        bc[j] = break_cost(units, j)
    best = [(float('inf'), float('inf'), 0)] * (n + 1)
    best[0] = (0.0, 0, 0)
    for j in range(1, n + 1):
        for i in range(j):
            if best[i][0] == float('inf'):
                continue
            L = ulen(units[i:j])
            if L > MAX_CHARS:
                continue
            extra = 0.0
            if j < n and bc[j] > 0 and j - i == 1 and L < 12 \
               and not _utext(units[j - 1]).endswith(('—', '–', '-')):
                extra = 4.0   # tiny single-word line ("Watch:") — fold into content
            cand = (best[i][0] + LINE_PENALTY + bc[j] + extra, best[i][1] + 1, -i)
            if cand < best[j]:
                best[j] = cand
    lines, j = [], n
    while j > 0:
        i = -best[j][2]
        lines.append(units[i:j])
        j = i
    return lines[::-1]

def chunk_cues(words):
    """Phrase-boundary cue blocking (editor P1-4): each sentence stays whole on
    one card when it fits (<=44 display chars/line, <=2 lines); short adjacent
    sentences merge only while the card stays <=2 lines and <=~6 s of speech.
    Oversized sentences split at clause boundaries (comma/colon/dash/conjunction)
    — never mid-phrase ("buys / years of Solo"), never mid-number. Number runs
    (with currency/percent) are atomic units throughout."""
    units, i = [], 0
    while i < len(words):
        j, rid = i + 1, words[i].get('numrun')
        if rid is not None:
            while j < len(words) and words[j].get('numrun') == rid:
                j += 1
        units.append(words[i:j])
        i = j
    sentences, cur = [], []
    for u in units:
        cur.append(u)
        if _utext(u).endswith(PUNCT_HARD):
            sentences.append(cur)
            cur = []
    if cur:
        sentences.append(cur)

    def span(us):
        ws = [w for u in us for w in u]
        return ws[-1]['end'] - ws[0]['start']

    groups = []
    for s in sentences:
        if groups:
            comb = groups[-1] + s
            if ulen(comb) <= 2 * MAX_CHARS + 1 and span(comb) <= MAX_MERGE_SPAN \
               and len(dp_pack(comb)) <= 2:
                groups[-1] = comb
                continue
        groups.append(s)
    cues = []
    for g in groups:
        lines = dp_pack(g)
        if len(lines) == 3 and _utext(lines[0][-1]).endswith((':', '—', '–', '-')):
            cues.append(lines[:1])     # intro line ("Watch:", "Blocked —") alone…
            cues.append(lines[1:])     # …then the full clause pair on one card
        else:
            for k in range(0, len(lines), 2):
                cues.append(lines[k:k + 2])
    merged = []
    for c in cues:
        if merged and len(merged[-1]) == 1 and len(c) == 1:
            comb = merged[-1][0] + c[0]
            if ulen(comb) <= MAX_CHARS and span(comb) <= MAX_MERGE_SPAN:
                merged[-1] = [comb]
                continue
        merged.append(c)
    out = []
    for cue in merged:
        lines = []
        for li, ln in enumerate(cue):
            ws = [w for u in ln for w in u]
            for w in ws:
                w['line'] = li
            lines.append(ws)
        out.append(lines)
    return out

# ---------------------------------------------------------------- build all
all_words, cues_out = [], []
drifts, bounds, n_matched, n_total = [], [], 0, 0
for seg in script['segments']:
    words, subs = script_words(seg)
    aw = align_segment(seg, words, subs)
    display_map(words)
    for i, w in enumerate(words):
        w['seg'] = seg['id']
        w['color'] = word_color(w['text'])
        n_total += 1
        n_matched += 1 if w['matched'] else 0
        if not w['matched']:
            near = [a for a in aw if abs(a['start'] - w['start']) < 0.6
                    and norm_subs(a['text'])[:1] == norm_subs(tts.say_as(w['text']))[:1]]
            if near:
                drifts.append(abs(min(near, key=lambda a: abs(a['start'] - w['start']))['start'] - w['start']))
            prev = next((words[j]['end'] for j in range(i - 1, -1, -1) if words[j]['matched']),
                        tseg[seg['id']]['audio_offset'])
            nxt = next((words[j]['start'] for j in range(i + 1, len(words)) if words[j]['matched']),
                       tseg[seg['id']]['audio_offset'] + tseg[seg['id']]['measured_audio'])
            bounds.append(max(0.0, nxt - prev))
    cues = chunk_cues(words)
    ts = tseg[seg['id']]
    slo, shi = seg['start'] + 0.05, seg['start'] + seg['duration'] - 0.05
    raw = []
    for cue in cues:
        flat = [w for ln in cue for w in ln]
        st = max(slo, flat[0]['start'] - 0.05)
        en = min(shi, flat[-1]['end'] + 0.15)
        raw.append([st, en, flat])
    # word-sync first: never delay a cue past its first word — trim the previous tail
    for k in range(1, len(raw)):
        if raw[k][0] < raw[k - 1][1] + 0.02:
            raw[k - 1][1] = max(raw[k - 1][0] + 0.4, raw[k][0] - 0.02)
    # min on-screen 0.9 s, extending into the free gap only
    for k, (st, en, flat) in enumerate(raw):
        limit = raw[k + 1][0] - 0.02 if k + 1 < len(raw) else shi
        if en - st < 0.9:
            en = min(limit, st + 0.9)
        raw[k][1] = min(shi, max(en, st + 0.4))
    for (st, en, flat), cue in zip(raw, cues):
        cid = len(cues_out) + 1
        lines_txt = [' '.join(w['display'] for w in ln if w['display']) for ln in cue]
        assert all(len(t) <= MAX_CHARS for t in lines_txt), (cid, lines_txt)
        co = {'id': cid, 'seg': seg['id'], 'start': round(st, 3), 'end': round(en, 3),
              'lines': lines_txt, 'words': []}
        for w in flat:
            w['cue'] = cid
            w['start'] = round(w['start'], 3)
            w['end'] = round(w['end'], 3)
            co['words'].append(w)
            all_words.append(w)
        cues_out.append(co)
    # close small gaps between cues (<0.25 s) by extending the earlier cue
    seg_cues = [c for c in cues_out if c['seg'] == seg['id']]
    for a, b in zip(seg_cues, seg_cues[1:]):
        if 0 < b['start'] - a['end'] < 0.25:
            a['end'] = b['start']
    ts['words'] = [{'text': w['text'], 'start': w['start'], 'end': w['end'],
                    'color': w['color'], 'matched': w['matched'],
                    'distributed': w.get('distributed')} for w in words]

if os.environ.get('ALIGN_DEBUG'):
    sys.exit(0)

# word-state windows + png names. Words inside one spoken number share the
# whisper token's start: earlier ones get zero-length windows (V5 skips them),
# the last carries the whole run — times stay verbatim whisper, tiling is exact.
for co in cues_out:
    ws = co['words']
    for i, w in enumerate(ws):
        a = co['start'] if i == 0 else w['start']
        b = ws[i + 1]['start'] if i + 1 < len(ws) else co['end']
        a = min(a, co['end'])
        b = min(max(b, a), co['end'])
        w['window'] = [round(a, 3), round(b, 3)]
for i, w in enumerate(all_words):
    w['png'] = f'w{i:03d}.png'

# ---------------------------------------------------------------- captions.json
max_drift = max(drifts + bounds) if (drifts or bounds) else 0.0
style = {'font': 'Source Sans 3', 'weight': 600, 'size': FONT_SIZE,
         'decision_font': 'Lexend', 'decision_weight': 600,
         'pill': 'rgba(15,23,42,0.88)', 'pill_stroke': '#1E293B', 'radius': PILL_RADIUS,
         'padding': [PAD_X, PAD_Y], 'bottom_y': PILL_BOTTOM, 'align': 'bottom-centre',
         'max_lines': MAX_LINES, 'max_chars': MAX_CHARS,
         'spoken': WHITE, 'upcoming': UPCOMING, 'active_underline_px': 3,
         'decision_colors': {'BLOCK': '#EDA69C', 'HOLD': '#E8C988', 'ALLOW': '#A9D9B8'}}
os.makedirs(PNG_DIR, exist_ok=True)
json.dump({'style': style,
           'alignment': {'model': 'faster-whisper small.en int8 (CPU, default settings)',
                         'words_total': n_total, 'words_matched': n_matched,
                         'match_rate': round(n_matched / n_total, 4),
                         'max_drift_s': round(max_drift, 4),
                         'drift_note': 'word starts snapped verbatim to fresh whisper timestamps; merged-number words spread 1:1 across ASR fragments (or proportionally within the merged span); unmatched words interpolated between matched anchors',
                         'display_note': 'spoken number-words rendered as digits in one token per run (display field); windows/times unchanged per spoken word; phrase-boundary cue blocking'},
           'png_dir': os.path.relpath(PNG_DIR, VIDEO),
           'cues': cues_out, 'words': all_words},
          open(os.path.join(HERE, 'captions.json'), 'w'), indent=1)
json.dump(timing, open(os.path.join(WORK, 'timing.json'), 'w'), indent=2)

# ---------------------------------------------------------------- ASS
def cue_tokens(co):
    """Visual tokens for a cue: one per non-empty display word; a number run's
    digit token spans all member words (first..last) so the underline tracks
    the spoken run while windows stay per word."""
    toks = []
    for j, w in enumerate(co['words']):
        if w['display']:
            toks.append({'text': w['display'], 'color': w['color'],
                         'first': j, 'last': j, 'line': w['line']})
        elif toks:
            toks[-1]['last'] = j
    return toks

def ass_t(x):
    h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60
    return f'{h}:{m:02d}:{s:05.2f}'

def ass_col(hexcol):
    h = hexcol.lstrip('#')
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f'&H00{b}{g}{r}&'

def ass_word(w, state):
    col = w['color'] or (WHITE if state in ('spoken', 'active') else UPCOMING)
    tags = f'\\c{ass_col(col)}' + ('\\fnLexend' if w['color'] else '\\fnSource Sans 3')
    if state == 'active':
        tags += '\\u1'
    return '{' + tags + '}' + w['text'] + ('{\\u0}' if state == 'active' else '')

with open(os.path.join(HERE, 'captions.ass'), 'w') as f:
    f.write('[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n'
            'WrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\n'
            'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, '
            'BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, '
            'BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
            'Style: Cap,Source Sans 3,40,&H00FFFFFF,&H00FFFFFF,&H003B291E,'
            '&HE02A170F,-1,0,0,0,100,100,0,0,3,12,0,2,160,160,115,1\n\n[Events]\n'
            'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n')
    for co in cues_out:
        ws = co['words']
        toks = cue_tokens(co)
        for i in range(len(ws)):
            a, b = ws[i]['window']
            parts, li, first_in_line = [], 0, True
            for t in toks:
                if t['line'] != li:
                    parts.append('\\N')
                    li = t['line']
                    first_in_line = True
                elif not first_in_line:
                    parts.append(' ')   # literal space: libass must render word gaps
                state = 'active' if t['first'] <= i <= t['last'] else (
                    'spoken' if i > t['last'] else 'upcoming')
                parts.append(ass_word(t, state))
                first_in_line = False
            f.write(f'Dialogue: 0,{ass_t(a)},{ass_t(b)},Cap,,0,0,0,,{{\\r}}' + ''.join(parts) + '\n')

# ---------------------------------------------------------------- SRT
def srt_t(x):
    h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60
    ms = int(round((s - int(s)) * 1000)); s = int(s)
    if ms == 1000:
        s, ms = s + 1, 0
    return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'

srt = ''
for i, co in enumerate(cues_out, 1):
    srt += f'{i}\n{srt_t(co["start"])} --> {srt_t(co["end"])}\n' + '\n'.join(co['lines']) + '\n\n'
open(os.path.join(HERE, 'captions.srt'), 'w').write(srt)
open(os.environ.get('CHAP_SRT') or os.path.join(VIDEO, '..', 'assets', 'demo-video.srt'), 'w').write(srt)

# ---------------------------------------------------------------- PNGs
body = ImageFont.truetype(os.path.join(FONTS, 'SourceSans3.ttf'), FONT_SIZE)
body.set_variation_by_axes([600])
dec = ImageFont.truetype(os.path.join(FONTS, 'Lexend.ttf'), FONT_SIZE)
dec.set_variation_by_axes([600])
ASC, DESC = body.getmetrics()
LINE_H = ASC + DESC - 5

def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)

def layout(co):
    toks = cue_tokens(co)
    lines = []
    for li in range(len(co['lines'])):
        ws = [t for t in toks if t['line'] == li]
        widths = [(dec if t['color'] else body).getlength(t['text']) for t in ws]
        sp = body.getlength(' ')
        total = sum(widths) + sp * (len(ws) - 1)
        lines.append((ws, widths, sp, total))
    pill_w = min(1500, max(t for _, _, _, t in lines) + 2 * PAD_X)
    pill_h = len(lines) * LINE_H + 2 * PAD_Y
    x0 = (1920 - pill_w) / 2
    y0 = PILL_BOTTOM - pill_h
    return lines, pill_w, pill_h, x0, y0

def render_state(co, active_i, path):
    lines, pill_w, pill_h, x0, y0 = layout(co)
    img = Image.new('RGBA', (1920, 1080), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([x0, y0, x0 + pill_w, y0 + pill_h], radius=PILL_RADIUS,
                        fill=PILL_FILL, outline=PILL_STROKE, width=1)
    for li, (ws, widths, sp, total) in enumerate(lines):
        tx = x0 + (pill_w - total) / 2
        ty = y0 + PAD_Y + li * LINE_H
        for t, wd in zip(ws, widths):
            fnt = dec if t['color'] else body
            spoken = t['first'] <= active_i
            col = t['color'] or (WHITE if spoken else UPCOMING)
            d.text((tx, ty), t['text'], font=fnt, fill=hex_rgb(col))
            if t['first'] <= active_i <= t['last']:
                uc = t['color'] or WHITE
                d.rectangle([tx, ty + ASC + 3, tx + wd, ty + ASC + 6], fill=hex_rgb(uc))
            tx += wd + sp
    img.save(path)

for co in cues_out:
    for i, w in enumerate(co['words']):
        render_state(co, i, os.path.join(PNG_DIR, w['png']))

# ---------------------------------------------------------------- report
long_lines = [t for co in cues_out for t in co['lines'] if len(t) > MAX_CHARS]
dec_words = [w['text'] for w in all_words if w['color']]
print(f'{len(cues_out)} cues, {len(all_words)} words, {len(all_words)} word-state PNGs')
print(f'alignment: {n_matched}/{n_total} words matched ({n_matched / n_total:.1%}), '
      f'max drift {max_drift:.3f}s (interpolated words)')
print(f'long lines: {len(long_lines)}; decision words coloured: {len(dec_words)} '
      f'({sorted(set(dec_words))})')
assert not long_lines
assert max_drift < 0.15, f'drift {max_drift} >= 0.15s'
print('OK -> captions.json / captions.ass / captions.srt / assets/demo-video.srt / PNGs')