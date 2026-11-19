// Endpoint tests: the real app on a random port, with an in-memory store and
// a temporary assets folder so Range handling is checked byte for byte.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { Chaperone } from '../../src/chaperone.js';

let app; let base; let store; let assetsDir;
const VIDEO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
const quiet = { error() {}, log() {} };

before(async () => {
  assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaperone-assets-'));
  fs.writeFileSync(path.join(assetsDir, 'clip.mp4'), VIDEO);
  fs.writeFileSync(path.join(assetsDir, '.secret'), 'nope');
  store = new Store(null);
  app = createApp({ store, chaperone: new Chaperone(store), demoDelayMs: 0, heartbeatMs: 50, assetsDir, log: quiet });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => {
  await app.demoPromise;
  await new Promise((r) => app.server.close(r));
  fs.rmSync(assetsDir, { recursive: true, force: true });
});

// Raw request (no URL normalisation), so traversal paths reach the server as sent.
function raw(method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${p}`, { method, headers, path: p }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(buf.toString()); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, buf, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}
const post = (p, body) => raw('POST', p, { body, headers: { 'Content-Type': 'application/json' } });

test('serves the UI with content type, ETag and no-cache; 304 on revalidation', async () => {
  const r = await raw('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  assert.equal(r.headers['cache-control'], 'no-cache');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  const again = await raw('GET', '/', { headers: { 'If-None-Match': r.headers.etag } });
  assert.equal(again.status, 304);
  assert.equal(again.buf.length, 0);
});

test('static path traversal is refused', async () => {
  for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/%2e%2e/etc/passwd', '/assets/..%2f..%2fsrc%2fconfig.js', '/assets/%2e%2e%2fpackage.json']) {
    const r = await raw('GET', p);
    assert.ok([403, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.ok(!r.buf.toString().includes('"name"'), `${p} leaked a file`);
  }
  assert.equal((await raw('GET', '/%E0%A4%A')).status, 400); // malformed escape
  assert.equal((await raw('GET', '/assets/.secret')).status, 404); // dotfiles hidden
  assert.equal((await raw('GET', '/nope.html')).status, 404);
});

test('mp4: HEAD, full GET, ranges, suffix ranges and 416', async () => {
  const head = await raw('HEAD', '/assets/clip.mp4');
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-type'], 'video/mp4');
  assert.equal(head.headers['accept-ranges'], 'bytes');
  assert.equal(Number(head.headers['content-length']), VIDEO.length);
  assert.equal(head.buf.length, 0);
  const full = await raw('GET', '/assets/clip.mp4');
  assert.ok(full.buf.equals(VIDEO));
  const part = await raw('GET', '/assets/clip.mp4', { headers: { Range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers['content-range'], `bytes 100-199/${VIDEO.length}`);
  assert.ok(part.buf.equals(VIDEO.subarray(100, 200)));
  const open = await raw('GET', '/assets/clip.mp4', { headers: { Range: 'bytes=990-' } });
  assert.ok(open.buf.equals(VIDEO.subarray(990)));
  const suffix = await raw('GET', '/assets/clip.mp4', { headers: { Range: 'bytes=-10' } });
  assert.ok(suffix.buf.equals(VIDEO.subarray(990)));
  const bad = await raw('GET', '/assets/clip.mp4', { headers: { Range: 'bytes=5000-' } });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers['content-range'], `bytes */${VIDEO.length}`);
  const stale = await raw('GET', '/assets/clip.mp4', { headers: { Range: 'bytes=0-9', 'If-Range': 'W/"old"' } });
  assert.equal(stale.status, 200); // changed file: whole body, not a stale slice
});

test('API: unknown endpoint 404, wrong method 405 with Allow', async () => {
  const r = await raw('GET', '/api/nope');
  assert.equal(r.status, 404);
  assert.ok(r.json.error);
  const m = await raw('GET', '/api/gate');
  assert.equal(m.status, 405);
  assert.equal(m.headers.allow, 'POST');
  const d = await raw('DELETE', '/api/state');
  assert.equal(d.status, 405);
  assert.equal(d.headers.allow, 'GET, HEAD');
  assert.equal((await raw('PUT', '/index.html')).status, 405);
});

test('POST bodies: invalid JSON 400, non-object 400, missing fields 400, oversized 413', async () => {
  assert.equal((await post('/api/gate', '{bad')).status, 400);
  assert.equal((await post('/api/gate', '[1,2]')).status, 400);
  assert.equal((await post('/api/gate', 'null')).status, 400);
  const missing = await post('/api/gate', { agent: 'A' });
  assert.equal(missing.status, 400);
  assert.match(missing.json.error, /action/);
  const big = await post('/api/gate', JSON.stringify({ agent: 'A', action: 'list_dir', params: { pad: 'x'.repeat(1_100_000) } }));
  assert.equal(big.status, 413);
  assert.equal(store.log.length, 0); // none of these reached the log
});

test('POST /api/gate returns the logged entry; traversal in params is a logged BLOCK', async () => {
  const ok = await post('/api/gate', { agent: 'Ops', action: 'list_dir', params: { dir: 'finance/' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.decision, 'ALLOW');
  assert.equal(typeof ok.json.id, 'number');
  const trav = await post('/api/gate', { agent: 'Ops', action: 'read_file', params: { file: '../../etc/passwd' } });
  assert.equal(trav.status, 200);
  assert.equal(trav.json.decision, 'BLOCK');
});

test('queue decide: 400 invalid, 404 unknown, 200 once, 409 repeat', async () => {
  const held = await post('/api/gate', { agent: 'Ops', action: 'delete_file', params: { file: 'finance/invoice_2026-031_harbourbean.md' } });
  const id = held.json.queue_id;
  assert.ok(id);
  assert.equal((await post('/api/queue/decide', { queue_id: id, decision: 'maybe' })).status, 400);
  assert.equal((await post('/api/queue/decide', { decision: 'deny' })).status, 400);
  assert.equal((await post('/api/queue/decide', { queue_id: 'Q999', decision: 'deny' })).status, 404);
  const first = await post('/api/queue/decide', { queue_id: id, decision: 'deny' });
  assert.equal(first.status, 200);
  assert.equal(first.json.ok, true);
  assert.equal(first.json.queue.status, 'denied');
  const second = await post('/api/queue/decide', { queue_id: id, decision: 'approve' });
  assert.equal(second.status, 409);
  assert.equal(second.json.ok, false);
});

test('NEVER queue items are refused with 403', async () => {
  const q = store.enqueue({ fingerprint: 'never-test', never: true });
  const r = await post('/api/queue/decide', { queue_id: q.queue_id, decision: 'approve' });
  assert.equal(r.status, 403);
  assert.equal(q.status, 'pending');
});

test('SSE: hello, retry, heartbeat, live events; disconnect is cleaned up', async () => {
  const text = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/events`, (res) => {
      assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        if (buf.includes('event: hello') && buf.includes(': ping') && !buf.includes('event: action')) {
          post('/api/gate', { agent: 'Ops', action: 'list_dir', params: { dir: 'x/' } });
        }
        if (buf.includes('event: action')) { req.destroy(); resolve(buf); }
      });
    });
    req.on('error', (e) => (e.code === 'ECONNRESET' ? null : reject(e)));
  });
  assert.match(text, /^retry: \d+/);
  assert.match(text, /event: hello/);
  assert.match(text, /: ping/);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(app.sseClientCount, 0);
});

