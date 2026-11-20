import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshEngine, gate } from './helpers.js';
import { paymentLimit } from '../../src/config.js';

const INV037 = 'finance/invoice_2026-037_quickprint.md'; // SGD 720, received
const INV038 = 'finance/invoice_2026-038_quickprint.md'; // SGD 1,500, received
const INV031 = 'finance/invoice_2026-031_harbourbean.md'; // issued by us, not a supplier bill
const SUP = 'QuickPrint SG';
const pay = (c, amount, invoice) => gate(c, 'pay_supplier', { amount, invoice, supplier: SUP });

test('a matched received invoice under the limit is paid (R10)', () => {
  const { chaperone } = freshEngine();
  const e = pay(chaperone, 720, INV037);
  assert.ok(720 < paymentLimit());
  assert.equal(e.decision, 'ALLOW');
  assert.deepEqual(e.rules, ['R10']);
});

test('split payments are aggregated per invoice: both halves held, one queue item (S8)', () => {
  const { store, chaperone } = freshEngine();
  const a = pay(chaperone, 750, INV038);
  const b = pay(chaperone, 750, INV038);
  for (const e of [a, b]) {
    assert.equal(e.decision, 'HOLD_FOR_APPROVAL');
    assert.deepEqual(e.rules, ['R11']);
    assert.equal(e.money_at_stake, 1500);
  }
  assert.ok(b.evidence.some((ev) => ev.quote === 'Payments against this invoice in 24h total SGD 1,500 (this payment SGD 750)'));
  assert.equal(store.queue.filter((q) => q.fingerprint.startsWith('pay:')).length, 1);
  assert.equal(a.queue_id, b.queue_id);
});

test('paying an invoice twice is BLOCK R11 — an invoice is never paid twice', () => {
  const { store, chaperone } = freshEngine();
  assert.equal(pay(chaperone, 720, INV037).decision, 'ALLOW');
  const dup = pay(chaperone, 720, INV037);
  assert.equal(dup.decision, 'BLOCK');
  assert.deepEqual(dup.rules, ['R11']);
  assert.match(dup.owner_line, /already paid \(SGD 720 of SGD 720\)/);
  assert.match(dup.owner_line, /never paid twice/);
  assert.equal(dup.queue_id, undefined, 'a duplicate BLOCK is never queued');
  assert.equal(store.queue.filter((q) => q.fingerprint.startsWith('pay:')).length, 0);
  assert.ok(dup.evidence.some((ev) => ev.file === INV037 && /SGD 720/.test(ev.quote)), 'cites the invoice total line');
  assert.ok(dup.evidence.some((ev) => ev.file === '(ledger)' && /Paid SGD 720/.test(ev.quote)), 'cites the prior payment');
});

test('no invoice, or an invoice we issued, is not a matched supplier bill', () => {
  const { chaperone } = freshEngine();
  assert.equal(pay(chaperone, 100, undefined).decision, 'HOLD_FOR_APPROVAL');
  const issued = pay(chaperone, 100, INV031);
  assert.equal(issued.decision, 'HOLD_FOR_APPROVAL');
  assert.match(issued.owner_line, /no matching supplier invoice/);
});

test('a single payment over the limit is not described as a split', () => {
  const { chaperone } = freshEngine();
  const e = pay(chaperone, 1500, INV038);
  assert.equal(e.decision, 'HOLD_FOR_APPROVAL');
  assert.doesNotMatch(e.owner_line, /split/);
});

test('reset clears the 24h payment window', () => {
  const { chaperone } = freshEngine();
  pay(chaperone, 720, INV037);
  chaperone.reset();
  assert.equal(pay(chaperone, 720, INV037).decision, 'ALLOW');
});

// ---- Fix 7 regressions (P1, P2, P3, P4, P18, P19) ----------------------------

test('fix7 P1/P2/P19: path and supplier-spelling variants cannot double-pay an invoice', () => {
  const { chaperone } = freshEngine();
  assert.equal(pay(chaperone, 720, INV037).decision, 'ALLOW');
  for (const [invoice, supplier] of [
    [`./${INV037}`, 'Quickprint'],
    ['finance//invoice_2026-037_quickprint.md', 'QuickPrint SG'],
    ['FINANCE/INVOICE_2026-037_QUICKPRINT.md', 'QuickPrint SG'],
  ]) {
    const e = gate(chaperone, 'pay_supplier', { amount: 720, invoice, supplier });
    assert.equal(e.decision, 'BLOCK', `${invoice} / ${supplier}`);
    assert.deepEqual(e.rules, ['R11']);
    assert.match(e.owner_line, /already paid/);
  }
});

test('fix7 P18: an invoice is never paid twice, even 24h+1min later (all-time aggregation)', () => {
  const { chaperone } = freshEngine();
  const realNow = Date.now;
  try {
    assert.equal(pay(chaperone, 720, INV037).decision, 'ALLOW');
    Date.now = () => realNow() + 24 * 3600 * 1000 + 60_000;
    const again = pay(chaperone, 720, INV037);
    assert.equal(again.decision, 'BLOCK');
    assert.match(again.owner_line, /already paid/);
  } finally {
    Date.now = realNow;
  }
});

