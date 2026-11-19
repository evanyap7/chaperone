// Chaperone HTTP app. One engine, one channel: every worker action is a
// POST /api/gate. The UI watches via SSE. "Run demo" replays the exact scripted
// action streams of the worker agents through this same live gate.
//
// createApp() builds the server without listening, so tests can start it on a
// random port; src/server.js is the process entry point.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { GateInputError } from './chaperone.js';
import { runScenarioLive } from './runner.js';
import { loadScenarioDefs } from './scenarios.js';
import { buildBriefing } from './briefing.js';
import { scoreRun } from './score.js';
import { ROOT, OWNER_FIRST_NAME } from './config.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.vtt': 'text/vtt; charset=utf-8',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff': 'font/woff', '.woff2': 'font/woff2', '.pdf': 'application/pdf',
};
// Pages and code revalidate every load (cheap with ETag); media may be cached briefly.
const REVALIDATE = new Set(['.html', '.js', '.mjs', '.css', '.json']);

class HttpError extends Error {
  constructor(status, message, headers = {}) { super(message); this.status = status; this.headers = headers; }
}

const DECIDE_STATUS = { invalid: 400, not_found: 404, never: 403, already_decided: 409 };

export function createApp({
  store, chaperone,
  demoDelayMs = 600,
  heartbeatMs = 25000,
  maxBodyBytes = 1_000_000,
  webDir = path.join(ROOT, 'web'),
  assetsDir = path.join(ROOT, 'assets'),
  log = console,
} = {}) {
  let demoRunning = false;
  let demoPromise = null;

  // ---- SSE ----------------------------------------------------------------
  const sseClients = new Set();
  function broadcast(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
      try { res.write(msg); } catch { sseClients.delete(res); }
    }
  }
  const listeners = {
    action: (e) => broadcast('action', e),
    queue: (q) => broadcast('queue', q),
    scorecard: (r) => broadcast('scorecard', r),
    reset: () => broadcast('reset', {}),
    briefing: (b) => broadcast('briefing', b),
  };
  for (const [ev, fn] of Object.entries(listeners)) store.on(ev, fn);
  // A comment line every heartbeatMs keeps proxies from closing idle streams.
  const heartbeat = setInterval(() => {
    for (const res of sseClients) { try { res.write(': ping\n\n'); } catch { sseClients.delete(res); } }
  }, heartbeatMs);
  heartbeat.unref();

  // ---- demo replay --------------------------------------------------------
  async function runDemo() {
    store.reset();
    chaperone.reset();
    broadcast('demo', { running: true });
    const results = [];
    let error = null;
    try {
      for (const def of loadScenarioDefs()) {
        broadcast('scenario', { id: def.id, name: def.name, status: 'running' });
        const entries = await runScenarioLive(chaperone, def.id, { delayMs: demoDelayMs });
        const result = scoreRun(def, entries, store.queue);
        results.push(result);
        store.setScenarioResults([...results]);
        broadcast('scenario', { id: def.id, name: def.name, status: 'done', points: result.points });
      }
      store.briefing = buildBriefing(store);
      store.emit('briefing', store.briefing);
    } catch (e) {
      error = String(e?.message || e);
      log.error(`demo failed: ${e?.stack || e}`);
    } finally {
      demoRunning = false;
      broadcast('demo', { running: false, ...(error ? { error } : {}) });
    }
    return { ok: !error, results, error };
  }
  function startDemo() {
    if (demoRunning) return false;
    demoRunning = true; // set synchronously: two clicks can never start two runs
    demoPromise = runDemo();
    return true;
  }

  // ---- helpers ------------------------------------------------------------
  function json(res, code, obj, headers = {}) {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
    });
    res.end(body);
  }

  // Writes from another site are refused. A browser always sends Origin on a
  // cross-origin POST, so a page elsewhere cannot approve a held item for you.
  function guardWrite(req) {
    const origin = req.headers.origin;
    if (!origin) return; // same-origin fetch from older browsers, curl, tests
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    const fwd = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    if (!host || (host !== req.headers.host && host !== fwd)) throw new HttpError(403, 'cross-origin writes are not allowed');
  }

  function readJsonBody(req) {
    const declared0 = Number(req.headers['content-length']);
    const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if ((declared0 > 0 || req.headers['transfer-encoding']) && ctype !== 'application/json') {
      return Promise.reject(new HttpError(415, 'body must be sent as application/json'));
    }
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBodyBytes) {
        return reject(new HttpError(413, `body larger than ${maxBodyBytes} bytes`));
      }
      const chunks = [];
      let size = 0;
      let failed = false;
      req.on('data', (c) => {
        if (failed) return;
        size += c.length;
        if (size > maxBodyBytes) { failed = true; chunks.length = 0; reject(new HttpError(413, `body larger than ${maxBodyBytes} bytes`)); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (failed) return;
        const text = Buffer.concat(chunks).toString('utf8').trim();
        if (!text) return resolve({});
        let body;
        try { body = JSON.parse(text); } catch { return reject(new HttpError(400, 'body is not valid JSON')); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return reject(new HttpError(400, 'body must be a JSON object'));
        resolve(body);
      });
      req.on('error', reject);
    });
  }

  function lineageSnapshot() {
    return [...chaperone.lineage.nodes.values()].map((n) => ({
      id: n.id, kind: n.kind, level: n.level, unannounced: !!n.unannounced, derived_from: n.derived_from,
    }));
  }

  // Parse a single "bytes=a-b" range. Returns {start,end}, null (ignore, send
  // whole file) or 'unsatisfiable'.
  function parseRange(header, size) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
    if (!m || (m[1] === '' && m[2] === '')) return null; // multi-range or malformed: serve the whole file
    let start; let end;
    if (m[1] === '') { // suffix: last N bytes
      const n = Number(m[2]);
      if (n === 0) return 'unsatisfiable';
      start = Math.max(0, size - n); end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
      if (start >= size || start > end) return 'unsatisfiable';
    }
    return { start, end };
  }

  function serveStatic(req, res, base, urlPath) {
    let rel;
    try { rel = decodeURIComponent(urlPath); } catch { throw new HttpError(400, 'malformed URL'); }
    if (rel.includes('\0')) throw new HttpError(400, 'malformed URL');
    const file = path.resolve(base, `.${path.posix.sep}${rel.replace(/^\/+/, '')}`);
    const inside = path.relative(base, file);
    if (inside.startsWith('..') || path.isAbsolute(inside)) throw new HttpError(403, 'forbidden');
    // Dotfiles (.DS_Store, .env) are never served.
    if (inside.split(path.sep).some((seg) => seg.startsWith('.'))) throw new HttpError(404, 'not found');
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return json(res, 404, { error: 'not found' });
      const ext = path.extname(file).toLowerCase();
      const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': REVALIDATE.has(ext) ? 'no-cache' : 'public, max-age=300',
        ETag: etag, 'Last-Modified': st.mtime.toUTCString(),
        'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
      };
      const inm = req.headers['if-none-match'];
      const ims = req.headers['if-modified-since'];
      if ((inm && inm.split(',').map((s) => s.trim()).includes(etag))
        || (!inm && ims && Math.floor(st.mtimeMs / 1000) <= Math.floor(Date.parse(ims) / 1000))) {
        res.writeHead(304, headers);
        return res.end();
      }
      let status = 200;
      let start = 0;
      let end = st.size - 1;
      const ifRange = req.headers['if-range'];
      if (req.headers.range && (!ifRange || ifRange === etag)) {
        const r = parseRange(req.headers.range, st.size);
        if (r === 'unsatisfiable') {
          res.writeHead(416, { ...headers, 'Content-Range': `bytes */${st.size}`, 'Content-Length': 0 });
          return res.end();
        }
        if (r) { status = 206; ({ start, end } = r); headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`; }
      }
      headers['Content-Length'] = st.size === 0 ? 0 : end - start + 1;
      res.writeHead(status, headers);
      if (req.method === 'HEAD' || st.size === 0) return res.end();
      const stream = fs.createReadStream(file, { start, end });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    });
  }

  function openEvents(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    if (req.method === 'HEAD') return res.end();
    res.write('retry: 2000\n\n');
    res.write('event: hello\ndata: {}\n\n');
    sseClients.add(res);
    const drop = () => sseClients.delete(res);
    res.on('close', drop);
    res.on('error', drop);
  }

  // ---- routes -------------------------------------------------------------
  const routes = {
    '/api/events': { GET: openEvents },
    '/api/state': {
      GET: (req, res) => json(res, 200, {
        log: store.log, queue: store.queue, scenarioResults: store.scenarioResults,
        classifierReport: store.classifierReport, briefing: store.briefing,
        lineage: lineageSnapshot(), demoRunning,
      }),
    },
    '/api/gate': {
      POST: async (req, res) => {
        const body = await readJsonBody(req);
        try {
          return json(res, 200, chaperone.gate(body));
        } catch (e) {
          if (e instanceof GateInputError) throw new HttpError(400, e.message);
          throw e;
        }
      },
    },
    '/api/demo/run': {
      POST: (req, res) => {
        if (!startDemo()) return json(res, 409, { error: 'demo already running' });
        return json(res, 202, { ok: true, scenarios: loadScenarioDefs().map((d) => d.id) });
      },
    },
    '/api/queue/decide': {
      POST: async (req, res) => {
        const { queue_id, decision } = await readJsonBody(req);
        if (typeof queue_id !== 'string' || !queue_id) return json(res, 400, { ok: false, code: 'invalid', error: 'queue_id is required' });
        const out = store.decide(queue_id, decision, OWNER_FIRST_NAME || 'owner');
        return json(res, out.ok ? 200 : (DECIDE_STATUS[out.code] || 400), out);
      },
    },
    '/api/briefing': { GET: (req, res) => json(res, 200, store.briefing || buildBriefing(store)) },
    '/api/lineage': { GET: (req, res) => json(res, 200, lineageSnapshot()) },
    '/api/health': {
      GET: (req, res) => json(res, 200, {
        ok: true, demoRunning, actions: store.log.length, queue: store.queue.length,
        sse_clients: sseClients.size, uptime_s: Math.round(process.uptime()),
      }),
    },
  };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    const route = routes[p];
    if (route) {
      const fn = route[method];
      if (!fn) {
        const allow = Object.keys(route).flatMap((m) => (m === 'GET' ? ['GET', 'HEAD'] : [m])).join(', ');
        throw new HttpError(405, `method ${req.method} not allowed`, { Allow: allow });
      }
      if (method === 'POST') guardWrite(req);
      return fn(req, res);
    }
    if (p === '/api' || p.startsWith('/api/')) throw new HttpError(404, 'unknown API endpoint');
    if (method !== 'GET') throw new HttpError(405, `method ${req.method} not allowed`, { Allow: 'GET, HEAD' });
    if (p.startsWith('/assets/')) return serveStatic(req, res, assetsDir, p.slice('/assets/'.length));
    if (p === '/' || p === '/index.html') return serveStatic(req, res, webDir, 'index.html');
    return serveStatic(req, res, webDir, p);
  }

  const server = http.createServer((req, res) => {
    Promise.resolve()
      .then(() => handle(req, res))
      .catch((e) => {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) log.error(`${req.method} ${req.url}: ${e?.stack || e}`);
        if (res.headersSent) { res.destroy(); return; }
        const headers = { ...(e.headers || {}) };
        if (status === 413) {
          // Answer, then drain (discard) the rest of the upload so the client
          // can read the 413; a client that keeps sending is cut off after 2s.
          headers.Connection = 'close';
          req.resume();
          res.on('finish', () => setTimeout(() => req.destroy(), 2000).unref());
        }
        json(res, status, { ok: false, error: status === 500 ? 'internal error' : e.message }, headers);
      });
  });
  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });
  server.on('close', () => {
    clearInterval(heartbeat);
    for (const [ev, fn] of Object.entries(listeners)) store.off(ev, fn);
    for (const res of sseClients) { try { res.end(); } catch { /* gone */ } }
    sseClients.clear();
  });
  // Close idle SSE streams so server.close() can finish.
  const origClose = server.close.bind(server);
  server.close = (cb) => {
    for (const res of sseClients) { try { res.end(); } catch { /* gone */ } }
    sseClients.clear();
    server.closeIdleConnections?.();
    return origClose(cb);
  };

  return {
    server, broadcast,
    startDemo,
    get demoRunning() { return demoRunning; },
    get demoPromise() { return demoPromise; },
    get sseClientCount() { return sseClients.size; },
  };
}
