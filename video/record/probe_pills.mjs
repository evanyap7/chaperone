// Reproduce + verify the long-agent-name pill layout fix. Seeds the REAL owner
// store with a long agent name, signs in as owner, and checks that the agent
// pill never overlaps the description column and no empty pills render.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.resolve(HERE, '../work_footage/pill_probe');
const PORT = 8151;
const TOKEN = 'probe-token';
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const dirs = fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const d of dirs) {
    const p = path.join(cache, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('no chromium');
}

const server = spawn('node', ['src/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), OWNER_TOKEN: TOKEN }, stdio: ['ignore', 'pipe', 'pipe'] });
async function gate(body) {
  const r = await fetch(`${BASE}/api/gate`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

try {
  for (let i = 0; i < 60; i++) { try { const h = await (await fetch(`${BASE}/api/health`)).json(); if (h.ok) break; } catch {} await sleep(250); }
  const A = 'Sales (live QwenWork agent)';
  await gate({ agent: A, action: 'list_dir', params: { dir: 'finance/' }, task: 'probe' });
  await gate({ agent: A, action: 'read_file', params: { file: 'admin/client_list.csv' }, task: 'probe' });
  await gate({ agent: A, action: 'pay_supplier', params: { amount: 750, invoice: 'finance/invoice_2026-038_quickprint.md', supplier: 'QuickPrint SG' }, task: 'pay the QuickPrint invoice', sources: ['finance/invoice_2026-038_quickprint.md'] });

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
  let bad = 0;
  for (const width of [1280, 1000, 820, 375]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?owner=${TOKEN}`, { waitUntil: 'load' });
    await sleep(800);
    await page.click('button[data-tab="log"]');
    await sleep(500);
    const info = await page.evaluate(() => {
      const out = [];
      for (const row of document.querySelectorAll('#logList .row')) {
        const pill = row.querySelector(':scope > summary .pill-agent');
        const act = row.querySelector(':scope > summary .row-action');
        if (!pill) { out.push({ emptyPillAbsent: true }); continue; }
        const pr = pill.getBoundingClientRect(), ar = act.getBoundingClientRect();
        const sameRow = pr.y < ar.y + ar.height && pr.y + pr.height > ar.y;
        out.push({ text: pill.textContent, pillRight: pr.right, actionX: ar.x, overlap: sameRow && pr.right > ar.x + 1, empty: !pill.textContent.trim() });
      }
      return out;
    });
    for (const e of info) { if (e.overlap || e.empty) bad++; }
    console.log(`width=${width} log:`, JSON.stringify(info));
    await page.locator('#logList').screenshot({ path: path.join(OUT, `fixed_log_${width}.png`) });
    await page.click('button[data-tab="queue"]');
    await sleep(500);
    const qempty = await page.evaluate(() => [...document.querySelectorAll('#queueList .pill')].filter((p) => !p.textContent.trim()).length);
    if (qempty) bad++;
    console.log(`width=${width} queue empty pills:`, qempty);
    await page.locator('#queueList').screenshot({ path: path.join(OUT, `fixed_queue_${width}.png`) });
    await ctx.close();
  }
  await browser.close();
  console.log(bad === 0 ? 'PILL FIX OK: no overlaps, no empty pills' : `PILL FIX FAILED: ${bad} problems`);
  process.exitCode = bad === 0 ? 0 : 1;
} finally {
  server.kill('SIGTERM');
  await sleep(500);
  if (server.exitCode === null) server.kill('SIGKILL');
}