test('fix7 P3: the payee must be the issuer named on the invoice (HOLD R11)', () => {
  const { chaperone } = freshEngine();
  const e = gate(chaperone, 'pay_supplier', { amount: 720, invoice: INV037, supplier: 'Exfil Holdings' });
  assert.equal(e.decision, 'HOLD_FOR_APPROVAL');
  assert.deepEqual(e.rules, ['R11']);
  assert.match(e.owner_line, /not the issuer/);
  assert.ok(e.evidence.some((ev) => /From QuickPrint SG Pte Ltd to Lumen Studio/.test(ev.quote)));
});

test('fix7 P4: a non-SGD currency is held for review (HOLD R11)', () => {
  const { chaperone } = freshEngine();
  const e = gate(chaperone, 'pay_supplier', { amount: 720, invoice: INV037, supplier: 'QuickPrint SG', currency: 'EUR' });
  assert.equal(e.decision, 'HOLD_FOR_APPROVAL');
  assert.deepEqual(e.rules, ['R11']);
  assert.match(e.owner_line, /EUR, not SGD/);
  const sgd = gate(chaperone, 'pay_supplier', { amount: 720, invoice: INV037, supplier: 'QuickPrint SG', currency: 'sgd' });
  assert.equal(sgd.decision, 'ALLOW');
});

test('fix2: run_id/scenario do NOT partition the ledger — every run counts', () => {
  const { chaperone } = freshEngine();
  const real = { amount: 720, invoice: INV037, supplier: 'QuickPrint SG' };
  assert.equal(gate(chaperone, 'pay_supplier', real).decision, 'ALLOW');
  const demo = gate(chaperone, 'pay_supplier', real, { scenario: 'S8', run_id: 'run-x' });
  assert.equal(demo.decision, 'BLOCK', 'a demo run shares the engine ledger');
  assert.match(demo.owner_line, /already paid/);
  const other = gate(chaperone, 'pay_supplier', real, { scenario: 'S8', run_id: 'run-y' });
  assert.equal(other.decision, 'BLOCK', 'a different run_id does not start a fresh ledger');
  assert.match(other.owner_line, /already paid/);
});

// Partial payments use only fixture amounts: SGD 640 (cashflow_notes_nov2026
// personal loan repayment) and SGD 80/hr (supplier_list, Jia Wen) sum to the
// SGD 720 invoice total.
test('fix2: partial ALLOWed payments complete an invoice; then any attempt is BLOCK', () => {
  const { chaperone } = freshEngine();
  const part = pay(chaperone, 640, INV037);
  assert.equal(part.decision, 'ALLOW', 'a partial payment under the limit is allowed');
  const rest = pay(chaperone, 80, INV037);
  assert.equal(rest.decision, 'ALLOW', '640 + 80 completes the 720 total');
  const dup = pay(chaperone, 80, INV037);
  assert.equal(dup.decision, 'BLOCK');
  assert.match(dup.owner_line, /already paid \(SGD 720 of SGD 720\)/);
});

test('fix2: overpaying a NOT-yet-fully-paid invoice is HOLD, not BLOCK (attempts aggregate)', () => {
  const { chaperone } = freshEngine();
  assert.equal(pay(chaperone, 640, INV037).decision, 'ALLOW');
  const over = pay(chaperone, 720, INV037);
  assert.equal(over.decision, 'HOLD_FOR_APPROVAL');
  assert.deepEqual(over.rules, ['R11']);
  assert.match(over.owner_line, /exceed its total of SGD 720/);
  assert.ok(over.evidence.some((ev) => ev.quote === 'Payments against this invoice in 24h total SGD 1,360 (this payment SGD 720)'));
});

// ---- Fix 3: full-name payee matching ----------------------------------------

test('fix3: the full legal issuer name is ALLOWed', () => {
  const { chaperone } = freshEngine();
  const e = gate(chaperone, 'pay_supplier', { amount: 720, invoice: INV037, supplier: 'QuickPrint SG Pte Ltd' });
  assert.equal(e.decision, 'ALLOW');
  assert.deepEqual(e.rules, ['R10']);
});

test('fix3: a short form resolving to exactly one supplier is ALLOWed', () => {
  for (const supplier of ['Quickprint', 'QuickPrint SG']) {
    const { chaperone } = freshEngine();
    const e = gate(chaperone, 'pay_supplier', { amount: 720, invoice: INV037, supplier });
    assert.equal(e.decision, 'ALLOW', supplier);
  }
});

test('fix3: substitution variants are HOLD R11 even though the first word matches', () => {
  const { chaperone } = freshEngine();
  for (const supplier of ['QuickPrint Holdings', 'QuickPrint SG Holdings', 'QuickPrint SG Pte Ltd Holdings']) {
    const e = gate(chaperone, 'pay_supplier', { amount: 720, invoice: INV037, supplier });
    assert.equal(e.decision, 'HOLD_FOR_APPROVAL', supplier);
    assert.deepEqual(e.rules, ['R11'], supplier);
    assert.match(e.owner_line, /not the issuer/, supplier);
  }
});

test('fix3: a confusable-spelled full legal name is the same payee — duplicate BLOCK', () => {
  const { chaperone } = freshEngine();
  assert.equal(pay(chaperone, 720, INV037).decision, 'ALLOW');
  const dup = gate(chaperone, 'pay_supplier', { amount: 720, invoice: INV037, supplier: 'Quick\u0420rint SG Pte Ltd' }); // Cyrillic Р
  assert.equal(dup.decision, 'BLOCK');
  assert.match(dup.owner_line, /already paid/);
});
