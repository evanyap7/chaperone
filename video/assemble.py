#!/usr/bin/env python3
"""Briefing video, step 2: slow Ken Burns + crossfades, voice over a ducked music bed, -16 LUFS.

Usage: video/.venv/bin/python video/assemble.py <work-dir> [out.mp4]   (after render.py)
Default output: assets/briefing-60s.mp4

Frames are drawn in parallel, but each worker encodes its own short chunk (CHUNK frames) into its
own ffmpeg process and file, and the chunks are joined losslessly at the end. No pipe is shared
between processes, so nothing can deadlock; every wait has a timeout (ASSEMBLE_TIMEOUT, seconds).
"""
import json, os, shutil, subprocess, sys
import multiprocessing as mp
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mix  # noqa: E402

W, H = 1920, 1080
PAPER = (250, 247, 241)
CHUNK = 90                                              # frames per worker job (3 s at 30 fps)
TIMEOUT = float(os.environ.get('ASSEMBLE_TIMEOUT', '900'))
X264 = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-tune', 'stillimage', '-pix_fmt', 'yuv420p']

# Per-process state, filled by init() in the parent and in each spawned worker.
M = SLIDES = None
FPS, TOTAL, XF = 30, 1.0, 0.5   # placeholders until init()
_imgs = {}

def init(work):
    global M, SLIDES, FPS, TOTAL, XF
    M = json.load(open(os.path.join(work, 'manifest.json')))
    SLIDES, FPS, TOTAL, XF = M['slides'], M['fps'], M['total'], M['xfade']

def smooth(x):
    x = min(1.0, max(0.0, x)); return x * x * (3 - 2 * x)

def slide(i):
    if i not in _imgs: _imgs[i] = Image.open(SLIDES[i]['png']).convert('RGB')
    return _imgs[i]

def kenburns(i, t):
    """Sub-pixel slow push (alternating in/out) so text never shimmers."""
    s = SLIDES[i]
    p = (t - s['start']) / max(0.01, s['end'] - s['start'])
    amt = 0.05 if s['kind'] == 'title' else 0.025
    z = 1 + amt * (p if i % 2 == 0 else 1 - p)
    cx = W / 2 + (W * 0.012 * (p - 0.5) if s['kind'] == 'title' else 0)
    cy = H / 2
    a = 1 / z
    return slide(i).transform((W, H), Image.AFFINE, (a, 0, cx - a * W / 2, 0, a, cy - a * H / 2), resample=Image.BICUBIC)

def frame(n):
    t = n / FPS
    live = [i for i, s in enumerate(SLIDES) if s['start'] <= t < s['end'] + 1e-6] or [len(SLIDES) - 1]
    img = kenburns(live[0], t)
    if len(live) > 1:  # crossfade into the next slide
        nxt = live[1]
        img = Image.blend(img, kenburns(nxt, t), smooth((t - SLIDES[nxt]['start']) / XF))
    fade = min(smooth(t / 0.7), smooth((TOTAL - t) / 1.0))
    if fade < 1:
        img = Image.blend(Image.new('RGB', (W, H), PAPER), img, fade)
    return img.tobytes()

def encode_chunk(job):
    """One worker, one ffmpeg, one file. stderr goes to a file so no pipe can fill up."""
    k, a, b, path = job
    with open(path + '.log', 'w') as err:
        enc = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
                                '-r', str(FPS), '-i', '-', *X264, path], stdin=subprocess.PIPE, stderr=err)
        try:
            for n in range(a, b): enc.stdin.write(frame(n))
            enc.stdin.close()
            rc = enc.wait(timeout=120)
        except BaseException:
            enc.kill(); raise
    if rc: raise RuntimeError(f'chunk {k} encode failed: {open(path + ".log").read()[-800:]}')
    return k

def main():
    if len(sys.argv) < 2: raise SystemExit(__doc__)
    work = os.path.abspath(sys.argv[1])
    out = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(HERE, '..', 'assets', 'briefing-60s.mp4')
    init(work)

    # ---- video: parallel chunks, then a lossless join -----------------------
    nframes = int(round(TOTAL * FPS))
    cdir = os.path.join(work, 'chunks'); shutil.rmtree(cdir, ignore_errors=True); os.makedirs(cdir)
    jobs = [(k, a, min(a + CHUNK, nframes), os.path.join(cdir, f'c{k:03d}.mp4')) for k, a in enumerate(range(0, nframes, CHUNK))]
    procs = max(1, min(len(jobs), (os.cpu_count() or 4) - 1))
    print(f'  {nframes} frames in {len(jobs)} chunks on {procs} workers')
    with mp.get_context('spawn').Pool(procs, initializer=init, initargs=(work,)) as pool:
        res = pool.map_async(encode_chunk, jobs, chunksize=1)
        try:
            res.get(timeout=TIMEOUT)
        except mp.TimeoutError:
            pool.terminate(); raise SystemExit(f'frame render timed out after {TIMEOUT:.0f}s')
    lst = os.path.join(cdir, 'list.txt')
    with open(lst, 'w') as fh:
        for j in jobs: fh.write(f"file '{j[3]}'\n")
    silent = os.path.join(work, 'video_silent.mp4')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', silent],
                   check=True, timeout=120)
    shutil.rmtree(cdir, ignore_errors=True)

    # ---- audio: music ducked under the voice, two-pass loudnorm (mix.py) ----
    audio = os.path.join(work, 'mix_norm.wav')
    js = mix.duck_and_normalize(M['voice'], os.path.join(HERE, 'music.mp3'), TOTAL, audio)

    # ---- mux --------------------------------------------------------------------
    os.makedirs(os.path.dirname(out), exist_ok=True)
    mix.mux(silent, audio, out)
    print('wrote', out, f'| duration {mix.duration(out):.2f}s | pre-norm {js["input_i"]} LUFS')

if __name__ == '__main__':
    main()
