// Chaperone HTTP app. One engine, one channel: every worker action is a
// POST /api/gate (owner-authenticated). The UI watches via SSE. "Run demo"
// replays the exact scripted action streams of the worker agents through a
// separate sandbox engine.
//
// Two contexts: REAL (the injected store + chaperone) and DEMO (an in-memory
// sandbox). Only the owner — signed in via /?owner=<token> or a Bearer token —
// ever sees real state. Every visitor gets the read-only demo sandbox; demo
// runs and visitor decisions never touch the real log, queue or ledger.
//
// createApp() builds the server without listening, so tests can start it on a
// random port; src/server.js is the process entry point.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { Chaperone, GateInputError } from './chaperone.js';
import { Store } from './store.js';
import { createHookHandler } from '../integrations/qwenwork/hook-handler.js';
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
// Pages and code revalidate every load (cheap with ETag). Fonts are immutable
// and versioned (?v=ASSET_V in the CSS/HTML); other media may be cached a day.
const REVALIDATE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.vtt']);
const IMMUTABLE = new Set(['.woff2', '.woff']);
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.vtt']);
const ASSET_V = '2'; // bump when a self-hosted font/asset changes (cache-busts immutable URLs)
const BROTLI_OPTS = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } };

// Negotiate the best text encoding the client accepts. Identity for media/ranges.
function negotiateEncoding(req) {
  const ae = String(req.headers['accept-encoding'] || '');
  if (/(^|[\s,])br([\s,;]|$)/.test(ae)) return 'br';
  if (/(^|[\s,])gzip([\s,;]|$)/.test(ae)) return 'gzip';
  return null;
}
function compressBuffer(buf, enc) {
  return enc === 'br' ? zlib.brotliCompressSync(buf, BROTLI_OPTS) : zlib.gzipSync(buf, { level: 6 });
}

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
  ownerToken = process.env.OWNER_TOKEN || crypto.randomBytes(24).toString('hex'),
} = {}) {
  let demoRunning = false;
  let demoPromise = null;
  let demoSeq = 0;
  const hook = createHookHandler({ chaperone, store });

  // The demo sandbox: a completely separate in-memory engine. Visitors only
  // ever see or touch this context; each demo run resets it and replays the
  // scripted scenarios. The real log, queue and payment ledger are untouched.
  const demoStore = new Store(null);
  const demoChaperone = new Chaperone(demoStore);

  // Append-only demo history: every finished run is archived here (newest first)
  // before the sandbox resets for the next one, so "every run is kept" is true.
  // Visitors can browse any earlier run read-only; decisions are never erased.
  const demoHistory = [];
  const HISTORY_CAP = 12;
  const isActionEntry = (e) => e && e.kind !== 'owner_decision';
  function archiveDemoRun() {
    if (!demoStore.log.length) return;
    const results = demoStore.scenarioResults || [];
    demoHistory.unshift({
      run_id: demoStore.lastRunId,
      ended_at: new Date().toISOString(),
      log: demoStore.log,
      queue: demoStore.queue,
      scenarioResults: results,
      log_chain: demoStore.verifyChain(),
      points: results.reduce((a, r) => a + (r.points || 0), 0),
      max: results.reduce((a, r) => a + (r.max || 0), 0),
    });
    if (demoHistory.length > HISTORY_CAP) demoHistory.length = HISTORY_CAP;
  }
  const historySummaries = () => demoHistory.map((h) => ({
    run_id: h.run_id, ended_at: h.ended_at,
    actions: h.log.filter(isActionEntry).length,
    decided: h.queue.filter((q) => q.status !== 'pending').length,
    points: h.points, max: h.max,
  }));
  const decidedHistory = () => demoHistory.flatMap((h) =>
    h.queue.filter((q) => q.status !== 'pending').map((q) => ({ ...q, run_id: h.run_id })));

  // ---- owner authentication -------------------------------------------------
  // The owner signs in by visiting /?owner=<token> (printed at startup or set
  // via OWNER_TOKEN); a valid token is handed to the browser as an httpOnly
  // SameSite=Strict cookie and the URL is redirected clean. Plain GET / never
  // sets a cookie: visitors get the demo sandbox, not owner powers. Worker
  // agents authenticate to /api/gate with a Bearer token (the owner token).
  const tokenBuf = Buffer.from(ownerToken);
  function tokenFrom(req) {
    const auth = String(req.headers.authorization || '');
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
    const m = String(req.headers.cookie || '').match(/(?:^|;\s*)chaperone_owner=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function tokenMatches(t) {
    if (typeof t !== 'string') return false;
    const b = Buffer.from(t);
    return b.length === tokenBuf.length && crypto.timingSafeEqual(b, tokenBuf);
  }
  function isOwner(req) {
    return tokenMatches(tokenFrom(req));
  }
  function requireOwner(req) {
    if (!isOwner(req)) throw new HttpError(401, 'owner authentication required');
  }
  function ownerCookie(req) {
    const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? '; Secure' : '';
    return `chaperone_owner=${ownerToken}; Path=/; HttpOnly; SameSite=Strict${secure}`;
  }

  // ---- context resolution ---------------------------------------------------
  // Visitors are ALWAYS demo, whatever they ask for. The owner defaults to the
  // real context and may explicitly view the sandbox with ?mode=demo.
  function resolveMode(req) {
    if (!isOwner(req)) return 'demo';
    const url = new URL(req.url, 'http://localhost');
    return url.searchParams.get('mode') === 'demo' ? 'demo' : 'owner';
  }
  function contextFor(mode) {
    return mode === 'owner' ? { store, chaperone } : { store: demoStore, chaperone: demoChaperone };
  }

  // ---- SSE ----------------------------------------------------------------
  // Each client is tagged with its resolved mode; store events are broadcast
  // only to clients of that mode, so a visitor never receives real events.
  const sseClients = new Map(); // res -> 'owner' | 'demo'
  function broadcast(mode, event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [res, m] of sseClients) {
      if (m !== mode) continue;
      try { res.write(msg); } catch { sseClients.delete(res); }
    }
  }
  function wireStore(st, mode) {
    const listeners = {
      action: (e) => broadcast(mode, 'action', e),
      queue: (q) => broadcast(mode, 'queue', q),
      scorecard: (r) => broadcast(mode, 'scorecard', r),
      reset: () => broadcast(mode, 'reset', {}),
      briefing: (b) => broadcast(mode, 'briefing', b),
    };
    for (const [ev, fn] of Object.entries(listeners)) st.on(ev, fn);
    return listeners;
  }
  const realListeners = wireStore(store, 'owner');
  const demoListeners = wireStore(demoStore, 'demo');
  // A comment line every heartbeatMs keeps proxies from closing idle streams.
  const heartbeat = setInterval(() => {
    for (const res of sseClients.keys()) { try { res.write(': ping\n\n'); } catch { sseClients.delete(res); } }
  }, heartbeatMs);
  heartbeat.unref();

  // ---- demo replay --------------------------------------------------------
  // Every run is a fresh, self-contained simulation in the sandbox: the demo
  // store and engine are reset first, then the scripted action streams replay
  // through the demo gate. Real state is never read or written here.
  async function runDemo() {
    const runId = `run-${++demoSeq}-${Date.now()}`;
    archiveDemoRun(); // keep the previous run (and its decisions) before resetting
    demoStore.reset();
    demoChaperone.reset();
    demoStore.lastRunId = runId;
    broadcast('demo', 'demo', { running: true, run_id: runId });
    const results = [];
    let error = null;
    try {
      for (const def of loadScenarioDefs()) {
        broadcast('demo', 'scenario', { id: def.id, name: def.name, status: 'running' });
        const entries = await runScenarioLive(demoChaperone, def.id, { delayMs: demoDelayMs, runId });
        const result = scoreRun(def, entries, demoStore.queue);
        results.push(result);
        demoStore.setScenarioResults([...results]);
        broadcast('demo', 'scenario', { id: def.id, name: def.name, status: 'done', points: result.points });
      }
      demoStore.briefing = buildBriefing(demoStore);
      demoStore.emit('briefing', demoStore.briefing);
    } catch (e) {
      error = String(e?.message || e);
      log.error(`demo failed: ${e?.stack || e}`);
    } finally {
      demoRunning = false;
      broadcast('demo', 'demo', { running: false, ...(error ? { error } : {}) });
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
  function json(res, code, obj, headers = {}, req = null) {
    const body = JSON.stringify(obj);
    const raw = Buffer.from(body);
    const enc = req && raw.length > 1024 ? negotiateEncoding(req) : null;
    const out = enc ? compressBuffer(raw, enc) : raw;
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8', 'Content-Length': out.length,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      Vary: 'Accept-Encoding',
      ...(enc ? { 'Content-Encoding': enc } : {}),
      ...headers,
    });
    res.end(req && req.method === 'HEAD' ? undefined : out);
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

  function readJsonBody(req, limit = maxBodyBytes) {
    const declared0 = Number(req.headers['content-length']);
    const ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if ((declared0 > 0 || req.headers['transfer-encoding']) && ctype !== 'application/json') {
      return Promise.reject(new HttpError(415, 'body must be sent as application/json'));
    }
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > limit) {
        return reject(new HttpError(413, `body larger than ${limit} bytes`));
      }
      const chunks = [];
      let size = 0;
      let failed = false;
      req.on('data', (c) => {
        if (failed) return;
        size += c.length;
        if (size > limit) { failed = true; chunks.length = 0; reject(new HttpError(413, `body larger than ${limit} bytes`)); return; }
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

  function lineageSnapshot(chap = chaperone) {
    return [...chap.lineage.nodes.values()].map((n) => ({
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

  // Cached raw + pre-compressed bytes for small text assets (keyed by path,
  // invalidated on mtime/size change). Media is streamed, never buffered here.
  const staticCache = new Map();
  function textBytes(file, st) {
    let c = staticCache.get(file);
    if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
      const raw = fs.readFileSync(file);
      c = { mtimeMs: st.mtimeMs, size: st.size, raw, br: compressBuffer(raw, 'br'), gz: compressBuffer(raw, 'gzip') };
      staticCache.set(file, c);
    }
    return c;
  }

  function serveStatic(req, res, base, urlPath, extraHeaders = {}) {
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
      const cacheControl = REVALIDATE.has(ext) ? 'no-cache'
        : IMMUTABLE.has(ext) ? 'public, max-age=31536000, immutable'
        : 'public, max-age=86400';
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': cacheControl,
        ETag: etag, 'Last-Modified': st.mtime.toUTCString(),
        'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
        Vary: 'Accept-Encoding',
        ...(ext === '.html' ? { 'Referrer-Policy': 'no-referrer' } : {}),
        ...extraHeaders,
      };
      const wantsRange = !!req.headers.range;
      const enc = COMPRESSIBLE.has(ext) && !wantsRange && st.size > 256 ? negotiateEncoding(req) : null;
      // Compressed text: serve from cache with an encoding-specific ETag.
      if (enc) {
        const c = textBytes(file, st);
        const body = enc === 'br' ? c.br : c.gz;
        const cEtag = etag.slice(0, -1) + `-${enc}"`;
        headers.ETag = cEtag;
        headers['Content-Encoding'] = enc;
        headers['Content-Length'] = body.length;
        delete headers['Accept-Ranges'];
        const inm = req.headers['if-none-match'];
        if (inm && inm.split(',').map((s) => s.trim()).includes(cEtag)) { res.writeHead(304, headers); return res.end(); }
        res.writeHead(200, headers);
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
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
      if (wantsRange && (!ifRange || ifRange === etag)) {
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
    const mode = resolveMode(req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    if (req.method === 'HEAD') return res.end();
    res.write('retry: 2000\n\n');
    res.write('event: hello\ndata: {}\n\n');
    sseClients.set(res, mode);
    const drop = () => sseClients.delete(res);
    res.on('close', drop);
    res.on('error', drop);
  }

  // ---- server-rendered first paint ----------------------------------------
  // The Today headline, sub-line and stat cards are rendered into the initial
  // HTML from the resolved context, so the LCP text is not gated on the client
  // fetching /api/state. The client re-renders the same markup on load and on
  // every live event; this only removes the empty first paint. Every number is
  // computed from server data — nothing is invented.
  const ssrEsc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ssrMoney = (n) => 'SGD ' + Number(n).toLocaleString('en-SG');
  const ssrPlural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  function todaySnapshot(c, running) {
    const log = c.store.log.filter(isActionEntry);
    let rid = null;
    for (let i = log.length - 1; i >= 0; i--) if (log[i].run_id) { rid = log[i].run_id; break; }
    const tl = log.filter((e) => !e.scenario || e.run_id === rid);
    const pend = c.store.queue.filter((q) => q.status === 'pending');
    const pendingMoney = pend.reduce((a, q) => a + (Number(q.money_at_stake) || 0), 0);
    let stopped = 0; let reads = 0; let allow = 0;
    for (const e of tl) {
      if (e.decision === 'BLOCK') { if (e.action === 'read_file') reads++; else stopped++; }
      else if (e.decision === 'ALLOW') allow++;
    }
    const has = tl.length > 0;
    let lead; let sub;
    if (!has) {
      lead = running ? 'Your agents are starting work…' : 'Your five AI agents ask Chaperone before they act.';
      sub = running
        ? 'The demo is replaying ten real situations from the studio’s own files. Decisions appear here the moment they are made.'
        : 'Nothing has happened yet today. Run the demo to replay ten real situations from the studio’s own files. Every decision quotes the line in your file that decided it.';
    } else if (pend.length > 0) {
      lead = `${ssrPlural(pend.length, 'thing needs', 'things need')} your yes${pendingMoney ? `: <span class="money">${ssrEsc(ssrMoney(pendingMoney))}</span> in total` : ''}.`;
      sub = `Chaperone also stopped ${ssrPlural(stopped, 'risky action')} and ${ssrPlural(reads, 'file read')} before anything left the studio. ${ssrPlural(allow, 'routine action')} went ahead without bothering you.`;
    } else {
      lead = running ? 'Your agents are at work…' : 'Nothing needs you right now.';
      sub = `Chaperone stopped ${ssrPlural(stopped, 'risky action')} and ${ssrPlural(reads, 'file read')}, and let ${ssrPlural(allow, 'routine action')} through.${running ? ' Your agents are still working.' : ''}`;
    }
    const showN = (n) => (running && n === 0 ? '—' : n);
    const ic = (id) => `<svg class="ic" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;
    const stats = [
      ['waiting', 'i-wait', showN(pend.length), pend.length ? `waiting for your yes · <span class="money">${ssrEsc(ssrMoney(pendingMoney))}</span>` : 'waiting for your yes'],
      ['blocked', 'i-stop', showN(stopped), 'stopped before anything went out'],
      ['held', 'i-eye', showN(reads), 'file reads stopped (not needed or unsafe)'],
      ['done', 'i-done', showN(allow), 'done without asking'],
    ].map(([k, i, n, l]) => `<div class="stat stat-${k}"><span class="stat-ic" aria-hidden="true">${ic(i)}</span><span class="stat-n">${n}</span><span class="stat-l">${l}</span></div>`).join('');
    return { lead, sub, stats, has };
  }
  function renderIndex(req, res) {
    const file = path.join(webDir, 'index.html');
    let st;
    try { st = fs.statSync(file); } catch { return json(res, 404, { error: 'not found' }); }
    const c = textBytes(file, st);
    const snap = todaySnapshot(contextFor(resolveMode(req)), demoRunning);
    let html = c.raw.toString('utf8')
      .replace(/<!--ssr:lead-->[\s\S]*?<!--\/ssr:lead-->/, snap.lead)
      .replace(/<!--ssr:sub-->[\s\S]*?<!--\/ssr:sub-->/, ssrEsc(snap.sub))
      .replace(/<!--ssr:stats-->[\s\S]*?<!--\/ssr:stats-->/, snap.stats)
      .replace(/<!--ssr:introclass-->[\s\S]*?<!--\/ssr:introclass-->/, snap.has ? ' hidden' : '')
      .replace(/<!--ssr:bodyclass-->[\s\S]*?<!--\/ssr:bodyclass-->/, snap.has ? '' : 'hidden');
    const raw = Buffer.from(html);
    const enc = raw.length > 256 ? negotiateEncoding(req) : null;
    const out = enc ? compressBuffer(raw, enc) : raw;
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-ssr${enc ? '-' + enc : ''}"`;
    const headers = {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache',
      ETag: etag, 'Last-Modified': st.mtime.toUTCString(), 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', Vary: 'Accept-Encoding',
      'Content-Length': out.length, ...(enc ? { 'Content-Encoding': enc } : {}),
    };
    const inm = req.headers['if-none-match'];
    if (inm && inm.split(',').map((s) => s.trim()).includes(etag)) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : out);
  }

  // ---- routes -------------------------------------------------------------
  // Writes to the REAL engine (/api/gate, /api/hook) require owner auth: a
  // public URL must not let anonymous visitors append to the owner's audit log,
  // queue or ledger. Worker agents authenticate with a Bearer token. Reads
  // resolve to the owner's real context or the visitor's demo sandbox; the
  // sandbox (/api/demo/run, /api/queue/decide, /api/run) stays open to visitors.
  const GATE_BODY_LIMIT = 64 * 1024;
  const routes = {
    '/api/events': { GET: openEvents },
    '/api/state': {
      GET: (req, res) => {
        const mode = resolveMode(req);
        const owner = isOwner(req);
        const c = contextFor(mode);
        // Static precomputed classifier report. Evidence quotes can name
        // regulated files, so they are redacted for non-owner requests.
        let classifierReport = store.classifierReport;
        if (!owner && classifierReport && Array.isArray(classifierReport.rows)) {
          classifierReport = { ...classifierReport, rows: classifierReport.rows.map((r) => ({ ...r, evidence: [] })) };
        }
        return json(res, 200, {
          mode, owner,
          log: c.store.log, queue: c.store.queue, scenarioResults: c.store.scenarioResults,
          classifierReport, briefing: c.store.briefing,
          lineage: lineageSnapshot(c.chaperone), demoRunning,
          log_chain: c.store.verifyChain(),
          history: historySummaries(), decided_history: decidedHistory(),
        }, {}, req);
      },
    },
    // Read-only archive of an earlier demo run (sandbox data, open to visitors).
    '/api/run': {
      GET: (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const h = demoHistory.find((x) => x.run_id === url.searchParams.get('run_id'));
        if (!h) return json(res, 404, { ok: false, error: 'run not found' });
        return json(res, 200, {
          run_id: h.run_id, ended_at: h.ended_at, log: h.log, queue: h.queue,
          scenarioResults: h.scenarioResults, log_chain: h.log_chain,
        }, {}, req);
      },
    },
    '/api/gate': {
      POST: async (req, res) => {
        requireOwner(req);
        const body = await readJsonBody(req, GATE_BODY_LIMIT);
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
        // Open to visitors: it only ever runs the sandbox simulation.
        if (!startDemo()) return json(res, 409, { error: 'demo already running' });
        return json(res, 202, { ok: true, scenarios: loadScenarioDefs().map((d) => d.id) });
      },
    },
    '/api/queue/decide': {
      POST: async (req, res) => {
        const { queue_id, decision, mode } = await readJsonBody(req);
        const owner = isOwner(req);
        // Visitors always decide in the sandbox; the owner decides real items
        // by default (Bearer API behaviour) or sandbox items with mode:'demo'.
        const target = owner && mode !== 'demo' ? store : demoStore;
        if (typeof queue_id !== 'string' || !queue_id) return json(res, 400, { ok: false, code: 'invalid', error: 'queue_id is required' });
        const out = target.decide(queue_id, decision, owner ? (OWNER_FIRST_NAME || 'owner') : 'Demo visitor');
        return json(res, out.ok ? 200 : (DECIDE_STATUS[out.code] || 400), out);
      },
    },
    '/api/hook': {
      POST: async (req, res) => {
        const body = await readJsonBody(req, GATE_BODY_LIMIT);
        requireOwner(req);
        return json(res, 200, await hook(body));
      },
    },
    '/api/briefing': {
      GET: (req, res) => {
        const c = contextFor(resolveMode(req));
        return json(res, 200, c.store.briefing || buildBriefing(c.store));
      },
    },
    '/api/lineage': { GET: (req, res) => json(res, 200, lineageSnapshot(contextFor(resolveMode(req)).chaperone)) },
    '/api/health': {
      GET: (req, res) => {
        const base = {
          ok: true, demoRunning,
          demo_actions: demoStore.log.length, demo_queue: demoStore.queue.length,
          sse_clients: sseClients.size, uptime_s: Math.round(process.uptime()),
        };
        // Real-context counters are owner-only (no reconnaissance for visitors).
        return json(res, 200, isOwner(req) ? { ...base, actions: store.log.length, queue: store.queue.length } : base);
      },
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
    if (p === '/' || p === '/index.html') {
      // Owner sign-in: /?owner=<token> sets the cookie and redirects to a
      // clean URL. A plain GET / serves the UI with NO cookie — visitors are
      // demo mode, never owner.
      if (url.searchParams.has('owner')) {
        if (!tokenMatches(url.searchParams.get('owner'))) throw new HttpError(401, 'invalid owner token');
        res.writeHead(302, {
          Location: '/', 'Set-Cookie': ownerCookie(req),
          'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        });
        return res.end();
      }
      return renderIndex(req, res);
    }
    return serveStatic(req, res, webDir, p);
  }

  // Security headers on every response. The CSP allows the app's own inline
  // critical CSS and inline style attributes (style-src 'unsafe-inline') while
  // restricting scripts, frames, objects and connections to this origin.
  // HSTS is ignored by browsers over plain HTTP and enforced behind the https
  // proxy, so it is safe to send unconditionally.
  const SECURITY_HEADERS = {
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Referrer-Policy': 'no-referrer',
  };
  const server = http.createServer((req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    Promise.resolve()
      .then(() => handle(req, res))
      .catch((e) => {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) log.error(`${req.method} ${req.url}: ${e?.stack || e}`);
        if (res.headersSent) { res.destroy(); return; }
        const headers = { ...(e.headers || {}) };
        if (status === 413) {
          // Answer, then drain (discard) the rest of the upload so the client
          // can reliably read the 413. Do NOT set Connection: close up front:
          // Node would then reset the socket while the client is still writing,
          // losing the response. Close once the body is drained AND the response
          // is sent; a client that keeps sending is cut off after 2s.
          req.resume();
          const cutoff = setTimeout(() => req.destroy(), 2000).unref();
          let resDone = false; let reqDone = false;
          const maybeClose = () => { if (resDone && reqDone) { clearTimeout(cutoff); req.destroy(); } };
          res.on('finish', () => { resDone = true; maybeClose(); });
          req.on('end', () => { reqDone = true; maybeClose(); });
          req.on('error', () => { reqDone = true; maybeClose(); });
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
    for (const [ev, fn] of Object.entries(realListeners)) store.off(ev, fn);
    for (const [ev, fn] of Object.entries(demoListeners)) demoStore.off(ev, fn);
    for (const res of sseClients.keys()) { try { res.end(); } catch { /* gone */ } }
    sseClients.clear();
  });
  // Close idle SSE streams so server.close() can finish.
  const origClose = server.close.bind(server);
  server.close = (cb) => {
    for (const res of sseClients.keys()) { try { res.end(); } catch { /* gone */ } }
    sseClients.clear();
    server.closeIdleConnections?.();
    return origClose(cb);
  };

  return {
    server,
    broadcast: (event, data) => { broadcast('owner', event, data); broadcast('demo', event, data); },
    startDemo,
    ownerToken,
    demoStore, demoChaperone,
    get demoRunning() { return demoRunning; },
    get demoPromise() { return demoPromise; },
    get sseClientCount() { return sseClients.size; },
  };
}
