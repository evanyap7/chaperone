// Final red-team fix regressions: security headers on every response (S2),
// the WebP app poster (F4), 44px mobile nav tap targets, and the small-screen
// fold rules that keep both decision buttons above the fold at 360×740 (D2/U4).
// Layout itself is verified with Playwright; these tests pin the code facts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { Chaperone } from '../../src/chaperone.js';
import { ROOT } from '../../src/config.js';

let app; let base;
const quiet = { error() {}, log() {} };

before(async () => {
  const store = new Store(null);
  const chaperone = new Chaperone(store);
  app = createApp({ store, chaperone, demoDelayMs: 0, heartbeatMs: 50, log: quiet });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => {
  await new Promise((r) => app.server.close(r));
});

function raw(method, p) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${p}`, { method, path: p }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('S2: every response carries CSP, X-Frame-Options, nosniff and HSTS', async () => {
  for (const p of ['/', '/api/state', '/style.css', '/api/nope', '/assets/thumbnail.webp']) {
    const r = await raw('GET', p);
    assert.ok(r.headers['content-security-policy'], `CSP missing on ${p}`);
    assert.equal(r.headers['x-frame-options'], 'DENY', `XFO missing on ${p}`);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', `nosniff missing on ${p}`);
    assert.match(r.headers['strict-transport-security'], /max-age=31536000/, `HSTS missing on ${p}`);
    assert.equal(r.headers['referrer-policy'], 'no-referrer', `referrer policy missing on ${p}`);
  }
});

test('S2: CSP allows the app\'s own inline styles and same-origin scripts, and blocks framing', async () => {
  const r = await raw('GET', '/');
  const csp = r.headers['content-security-policy'];
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.match(csp, /img-src 'self' data:/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});

test('S2: headers also present on the owner sign-in redirect and on error responses', async () => {
  const bad = await raw('GET', '/?owner=invalid');
  assert.equal(bad.status, 401);
  assert.equal(bad.headers['x-frame-options'], 'DENY');
  assert.ok(bad.headers['content-security-policy']);
  const redir = await raw('GET', `/?owner=${app.ownerToken}`);
  assert.equal(redir.status, 302);
  assert.equal(redir.headers['x-frame-options'], 'DENY');
  assert.ok(redir.headers['content-security-policy']);
  assert.ok(redir.headers['strict-transport-security']);
});

test('F4: the app poster is a WebP variant, smaller than the PNG it replaces', () => {
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
  assert.match(html, /poster="\/assets\/thumbnail\.webp"/);
  assert.doesNotMatch(html, /poster="\/assets\/thumbnail\.png"/);
  const webp = path.join(ROOT, 'assets', 'thumbnail.webp');
  const png = path.join(ROOT, 'assets', 'thumbnail.png');
  assert.ok(fs.existsSync(webp), 'thumbnail.webp exists');
  assert.ok(fs.existsSync(png), 'the PNG original is kept for other consumers');
  assert.ok(fs.statSync(webp).size < fs.statSync(png).size, 'WebP poster is smaller than the PNG');
  assert.equal(fs.readFileSync(webp).subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(fs.readFileSync(webp).subarray(8, 12).toString('ascii'), 'WEBP');
});

test('tap targets: mobile nav tabs are at least 44px tall in both stylesheets', () => {
  const css = fs.readFileSync(path.join(ROOT, 'web', 'style.css'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
  assert.match(css, /\.tabs button \{[^}]*min-height: 44px/);
  assert.match(html, /\.tabs button\{[^}]*min-height:44px/);
  assert.doesNotMatch(css, /\.tabs button \{[^}]*min-height: 40px/);
});

test('D2/U4: small-screen fold rules exist in the full sheet and the critical CSS', () => {
  const css = fs.readFileSync(path.join(ROOT, 'web', 'style.css'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
  for (const src of [css, html]) {
    const compact = src.includes('@media (max-width: 479.98px)') || src.includes('@media (max-width:479.98px)');
    assert.ok(compact, 'a ≤479.98px tightening block exists');
    assert.match(src, /#todaySub\s*\{[^}]*-webkit-line-clamp:\s*2/);
    assert.match(src, /\.block-head h2\s*\{[^}]*font-size:\s*var\(--text-md\)/);
    assert.match(src, /\.card-actions\s*\{[^}]*margin-top:\s*var\(--space-md\)/);
  }
});

test('video player: the 16:9 box never crops the poster (object-fit contain)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'web', 'style.css'), 'utf8');
  assert.match(css, /\.video video \{[^}]*aspect-ratio: 16 \/ 9[^}]*object-fit: contain/);
});