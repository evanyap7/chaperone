#!/usr/bin/env python3
"""Assemble the 60s briefing video: slides + narration + generated soundtrack."""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(HERE, 'work')
M = json.load(open(os.path.join(WORK, 'manifest.json')))
SEGS, PAD, TOTAL = M['segments'], M['pad'], M['total']
OUT = os.path.join(HERE, '..', 'assets', 'briefing-60s.mp4')
os.makedirs(os.path.dirname(OUT), exist_ok=True)

def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-2000:]); raise SystemExit(f'ffmpeg failed: {args[:4]}')

clips = []
for s in SEGS:
    clip = os.path.join(WORK, f'clip{s["i"]}.mp4')
    run(['ffmpeg', '-y', '-v', 'error', '-loop', '1', '-framerate', '30', '-i', s['slide'],
         '-i', s['audio'], '-filter_complex', f'[1:a]apad=pad_dur={PAD}[a]',
         '-map', '0:v', '-map', '[a]', '-t', f'{s["clip"]:.3f}',
         '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2', clip])
    clips.append(clip)
    print(f'clip{s["i"]}: {s["clip"]:.2f}s')

lst = os.path.join(WORK, 'concat.txt')
with open(lst, 'w') as f:
    for c in clips: f.write(f"file '{c}'\n")
joined = os.path.join(WORK, 'joined.mp4')
run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', joined])

run(['ffmpeg', '-y', '-v', 'error', '-i', joined, '-i', os.path.join(HERE, 'music.mp3'),
     '-filter_complex',
     f'[0:v]fade=t=in:st=0:d=0.6,fade=t=out:st={TOTAL-0.9:.2f}:d=0.9[v];'
     f'[1:a]volume=0.13,afade=t=in:st=0:d=2.5,afade=t=out:st={TOTAL-3:.2f}:d=3[m];'
     f'[0:a][m]amix=inputs=2:duration=first:normalize=0[a]',
     '-map', '[v]', '-map', '[a]', '-t', f'{TOTAL:.3f}',
     '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
     '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', OUT])
print('wrote', OUT)
d = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT], capture_output=True, text=True)
print('duration:', d.stdout.strip(), 's')