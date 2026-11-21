// Local visual + behavioural verification of the rebuild. Runs against a local
// server (PORT 8090) using the repo's bundled playwright-core + chromium-1255.
// Usage: node tests/e2e/rebuild.mjs [baseUrl]
// Saves screenshots to video/work_qwen/app-redteam/rebuild/ and a verify.json.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('../../video/record/node_modules/playwright-core');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'video/work_qwen/app-redteam/rebuild');
const BASE = process.argv[2] || 'http://127.0.0.1:8090';
const EXE = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const WIDTHS = [360, 390, 834, 1280, 1920];
const ROUTES = ['today', 'log', 'queue', 'facts', 'lineage', 'score'];
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureDemo() {
  await fetch(BASE + '/api/demo/run', { method: 'POST' }).catch(() => {});
  for (let i = 0; i < 80; i++) {
    const st = await (await fetch(BASE + '/api/state')).json();
    if (!st.demoRunning && st.log.length) return st;
    await sleep(400);
  }
  throw new Error('demo did not finish');
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });
try {
  await ensureDemo();

  // ---- screenshot matrix ---------------------------------------------------
  for (const width of WIDTHS) {
    const height = width < 768 ? 740 : 900;
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    for (const route of ROUTES) {
      await page.goto(`${BASE}/#${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `w${width}_${route}_fold.png`) });
      await page.screenshot({ path: path.join(OUT, `w${width}_${route}.png`), fullPage: true });
    }
    await ctx.close();
  }
  check('screenshot matrix captured', true, `${WIDTHS.length} widths × ${ROUTES.length} routes`);

  // ---- D1/D2/U4: mobile brand + first decision above the fold --------------
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#today`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const brand = await page.locator('.brand .name').boundingBox();
    check('D1 brand name fully visible at 360', brand && brand.width > 80, `width=${brand && Math.round(brand.width)}px`);
    const headerH = await page.locator('.top').evaluate((el) => el.getBoundingClientRect().height);
    check('D2 mobile header is slim (<170px)', headerH < 170, `header=${Math.round(headerH)}px`);
    const btn = await page.locator('#todayQueue [data-act="deny"]').first().boundingBox();
    check('U4 first decision above the fold at 360×740', btn && btn.y < 740, `first button y=${btn && Math.round(btn.y)}px`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('no horizontal overflow at 360', overflow <= 0, `overflow=${overflow}px`);
    await ctx.close();
  }

  // ---- U1: fixed button order; U2: reason on Today -------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#queue`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const order = await page.$$eval('#queueList .card-pending', (cards) => cards.map((c) => {
      const d = c.querySelector('[data-act="deny"]').getBoundingClientRect();
      const a = c.querySelector('[data-act="approve"]').getBoundingClientRect();
      return { denyLeft: d.x < a.x, rec: c.querySelector('.rec')?.className || '' };
    }));
    check('U1 Say no is left of Approve on every card', order.length > 0 && order.every((o) => o.denyLeft), `${order.length} cards`);
    const reviewSecondary = await page.$$eval('#queueList .card-pending .rec-review', (els) => els.map((e) => e.closest('.card').querySelector('[data-act="approve"]').className));
    check('U1 review card Approve is secondary (not green-solid)', reviewSecondary.every((c) => c.includes('btn-secondary') && !c.includes('btn-approve')), `${reviewSecondary.length} review cards`);
    await page.goto(`${BASE}/#today`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const todayWhy = await page.$$eval('#todayQueue .card', (cards) => cards.map((c) => ({
      why: !!c.querySelector('.why-held'),
      recText: c.querySelector('.rec')?.innerText || '',
    })));
    check('U2 Today cards have the "Why it was held" expander', todayWhy.length > 0 && todayWhy.every((c) => c.why), `${todayWhy.length} cards`);
    check('U2 Today cards show a recommendation reason', todayWhy.every((c) => /recommends/i.test(c.recText)));
    await ctx.close();
  }

  // ---- D4: status vocabulary ----------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#log`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const held = await page.$$eval('.pill', (ps) => ps.filter((p) => /^Held$/.test(p.textContent.trim())).length);
    const waitingFilter = await page.locator('#decFilter [data-dec="HOLD_FOR_APPROVAL"]').innerText();
    check('D4 no "Held" pills; filter says Waiting', held === 0 && /Waiting/.test(waitingFilter), `heldPills=${held}, filter="${waitingFilter.trim()}"`);
    await ctx.close();
  }

  // ---- F2: CLS on load (video + fonts) -------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(`${BASE}/#today`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const cls = await page.evaluate(() => window.__cls);
    check('F2 cumulative layout shift < 0.1', cls < 0.1, `CLS=${cls.toFixed(4)}`);
    const videoBox = await page.locator('#briefVideo').evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, ratio: r.width / r.height }; });
    check('F2 video reserves a 16:9 box', Math.abs(videoBox.ratio - 16 / 9) < 0.05, `ratio=${videoBox.ratio.toFixed(3)}`);
    await ctx.close();
  }

  // ---- S1: gate auth from the browser --------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#today`, { waitUntil: 'networkidle' });
    const status = await page.evaluate(async () => {
      const r = await fetch('/api/gate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: 'X', action: 'list_dir', params: { dir: 'finance/' } }) });
      return r.status;
    });
    check('S1 unauthenticated POST /api/gate is 401', status === 401, `status=${status}`);
    await ctx.close();
  }

  // ---- U3: history preserved across a re-run -------------------------------
  {
    const st = await (await fetch(BASE + '/api/state')).json();
    const pend = st.queue.find((q) => q.status === 'pending' && !q.never);
    await fetch(BASE + '/api/queue/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queue_id: pend.queue_id, decision: 'deny' }) });
    await fetch(BASE + '/api/demo/run', { method: 'POST' });
    await ensureDemo();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#queue`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const decided = await page.locator('#decidedList li').count();
    check('U3 Already-decided survives a re-run', decided >= 1, `${decided} decided items`);
    await page.goto(`${BASE}/#log`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const opts = await page.locator('#runPicker option').count();
    check('U3 run picker lists earlier runs', opts >= 2, `${opts} options`);
    // Browse an archived run.
    const val = await page.locator('#runPicker option:nth-child(2)').getAttribute('value');
    await page.selectOption('#runPicker', val);
    await page.waitForTimeout(600);
    const rows = await page.locator('#logList .row').count();
    check('U3 archived run is browsable', rows >= 30, `${rows} rows`);
    await page.screenshot({ path: path.join(OUT, 'history_archived_run.png'), fullPage: false });
    await ctx.close();
  }

  // ---- D5: scorecard mobile scannability -----------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#score`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const collapsed = await page.$$eval('table.score tr[data-pass="all"]', (trs) => trs.map((tr) => getComputedStyle(tr.querySelector('td.chk')).display));
    check('D5 all-pass scorecard rows collapse on mobile', collapsed.length > 0 && collapsed.every((d) => d === 'none'), `${collapsed.length} all-pass rows`);
    await page.screenshot({ path: path.join(OUT, 'score_mobile_collapsed.png'), fullPage: true });
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT, 'verify.json'), JSON.stringify({ base: BASE, results, passed: results.length - failed.length, failed: failed.length }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);