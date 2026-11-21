#!/usr/bin/env python3
"""Shared final mix for both videos: music bed ducked under the voice, then -16 LUFS.

  * the music sits at MUSIC_GAIN (0.16) between lines and is pushed down further while the
    voice speaks (sidechaincompress keyed on the voice, ratio 4, release 1100 ms), so it
    breathes gently instead of pumping back up in every gap;
  * the mix is loudness-normalised in two passes (measure, then apply linearly) to -16 LUFS
    integrated with a -3 dBTP ceiling, then hard-limited at -3 dBFS (alimiter 0.708);
  * on the 174 s demo timeline the bed gets a post-duck swell through the 160-164 s
    narration pause (no energy collapse before the CTA) plus subtle proof/CTA lifts
    (bed_lift_expr), and the music fade-out is end-synced (0.5 s fade landing exactly
    at picture end, 174.0 s); other timelines keep the constant bed;
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

def bed_lift_expr(total):
    """Demo-timeline music-bed automation (red-team P1-3 / P2-10).

    The 160.0-164.4 s narration pause before the CTA used to read as an energy
    collapse (momentary -23...-30 LUFS): the bed was at its normal between-lines
    level but the voice was gone for 4.4 s. Swell the bed ~+8 dB through that
    bridge (overshooting the compressor release tail) so momentary stays
    >= -20 LUFS, then hand over to a gentle +1.7 dB
    CTA lift; a +1.4 dB lift opens up the proof section (~108-123 s). Smooth
    0.6-1.5 s ramps, applied to the bed AFTER the sidechain duck so the swell
    cannot be collapsed by the compressor release during the pause.

    Returns an ffmpeg volume expression (multiplier on top of MUSIC_GAIN), or
    None for non-demo timelines so other builds keep the constant bed.
    """
    if not 173.0 <= total <= 175.0:
        return None
    return ('1'
            '+0.18*clip((t-108)/1.5,0,1)*clip((123.5-t)/1.5,0,1)'
            '+1.60*clip((t-159.7)/0.7,0,1)*clip((164.2-t)/0.6,0,1)'
            '+0.22*clip((t-164.2)/0.8,0,1)')

def duck_and_normalize(voice_wav, music, total, out_wav, music_gain=MUSIC_GAIN, fade_out=3.2,
                       lift_expr=None):
    """voice_wav: full-length voice track. Writes a 48 kHz stereo 24-bit wav at -16 LUFS,
    limited at -3 dBFS. Returns the first-pass loudnorm measurement dict.
    lift_expr: optional ffmpeg volume expression automating the bed (see bed_lift_expr);
    defaults to the demo-timeline swell/lifts when total matches the 174 s demo.
    On the 174 s demo timeline the music fade-out is end-synced: the bed holds at
    its CTA level until total-0.5 s, then a 0.5 s fade lands exactly AT picture
    end (174.0 s) — the old 3.2 s fade was inaudible ~1.9 s before the last frame."""
    if lift_expr is None:
        lift_expr = bed_lift_expr(total)
    if 173.0 <= total <= 175.0:
        fade_out = 0.5
    lift = f'[duck]volume=\'{lift_expr}\':eval=frame[bed];' if lift_expr else '[duck]anull[bed];'
    graph = (f'[1:a]atrim=0:{total:.3f},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,'
             f'volume={music_gain},afade=t=in:st=0:d=2.0,afade=t=out:st={max(0, total - fade_out):.3f}:d={fade_out}[m];'
             f'[0:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur={total:.3f},asplit=2[v1][v2];'
             f'[m][v1]sidechaincompress=threshold=0.03:ratio=4:attack=40:release=1100:knee=8[duck];'
             f'{lift}'
             f'[v2][bed]amix=inputs=2:normalize=0:duration=first')
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