import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.resolve(HERE, '../work_footage');
const PORT = 8150;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'footage-token';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('node', ['src/server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), OWNER_TOKEN: TOKEN },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

async function health() {
  const r = await fetch(`${BASE}/api/health`);
  return r.json();
}

try {
  let up = false;
  for (let i = 0; i < 60; i++) {
    try { const h = await health(); if (h.ok) { up = true; break; } } catch {}
    await sleep(250);
  }
  if (!up) throw new Error('server did not start:\n' + serverLog);
  console.log('server up:', JSON.stringify(await health()));

  const t0 = Date.now();
  const run = await fetch(`${BASE}/api/demo/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  });
  console.log('demo start:', run.status, JSON.stringify(await run.json()));
  let h;
  do { await sleep(300); h = await health(); } while (h.demoRunning);
  console.log('demo wall time:', ((Date.now() - t0) / 1000).toFixed(2), 's; health:', JSON.stringify(h));

  const st = await (await fetch(`${BASE}/api/state`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'probe_state.json'), JSON.stringify(st, null, 2));
  console.log('log entries:', st.log.length, 'queue:', st.queue.length);
  for (const q of st.queue) {
    console.log(`QUEUE ${q.queue_id} [${q.status}] ${q.agent} rec=${q.recommendation} money=${q.money_at_stake} :: ${q.summary}`);
  }
  for (const e of st.log) {
    console.log(`LOG #${e.id} ${e.scenario} ${e.agent} ${e.action} -> ${e.decision} :: ${e.owner_line}`);
  }
  console.log('briefing lead:', st.briefing && st.briefing.text ? st.briefing.text.split('\n').slice(0, 4).join(' | ') : '(none)');
  console.log('results:', st.scenarioResults.map((r) => `${r.id}:${r.points}/${r.max}`).join(' '));
  console.log('classifier:', JSON.stringify(st.classifierReport && { correct: st.classifierReport.correct, total: st.classifierReport.total }));
} finally {
  server.kill('SIGTERM');
  await sleep(600);
  if (server.exitCode === null) server.kill('SIGKILL');
  fs.writeFileSync(path.join(OUT, 'probe_server.log'), serverLog);
  console.log('server killed, exit code:', server.exitCode);
}