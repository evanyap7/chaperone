// Chaperone live service. One engine, one channel: every worker action is a
// POST /api/gate. The UI watches via SSE. "Run demo" replays the exact scripted
// action streams of the five worker agents through this same live gate.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Chaperone } from './chaperone.js';
import { store } from './store.js';
import { runScenarioLive } from './runner.js';
import { loadScenarioDefs } from './scenarios.js';
import { buildBriefing } from './briefing.js';
import { scoreRun } from './score.js';
import { ROOT, REPORTS_DIR } from './config.js';

const PORT = Number(process.env.PORT || 8081);
const WEB_DIR = path.join(ROOT, 'web');
const ASSETS_DIR = path.join(ROOT, 'assets');

const chaperone = new Chaperone(store);
let demoRunning = false;

// Classifier report from the scored test run (honest, pre-computed).
try {
  store.classifierReport = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, 'classifier_score.json'), 'utf8'));
} catch { store.classifierReport = null; }

// ---- SSE ------------------------------------------------------------------
const sseClients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) { try { res.write(msg); } catch { /* drop */ } }
}
store.on('action', (e) => broadcast('action', e));
store.on('queue', (q) => broadcast('queue', q));
store.on('scorecard', (r) => broadcast('scorecard', r));
store.on('reset', () => broadcast('reset', {}));
store.on('briefing', (b) => broadcast('briefing', b));

// ---- demo replay ----------------------------------------------------------
async function runDemo() {
  if (demoRunning) return false;
  demoRunning = true;
  store.reset();
  chaperone.reset();
  broadcast('demo', { running: true });
  const defs = loadScenarioDefs();
  const results = [];
  try {
    for (const def of defs) {
      broadcast('scenario', { id: def.id, name: def.name, status: 'running' });
      const entries = await runScenarioLive(chaperone, def.id, { delayMs: 600 });
      const result = scoreRun(def, entries, store.queue);
      results.push(result);
      store.setScenarioResults([...results]);
      broadcast('scenario', { id: def.id, name: def.name, status: 'done', points: result.points });
    }
    store.briefing = buildBriefing(store);
    store.emit('briefing', store.briefing);
  } finally {
    demoRunning = false;
    broadcast('demo', { running: false });
  }
  return true;
}

// ---- helpers --------------------------------------------------------------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };

function serveStatic(res, base, rel) {
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(base, safe);
  if (!file.startsWith(base)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

function lineageSnapshot() {
  return [...chaperone.lineage.nodes.values()].map((n) => ({
    id: n.id, kind: n.kind, level: n.level, unannounced: !!n.unannounced, derived_from: n.derived_from,
  }));
}

// ---- router ---------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  try {
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: hello\ndata: {}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (p === '/api/state') {
      return json(res, 200, {
        log: store.log, queue: store.queue, scenarioResults: store.scenarioResults,
        classifierReport: store.classifierReport, briefing: store.briefing,
        lineage: lineageSnapshot(), demoRunning,
      });
    }
    if (p === '/api/gate' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.agent || !body.action) return json(res, 400, { error: 'agent and action are required' });
      const entry = chaperone.gate(body);
      return json(res, 200, entry);
    }
    if (p === '/api/demo/run' && req.method === 'POST') {
      if (demoRunning) return json(res, 409, { error: 'demo already running' });
      runDemo(); // async; UI follows via SSE
      return json(res, 202, { ok: true, scenarios: loadScenarioDefs().map((d) => d.id) });
    }
    if (p === '/api/queue/decide' && req.method === 'POST') {
      const { queue_id, decision } = await readBody(req);
      const out = store.decide(queue_id, decision === 'approve' ? 'approve' : 'deny', 'Mei');
      return json(res, out.ok ? 200 : 400, out);
    }
    if (p === '/api/briefing') {
      return json(res, 200, store.briefing || buildBriefing(store));
    }
    if (p === '/api/lineage') return json(res, 200, lineageSnapshot());
    if (p === '/api/health') return json(res, 200, { ok: true, demoRunning, actions: store.log.length });
    if (p.startsWith('/assets/')) return serveStatic(res, ASSETS_DIR, p.slice('/assets/'.length));
    if (p === '/' || p === '/index.html') return serveStatic(res, WEB_DIR, 'index.html');
    return serveStatic(res, WEB_DIR, p);
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Chaperone live on http://localhost:${PORT}`);
});