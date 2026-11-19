#!/usr/bin/env python3
"""Shared final mix for both videos: music bed ducked under the voice, then -16 LUFS.

  * the music sits at MUSIC_GAIN (0.16) between lines and is pushed down further while the
    voice speaks (sidechaincompress keyed on the voice, ratio 4, release 1100 ms), so it
    breathes gently instead of pumping back up in every gap;
  * the mix is loudness-normalised in two passes (measure, then apply linearly) to -16 LUFS
    integrated with a -3 dBTP ceiling, then hard-limited at -3 dBFS (alimiter 0.708);
  * AAC encodes at 320k (low bitrates add true-peak overshoot);
  * every mux is verified on the ENCODED file with ebur128=peak=true and the build FAILS
    (non-zero exit) if true peak is above -1.0 dBTP.

Public API (kept backward compatible with assemble.py / assemble_demo.py / build_demo.py):
  run(args), duration(path), duck_and_normalize(voice, music, total, out_wav, ...),
  mux(video, audio, out), LUFS. New: verify_loudness(path) -> {'i','lra','tp'}.
"""
import json, re, subprocess

LUFS = -16.0
TP = -3.0            # loudnorm ceiling; leaves headroom for AAC overshoot
TP_FAIL = -1.0       # build fails above this true peak, measured on the encoded file
MUSIC_GAIN = 0.16    # ~ -26 LUFS bed between lines; gentle duck under speech
LIMITER = 0.708      # ~ -3 dBFS

def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[-2500:]); raise SystemExit(f'ffmpeg failed: {" ".join(args[:6])}')
    return r

def duration(path):
    return float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).stdout.strip())

def duck_and_normalize(voice_wav, music, total, out_wav, music_gain=MUSIC_GAIN, fade_out=3.2):
    """voice_wav: full-length voice track. Writes a 48 kHz stereo 24-bit wav at -16 LUFS,
    limited at -3 dBFS. Returns the first-pass loudnorm measurement dict."""
    graph = (f'[1:a]atrim=0:{total:.3f},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,'
             f'volume={music_gain},afade=t=in:st=0:d=2.0,afade=t=out:st={max(0, total - fade_out):.3f}:d={fade_out}[m];'
             f'[0:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur={total:.3f},asplit=2[v1][v2];'
             f'[m][v1]sidechaincompress=threshold=0.03:ratio=4:attack=40:release=1100:knee=8[duck];'
             f'[v2][duck]amix=inputs=2:normalize=0:duration=first')
    raw = out_wav + '.pre.wav'
    run(['ffmpeg', '-y', '-v', 'error', '-i', voice_wav, '-stream_loop', '-1', '-i', music, '-filter_complex', graph,
         '-t', f'{total:.3f}', '-ar', '48000', '-c:a', 'pcm_s24le', raw])
    meas = run(['ffmpeg', '-hide_banner', '-i', raw, '-af', f'loudnorm=I={LUFS}:TP={TP}:LRA=11:print_format=json', '-f', 'null', '-'])
    js = json.loads(re.search(r'\{[^{}]*"input_i"[^{}]*\}', meas.stderr).group(0))
    ln = (f'loudnorm=I={LUFS}:TP={TP}:LRA=11:measured_I={js["input_i"]}:measured_TP={js["input_tp"]}:'
          f'measured_LRA={js["input_lra"]}:measured_thresh={js["input_thresh"]}:offset={js["target_offset"]}:linear=true')
    run(['ffmpeg', '-y', '-v', 'error', '-i', raw,
         '-af', ln + f',alimiter=limit={LIMITER}:attack=5:release=50:level=false,aresample=48000',
         '-c:a', 'pcm_s24le', out_wav])
    return js

def verify_loudness(path):
    """Measure the ENCODED file with ebur128=peak=true. Returns {'i','lra','tp'}.
    Fails the build (SystemExit 1) if true peak > -1.0 dBTP."""
    r = run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'])
    summary = r.stderr.split('Summary:')[-1]
    def grab(pat):
        m = re.search(pat, summary)
        if not m:
            print(r.stderr[-2500:]); raise SystemExit(f'could not parse ebur128 summary for {path}')
        return float(m.group(1))
    i = grab(r'I:\s*(-?[\d.]+)\s*LUFS')
    lra = grab(r'LRA:\s*(-?[\d.]+)\s*LU')
    tp = grab(r'Peak:\s*(-?[\d.]+)\s*dBFS')
    print(f'  loudness: I {i:.1f} LUFS | LRA {lra:.1f} LU | true peak {tp:.1f} dBTP')
    if tp > TP_FAIL:
        raise SystemExit(f'BUILD FAILED: true peak {tp:.2f} dBTP > {TP_FAIL} dBTP on {path}')
    return {'i': i, 'lra': lra, 'tp': tp}

def mux(video, audio, out):
    run(['ffmpeg', '-y', '-v', 'error', '-i', video, '-i', audio, '-map', '0:v', '-map', '1:a',
         '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out])
    return verify_loudness(out)