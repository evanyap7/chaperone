// Source-level invariants for the UI rebuild. These guard the P0/P1 fixes that
// live in the vanilla-JS client (no framework, no DOM library): fixed button
// order, one status vocabulary, money never splits, the video reserves space,
// fonts don't reflow, the brand survives small screens, and the first paint is
// server-rendered. Browser-level behaviour is verified in tests/e2e/rebuild.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = fs.readFileSync(path.join(ROOT, 'web/app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'web/style.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');

test('D4: one status vocabulary — HOLD is "Waiting" everywhere, never "Held"', () => {
  assert.match(app, /HOLD_FOR_APPROVAL:\s*\{[^}]*label:\s*'Waiting'/);
  assert.match(app, /HOLD_FOR_APPROVAL:\s*\{[^}]*filter:\s*'Waiting'/);
  assert.ok(!/label:\s*'Held'/.test(app), 'no "Held" status label remains');
  assert.match(app, /\['HOLD_FOR_APPROVAL',\s*'Waiting'/, 'log filter chip says Waiting');
  assert.match(html, /k-HOLD_FOR_APPROVAL"[^>]*>[\s\S]*?Waiting/, 'keyline says Waiting');
});

test('U1: button positions are fixed (Say no left, Approve right); recommendation never flips primacy', () => {
  assert.match(app, /<div class="card-actions">\$\{deny\}\$\{approve\}<\/div>/, 'deny always precedes approve');
  assert.ok(!/denyPrimary \? deny \+ approve : approve \+ deny/.test(app), 'the old order-flip is gone');
  // Approve is secondary weight even on a "look closely" card (no green-solid promote).
  assert.match(app, /data-act="approve"[^>]*class="btn btn-secondary"|class="btn btn-secondary" data-act="approve"/);
  assert.ok(!/btn-approve'/.test(app), 'Approve never uses the green-solid primary fill');
});

test('U2: Today (compact) cards carry the reason and the "Why it was held" expander', () => {
  assert.ok(!/compact \? '' : whyBody/.test(app), 'the expander is no longer suppressed on Today');
  assert.ok(!/compact \? '' : extra/.test(app));
  assert.match(app, /Why it was held/);
  // The reason is shown on compact cards too (no `!compact` gate on rec.why).
  assert.ok(!/rec\.why && !compact/.test(app));
});

test('D3: the money token never splits; the headline is responsive', () => {
  assert.match(css, /#todayLead \.money\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(css, /h1\s*\{\s*font-size:\s*clamp\(/);
});

test('F2: the video reserves a 16:9 box; fonts use optional display (no swap reflow)', () => {
  assert.match(css, /\.video video\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(html, /id="briefVideo"[^>]*width="1280"[^>]*height="720"/);
  assert.match(css, /font-display:\s*optional/);
  assert.ok(!/font-display:\s*swap/.test(css), 'no swap reflow remains');
  assert.match(css, /url\("\/fonts\/Lexend\.woff2/);
});

test('D1/D2: the brand survives small screens; mobile chrome is slim', () => {
  assert.match(css, /\.brand \.name\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.brand \.who, \.brand \.tagline\s*\{\s*display:\s*none/);
  // Tabs are a single scrollable row on mobile, not a 3x2 grid.
  assert.ok(!/grid-template-columns:\s*repeat\(3, 1fr\)/.test(css), 'the 3x2 tab grid is gone');
  // Decisions come before the stat strip on mobile.
  assert.match(css, /\.waiting-block\s*\{\s*order:\s*1/);
  assert.match(css, /#statrow\s*\{\s*order:\s*2/);
});

test('F1: critical CSS is inline; the full sheet is deferred; the first paint is SSR', () => {
  assert.match(html, /<style id="critical">/);
  assert.match(html, /rel="preload" href="\/style\.css[^"]*" as="style" id="fullCssLink"/);
  assert.match(html, /<noscript><link rel="stylesheet" href="\/style\.css/);
  assert.match(app, /fullCss\.rel = 'stylesheet'/);
  for (const m of ['ssr:lead', 'ssr:sub', 'ssr:stats', 'ssr:introclass', 'ssr:bodyclass']) {
    assert.ok(html.includes(`<!--${m}-->`), `SSR marker ${m} present`);
  }
  assert.match(html, /rel="preload" href="\/fonts\/SourceSans3\.woff2[^"]*" as="font"/);
});

test('D5: the scorecard collapses all-pass rows on mobile and escapes labels', () => {
  assert.match(app, /data-pass="\$\{allPass \? 'all' : 'some'\}"/);
  assert.match(app, /class="score-sit-btn"/);
  assert.match(app, /data-lbl="\$\{esc\(lbl\)\}"/, 'check labels are escaped (P2-6)');
  assert.match(css, /tr\[data-pass="all"\]:not\(\.open\) td\.chk/);
});

test('U3/F5: run picker, kept history, and a distinct offline error state exist', () => {
  assert.match(html, /id="runPicker"/);
  assert.match(app, /decided_history/);
  assert.match(app, /S\.history/);
  assert.match(html, /id="connError"/);
  assert.match(html, /id="retryBtn"/);
  assert.match(app, /renderConnError/);
});