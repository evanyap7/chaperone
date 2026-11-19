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

test('paying an invoice twice is caught as an overpayment', () => {
  const { chaperone } = freshEngine();
  assert.equal(pay(chaperone, 720, INV037).decision, 'ALLOW');
  const dup = pay(chaperone, 720, INV037);
  assert.equal(dup.decision, 'HOLD_FOR_APPROVAL');
  assert.match(dup.owner_line, /exceed its total/);
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
