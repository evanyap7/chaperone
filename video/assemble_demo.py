#!/usr/bin/env python3
"""Narrated live-demo video: title card + Playwright tour + end card, human voiceover, ducked music.

Two modes (run with the venv from setup_tts.sh):
  video/.venv/bin/python video/assemble_demo.py --synth <work>      # 1. voice lines -> lines.json
  node video/record_demo.mjs <work>                                 # 2. records, stretching each step to fit its line
  video/.venv/bin/python video/assemble_demo.py <work> [out.mp4]    # 3. assemble (default assets/demo-video.mp4)

The voiceover lives in demo_voiceover.json; {placeholders} are filled from a fresh engine run
(briefing.json, via dump_briefing.mjs) and reports/scenario_score.json, never typed by hand.
record_demo.mjs writes timeline.json (each step's time on the recording); each line is placed
LINE_LEAD after its step, and is never allowed to overlap the previous line.
"""
import glob, json, os, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import mix  # noqa: E402

VO = json.load(open(os.path.join(HERE, 'demo_voiceover.json')))
VW, VH, FPS = 1600, 900, 30
LINE_LEAD = 0.35      # a beat after the click before the voice comes in
MIN_GAP = 0.30        # never closer than this to the previous line
STEP_PAD = 0.7        # recorder dwell = line + this (record_demo.mjs reads it from lines.json)

WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
def word(n): return WORDS[n] if 0 <= n < len(WORDS) else str(n)

def facts(work):
    """Every figure the voiceover may use, from the engine and the score report."""
    bj = os.path.join(work, 'briefing.json')
    if not os.path.exists(bj):
        subprocess.run(['node', os.path.join(HERE, 'dump_briefing.mjs'), bj], check=True, cwd=ROOT)
    b = json.load(open(bj)); st = b['stats']
    score = json.load(open(os.path.join(ROOT, 'reports', 'scenario_score.json')))
    agents = sorted({i['agent'] for s in b['sections'] for i in s['items'] if i.get('agent')})
    waiting = next((s['items'] for s in b['sections'] if s.get('tone') == 'waiting'), [])
    q = waiting[0] if waiting else None
    if q and q.get('text', '').lower().startswith('delete') and q.get('money'):
        queue_first = f"First up, {q['agent']} wants to delete an invoice that's still {q['money']:,} dollars unpaid."
    elif q:
        queue_first = f"First up, something from {q['agent']}."
    else:
        queue_first = ''
    return {
        'agents': word(len(agents)), 'blocked': word(st['blocked']), 'held': word(st['held']),
        'held_money': f"{st['held_money']:,} dollars", 'queue_first': queue_first,
        'scenarios': word(len(score['results'])) if len(score['results']) <= 12 else len(score['results']),
        'score_total': score['total'], 'score_max': score['max'],
    }

def synth(work):
    import tts
    os.makedirs(os.path.join(work, 'vo'), exist_ok=True)
    f = facts(work)
    items = [('title', VO['title'])] + [(s['id'], s) for s in VO['steps']] + [('end', VO['end'])]
    lines = {}
    for key, spec in items:
        text = spec['line'].format(**f).strip()
        y, _ = tts.synth(text)
        wav = os.path.join(work, 'vo', f'{key}.wav'); tts.write(wav, y)
        dur = len(y) / tts.SR
        lines[key] = {'text': text, 'wav': wav, 'dur': round(dur, 3), 'min': spec.get('min', 2.0),
                      'dwell': round(max(spec.get('min', 2.0), dur + STEP_PAD), 3)}
        print(f'{key:10s} {dur:5.2f}s  {text}')
    json.dump({'sr': tts.SR, 'lead': LINE_LEAD, 'lines': lines}, open(os.path.join(work, 'lines.json'), 'w'), indent=2)

def card(png, secs, out):
    mix.run(['ffmpeg', '-y', '-v', 'error', '-loop', '1', '-framerate', str(FPS), '-i', os.path.join(HERE, png), '-t', f'{secs:.3f}',
             '-vf', f'scale={VW}:{VH},fade=t=in:st=0:d=0.5,fade=t=out:st={secs - 0.5:.3f}:d=0.5',
             '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', out])

def assemble(work, out):
    L = json.load(open(os.path.join(work, 'lines.json')))
    lines, sr = L['lines'], L['sr']
    tl = json.load(open(os.path.join(work, 'timeline.json')))
    webm = tl.get('video') or sorted(glob.glob(os.path.join(work, '*.webm')), key=os.path.getmtime)[-1]

    title_len = max(lines['title']['min'], lines['title']['dur'] + 1.0)
    end_len = max(lines['end']['min'], lines['end']['dur'] + 1.8)
    rec = os.path.join(work, 'drec.mp4')
    mix.run(['ffmpeg', '-y', '-v', 'error', '-i', webm, '-an', '-vf', f'scale={VW}:{VH},fps={FPS},fade=t=in:st=0:d=0.4',
             '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', rec])
    rec_len = mix.duration(rec)
    t_card, e_card = os.path.join(work, 'dtitle.mp4'), os.path.join(work, 'dend.mp4')
    card('demo_title.png', title_len, t_card); card('demo_end.png', end_len, e_card)
    lst = os.path.join(work, 'dconcat.txt')
    with open(lst, 'w') as fh:
        for c in (t_card, rec, e_card): fh.write(f"file '{c}'\n")
    joined = os.path.join(work, 'djoined.mp4')
    mix.run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', joined])
    total = mix.duration(joined)

    # Place each line on the absolute timeline; push a line later rather than ever overlapping.
    marks = [('title', 0.45)] + [(s['id'], title_len + s['t'] + L['lead']) for s in tl['steps'] if s['id'] in lines] \
            + [('end', title_len + rec_len + 0.5)]
    track = np.zeros(int((total + 1) * sr), dtype=np.float32)
    import soundfile as sf
    prev_end, report = 0.0, []
    for key, at in marks:
        y, _ = sf.read(lines[key]['wav'], dtype='float32')
        start = max(at, prev_end + MIN_GAP)
        a = int(start * sr); track[a:a + len(y)] += y[:max(0, len(track) - a)]
        prev_end = start + len(y) / sr
        report.append({'id': key, 'at': round(start, 2), 'end': round(prev_end, 2), 'pushed': round(start - at, 2)})
        if start - at > 0.05: print(f'  ! {key}: pushed {start - at:.2f}s to avoid overlap')
    if prev_end > total - 0.3: print(f'  ! voice runs to {prev_end:.2f}s, video is {total:.2f}s')
    import tts
    raw = os.path.join(work, 'dvoice_raw.wav'); tts.write(raw, track)
    voice = os.path.join(work, 'dvoice.wav'); tts.polish(raw, voice)
    audio = os.path.join(work, 'dmix.wav')
    stats = mix.duck_and_normalize(voice, os.path.join(HERE, 'music.mp3'), total, audio, fade_out=2.5)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    mix.mux(joined, audio, out)
    json.dump({'total': total, 'title': title_len, 'recording': rec_len, 'end': end_len, 'lines': report},
              open(os.path.join(work, 'demo_manifest.json'), 'w'), indent=2)
    print('wrote', out, f'| duration {mix.duration(out):.2f}s | pre-norm {stats["input_i"]} LUFS')

if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--synth':
        synth(os.path.abspath(sys.argv[2]))
    elif len(sys.argv) > 1:
        work = os.path.abspath(sys.argv[1])
        assemble(work, os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(ROOT, 'assets', 'demo-video.mp4'))
    else:
        raise SystemExit(__doc__)
