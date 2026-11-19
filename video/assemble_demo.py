#!/usr/bin/env python3
"""Assemble the live-demo video: title card + Playwright recording + end card + soundtrack.
Usage: python3 video/assemble_demo.py <work-dir>   (work-dir holds the recorded page@*.webm)
"""
import glob, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.abspath(sys.argv[1])
OUT = os.path.join(HERE, '..', 'assets', 'demo-video.mp4')

def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-2000:]); raise SystemExit(f'ffmpeg failed: {args[:4]}')

def dur(p):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], capture_output=True, text=True)
    return float(r.stdout.strip())

webm = sorted(glob.glob(os.path.join(WORK, 'page@*.webm')), key=os.path.getmtime)[-1]
rec = os.path.join(WORK, 'drec.mp4')
run(['ffmpeg', '-y', '-v', 'error', '-i', webm, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
     '-vf', 'scale=1600:900,fps=30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
     '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', rec])

cards = []
for name, png, secs in [('dtitle', 'demo_title.png', 3.5), ('dend', 'demo_end.png', 4.5)]:
    mp4 = os.path.join(WORK, name + '.mp4')
    run(['ffmpeg', '-y', '-v', 'error', '-loop', '1', '-framerate', '30', '-i', os.path.join(HERE, png),
         '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', str(secs),
         '-vf', 'scale=1600:900', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
         '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', mp4])
    cards.append(mp4)

lst = os.path.join(WORK, 'dconcat.txt')
with open(lst, 'w') as f:
    for c in [cards[0], rec, cards[1]]: f.write(f"file '{c}'\n")
joined = os.path.join(WORK, 'djoined.mp4')
run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', joined])

total = dur(joined)
run(['ffmpeg', '-y', '-v', 'error', '-i', joined, '-i', os.path.join(HERE, 'music.mp3'),
     '-filter_complex',
     f'[1:a]atrim=0:{total},volume=0.14,afade=t=out:st={total-2:.2f}:d=2[a]',
     '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-shortest',
     '-movflags', '+faststart', OUT])
print('wrote', OUT, '| duration:', f'{dur(OUT):.2f}s')