import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXE = process.env.CHROME_PATH || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1255/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const DIR = process.argv[2] || path.join(os.tmpdir(), 'chaperone_demo');
fs.mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(DIR, `step_${name}.png`) });
const health = async () => (await fetch('http://localhost:8081/api/health')).json();

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: DIR, size: { width: 1600, height: 900 } } });
const page = await context.newPage();
await page.goto('http://localhost:8081', { waitUntil: 'load' });
await sleep(1500);
await shot(page, '01_empty');

// Live log tab, then start the demo and wait for it from Node (deterministic).
await page.click('button[data-tab="log"]');
await sleep(500);
await page.click('#runDemo');
const t0 = Date.now();
while (Date.now() - t0 < 120000) {
  const h = await health();
  if (!h.demoRunning && h.actions >= 30) break;
  await sleep(500);
}
console.log('demo finished in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await sleep(1200);
await shot(page, '02_log_done');

// Expand the first stopped action's evidence.
const det = page.locator('#logList details summary').first();
await det.scrollIntoViewIfNeeded();
await det.click();
await sleep(2500);
await shot(page, '03_evidence');

// Today's briefing (with the 60s video panel).
await page.click('button[data-tab="today"]');
await sleep(3000);
await shot(page, '04_briefing');
await page.mouse.wheel(0, 500);
await sleep(2200);

// Approvals — say no to the first held delete.
await page.click('button[data-tab="queue"]');
await sleep(2500);
await shot(page, '05_queue');
const deny = page.locator('.btn-deny').first();
if (await deny.count()) { await deny.click(); await sleep(2000); }
await shot(page, '06_denied');

// Fact-check.
await page.click('button[data-tab="facts"]');
await sleep(3200);
await shot(page, '07_facts');

// Lineage.
await page.click('button[data-tab="lineage"]');
await sleep(3000);
await shot(page, '08_lineage');

// Scorecard.
await page.click('button[data-tab="score"]');
await sleep(3500);
await shot(page, '09_score');
await page.mouse.wheel(0, 420);
await sleep(2200);
await shot(page, '10_score_grid');

await sleep(600);
const video = await page.video().path();
await context.close();
await browser.close();
console.log('VIDEO:' + video);