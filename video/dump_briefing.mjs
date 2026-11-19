// Dump a deterministic briefing (fresh engine run) for the video pipeline.
// Usage: node video/dump_briefing.mjs <work-dir>/briefing.json
import fs from 'node:fs';
import { Chaperone } from '../src/chaperone.js';
import { Store } from '../src/store.js';
import { runScenario } from '../src/runner.js';
import { loadScenarioDefs } from '../src/scenarios.js';
import { buildBriefing } from '../src/briefing.js';

const store = new Store('video_run.jsonl');
const chaperone = new Chaperone(store);
for (const def of loadScenarioDefs()) runScenario(chaperone, def.id);
const briefing = buildBriefing(store);
fs.writeFileSync(process.argv[2], JSON.stringify(briefing, null, 2));
console.log('segments:', briefing.narration_segments.length, '| words:', briefing.narration.split(/\s+/).length);