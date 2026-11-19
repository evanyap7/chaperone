#!/usr/bin/env python3
"""Shared final mix for both videos: music bed ducked under the voice, then -16 LUFS.

  * the music sits at MUSIC_GAIN between lines and is pushed down further while the voice
    speaks (sidechaincompress keyed on the voice), so it breathes instead of sitting flat;
  * the mix is loudness-normalised in two passes (measure, then apply linearly) to -16 LUFS
    integrated, true peak at most -1.5 dBTP after AAC, which suits web/social playback.
"""
import json, re, subprocess

LUFS, TP = -16.0, -2.0   # aim 0.5 dB under the -1.5 dBTP ceiling: AAC encoding adds ~0.1-0.4 dB of overshoot
MUSIC_GAIN = 0.30   # ~ -26 LUFS bed between lines; ~10 dB lower under speech

def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[-2500:]); raise SystemExit(f'ffmpeg failed: {" ".join(args[:6])}')
    return r

def duration(path):
    return float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).stdout.strip())

def duck_and_normalize(voice_wav, music, total, out_wav, music_gain=MUSIC_GAIN, fade_out=3.2):
    """voice_wav: full-length voice track. Writes a 48 kHz stereo 24-bit wav at -16 LUFS. Returns loudnorm stats."""
    graph = (f'[1:a]atrim=0:{total:.3f},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,'
             f'volume={music_gain},afade=t=in:st=0:d=2.0,afade=t=out:st={max(0, total - fade_out):.3f}:d={fade_out}[m];'
             f'[0:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur={total:.3f},asplit=2[v1][v2];'
             f'[m][v1]sidechaincompress=threshold=0.025:ratio=8:attack=25:release=550:knee=6[duck];'
             f'[v2][duck]amix=inputs=2:normalize=0:duration=first')
    raw = out_wav + '.pre.wav'
    run(['ffmpeg', '-y', '-v', 'error', '-i', voice_wav, '-stream_loop', '-1', '-i', music, '-filter_complex', graph,
         '-t', f'{total:.3f}', '-ar', '48000', '-c:a', 'pcm_s24le', raw])
    meas = run(['ffmpeg', '-hide_banner', '-i', raw, '-af', f'loudnorm=I={LUFS}:TP={TP}:LRA=11:print_format=json', '-f', 'null', '-'])
    js = json.loads(re.search(r'\{[^{}]*"input_i"[^{}]*\}', meas.stderr).group(0))
    ln = (f'loudnorm=I={LUFS}:TP={TP}:LRA=11:measured_I={js["input_i"]}:measured_TP={js["input_tp"]}:'
          f'measured_LRA={js["input_lra"]}:measured_thresh={js["input_thresh"]}:offset={js["target_offset"]}:linear=true')
    run(['ffmpeg', '-y', '-v', 'error', '-i', raw, '-af', ln + ',aresample=48000', '-c:a', 'pcm_s24le', out_wav])
    return js

def mux(video, audio, out):
    run(['ffmpeg', '-y', '-v', 'error', '-i', video, '-i', audio, '-map', '0:v', '-map', '1:a',
         '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out])