test('demo: 202 then 409 while running; finishes 30/30 with a briefing', async () => {
  const [a, b] = await Promise.all([post('/api/demo/run'), post('/api/demo/run')]);
  assert.deepEqual([a.status, b.status].sort(), [202, 409]);
  const ok = a.status === 202 ? a : b;
  assert.ok(ok.json.ok);
  assert.ok(ok.json.scenarios.length >= 10);
  const result = await app.demoPromise;
  assert.equal(result.ok, true);
  const state = await raw('GET', '/api/state');
  const pts = state.json.scenarioResults.reduce((s, r) => s + r.points, 0);
  assert.equal(pts, state.json.scenarioResults.length * 3);
  assert.ok(state.json.briefing?.headline);
  assert.equal(state.json.demoRunning, false);
  const health = await raw('GET', '/api/health');
  assert.equal(health.json.ok, true);
  assert.equal((await raw('GET', '/api/briefing')).status, 200);
  assert.ok(Array.isArray((await raw('GET', '/api/lineage')).json));
});

test('writes: cross-origin POST is 403, non-JSON body is 415', async () => {
  const body = JSON.stringify({ queue_id: 'Q1', decision: 'approve' });
  const xo = await raw('POST', '/api/queue/decide', { body, headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' } });
  assert.equal(xo.status, 403);
  const plain = await raw('POST', '/api/queue/decide', { body, headers: { 'Content-Type': 'text/plain' } });
  assert.equal(plain.status, 415);
  const host = new URL(base).host;
  const same = await raw('POST', '/api/gate', { body: JSON.stringify({ agent: 'Ops', action: 'list_dir', params: { dir: 'finance/' } }), headers: { 'Content-Type': 'application/json', Origin: `http://${host}` } });
  assert.equal(same.status, 200);
});

test('list_dir outside data/ is blocked', async () => {
  const r = await post('/api/gate', { agent: 'Ops', action: 'list_dir', params: { dir: '../../etc' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.decision, 'BLOCK');
});
