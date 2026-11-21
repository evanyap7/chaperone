// Rebuild regressions: gate auth (S1), compression + SSR first paint (F1),
// append-only demo history (U3), and the security hygiene items (S2/P2).
// A fresh app instance per file so state never leaks into server.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { createApp } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { Chaperone } from '../../src/chaperone.js';

let app; let base; let store; let chaperone;
const quiet = { error() {}, log() {} };

before(async () => {
  store = new Store(null);
  chaperone = new Chaperone(store);
  app = createApp({ store, chaperone, demoDelayMs: 0, heartbeatMs: 50, log: quiet });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => {
  await app.demoPromise;
  await new Promise((r) => app.server.close(r));
});

function raw(method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${p}`, { method, headers, path: p }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}
const post = (p, body, headers = {}) => raw('POST', p, { body, headers: { 'Content-Type': 'application/json', ...headers } });
const auth = () => ({ Authorization: `Bearer ${app.ownerToken}` });
const getJson = async (p, headers = {}) => JSON.parse((await raw('GET', p, { headers })).buf.toString());
const waitDemo = async () => { await app.demoPromise; };

test('S1: POST /api/gate requires owner auth; the sandbox stays open to visitors', async () => {
  const anon = await post('/api/gate', { agent: 'X', action: 'list_dir', params: { dir: 'finance/' } });
  assert.equal(anon.status, 401);
  assert.equal(JSON.parse(anon.buf.toString()).error, 'owner authentication required');
  assert.equal(store.log.length, 0, 'an anonymous write never reaches the real log');
  const ok = await post('/api/gate', { agent: 'Ops', action: 'list_dir', params: { dir: 'finance/' } }, auth());
  assert.equal(ok.status, 200);
  // Visitors can still run the demo and decide sandbox items.
  assert.equal((await post('/api/demo/run', {})).status, 202);
  await waitDemo();
  const pend = app.demoStore.queue.find((q) => q.status === 'pending' && !q.never);
  assert.equal((await post('/api/queue/decide', { queue_id: pend.queue_id, decision: 'deny' })).status, 200);
});

test('F1: text assets and /api/state negotiate brotli/gzip; identity without Accept-Encoding', async () => {
  const br = await raw('GET', '/', { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.match(br.headers.vary, /Accept-Encoding/);
  const html = zlib.brotliDecompressSync(br.buf).toString();
  assert.match(html, /id="todayLead"/);
  const gz = await raw('GET', '/style.css', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.match(zlib.gunzipSync(gz.buf).toString(), /--color-ink/);
  const id = await raw('GET', '/style.css');
  assert.equal(id.headers['content-encoding'], undefined);
  const st = await raw('GET', '/api/state', { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(st.headers['content-encoding'], 'br');
  assert.ok(JSON.parse(zlib.brotliDecompressSync(st.buf).toString()).mode);
  // A 304 revalidation uses the encoding-specific ETag.
  const again = await raw('GET', '/', { headers: { 'Accept-Encoding': 'br', 'If-None-Match': br.headers.etag } });
  assert.equal(again.status, 304);
});

test('F1: the Today headline is server-rendered from real data (LCP not gated on fetch)', async () => {
  // Sandbox already ran in the S1 test; it has pending items with money.
  const st = await getJson('/api/state');
  const pend = st.queue.filter((q) => q.status === 'pending');
  const money = pend.reduce((a, q) => a + (q.money_at_stake || 0), 0);
  const html = (await raw('GET', '/')).buf.toString();
  const lead = (html.match(/<h1 id="todayLead">([\s\S]*?)<\/h1>/) || [])[1];
  assert.ok(lead, 'headline present in initial HTML');
  if (pend.length && money) {
    assert.match(lead, /need your yes/);
    assert.ok(lead.includes(money.toLocaleString('en-SG')), `headline carries the real total ${money}`);
  }
  // Stat cards are pre-rendered too.
  assert.match(html, /id="statrow"[^>]*><div class="stat/);
});

test('U3: every demo run is archived; decisions persist across re-runs; /api/run browses them', async () => {
  const realBefore = store.log.length;
  await post('/api/demo/run', {}); await waitDemo();
  const pend = app.demoStore.queue.find((q) => q.status === 'pending' && !q.never);
  await post('/api/queue/decide', { queue_id: pend.queue_id, decision: 'approve' });
  const firstRun = app.demoStore.lastRunId;
  // Re-run: the previous run (and its decision) must survive.
  await post('/api/demo/run', {}); await waitDemo();
  const st = await getJson('/api/state');
  assert.ok(st.history.length >= 1, 'history keeps the earlier run');
  const h = st.history.find((x) => x.run_id === firstRun);
  assert.ok(h, 'the first run is in the history list');
  assert.ok(st.decided_history.some((q) => q.queue_id === pend.queue_id && q.status === 'approved'), 'the decision is kept');
  assert.equal(st.queue.filter((q) => q.status === 'pending').length, 4, 'the new run replays fresh pending items');
  const arch = await getJson('/api/run?run_id=' + encodeURIComponent(firstRun));
  assert.ok(arch.log.length >= 30);
  assert.equal(arch.log_chain.ok, true);
  assert.ok(arch.queue.some((q) => q.queue_id === pend.queue_id && q.status === 'approved'));
  assert.equal((await raw('GET', '/api/run?run_id=nope')).status, 404);
  assert.equal(store.log.length, realBefore, 'the real log is untouched by demo history');
});

test('S2/P2: health hides real counters from visitors; HSTS on every response; fonts immutable', async () => {
  const v = await getJson('/api/health');
  assert.equal(v.ok, true);
  assert.equal(v.actions, undefined, 'no real action count for visitors');
  assert.equal(v.queue, undefined);
  const hsts = await raw('GET', '/', { headers: { 'X-Forwarded-Proto': 'https' } });
  assert.match(hsts.headers['strict-transport-security'], /max-age=31536000/);
  // HSTS is now sent unconditionally: browsers ignore it over plain HTTP and
  // enforce it behind the https proxy, so local checks see the header too.
  const plain = await raw('GET', '/');
  assert.match(plain.headers['strict-transport-security'], /max-age=31536000/);
  const font = await raw('GET', '/fonts/Lexend.woff2');
  assert.match(font.headers['cache-control'], /immutable/);
});

test('P2: classifier evidence quotes are redacted for visitors, intact for the owner', async () => {
  store.classifierReport = { total: 1, correct: 1, rows: [{ file: 'admin/owner_records.md', evidence: ['S0000001A: "secret" (line 1)'] }] };
  const v = await getJson('/api/state');
  assert.deepEqual(v.classifierReport.rows[0].evidence, []);
  assert.equal(v.classifierReport.correct, 1, 'the score stays visible');
  const o = await getJson('/api/state', auth());
  assert.equal(o.classifierReport.rows[0].evidence.length, 1);
  store.classifierReport = null;
});