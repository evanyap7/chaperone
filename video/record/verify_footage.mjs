// Regenerate verification PNGs + text-px report from saved rects.json/manifest.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../work_footage');
const VERIFY = path.join(OUT, 'verify');
const EDIT_WIDTH = 1640, BODY_FONT_CSS = 16;
const rects = JSON.parse(fs.readFileSync(path.join(OUT, 'rects.json'), 'utf8'));
const notes = JSON.parse(fs.readFileSync(path.join(OUT, 'rects_notes.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
const DPR = rects.dpr;
fs.mkdirSync(VERIFY, { recursive: true });
const durOf = (c) => Number(JSON.parse(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','json',c]).toString()).format.duration);
const report = [];
for (const [beat, b] of Object.entries(rects.beats)) {
  const clip = path.join(OUT, beat + '.mp4');
  const [x0,y0,x1,y1] = b.content; const cw=x1-x0, ch=y1-y0;
  const scale = EDIT_WIDTH/cw; const textPx = BODY_FONT_CSS*DPR*scale;
  const at = b.measured_at_s;
  const full = path.join(VERIFY, `${beat}_full.png`);
  const crop = path.join(VERIFY, `${beat}_crop1640.png`);
  execFileSync('ffmpeg',['-y','-v','error','-ss',at.toFixed(3),'-i',clip,'-frames:v','1',full]);
  execFileSync('ffmpeg',['-y','-v','error','-ss',at.toFixed(3),'-i',clip,'-frames:v','1','-vf',`crop=${cw}:${ch}:${x0}:${y0},scale=${EDIT_WIDTH}:-2`,crop]);
  let overlayAt = at, targets = b.targets;
  if (beat==='s3-deny' && notes['s3-deny']?.pre_click) {
    const pre = notes['s3-deny'].pre_click;
    const speed = (manifest.clips.find(c=>c.beat===beat)||{}).speed_factor||1;
    overlayAt = Math.min(durOf(clip)-0.05, pre.real_offset_s/speed);
    targets = { rec_banner: pre.rec_banner, queue_card: pre.queue_card };
  }
  const colors=['red','lime','blue','yellow','magenta','cyan','orange'];
  const draw = Object.entries(targets).filter(([,r])=>r).map(([n,r],i)=>`drawbox=x=${r[0]}:y=${r[1]}:w=${r[2]-r[0]}:h=${r[3]-r[1]}:color=${colors[i%colors.length]}@0.9:thickness=4`).join(',');
  if (draw) {
    const src = path.join(VERIFY, `${beat}_overlay_src.png`);
    execFileSync('ffmpeg',['-y','-v','error','-ss',overlayAt.toFixed(3),'-i',clip,'-frames:v','1',src]);
    execFileSync('ffmpeg',['-y','-v','error','-i',src,'-vf',draw,path.join(VERIFY,`${beat}_rects.png`)]);
  }
  report.push({beat, content_width_device:cw, scale_to_1640:Number(scale.toFixed(4)), body_text_px_at_1640:Number(textPx.toFixed(2)), passes_28:textPx>=28});
  console.log(`${beat}: text=${textPx.toFixed(2)}px pass28=${textPx>=28} overlayAt=${overlayAt.toFixed(2)}`);
}
fs.writeFileSync(path.join(VERIFY,'text_px_report.json'), JSON.stringify(report,null,2));
