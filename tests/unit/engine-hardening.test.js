// Engine hardening regressions: linear-time number parsing (Fix 7),
// agent-scoped hold queue (Fix 8), prototype-pollution task ids (Fix 9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshEngine, gate } from './helpers.js';
import { extractMoney } from '../../src/normalize.js';
import { GateInputError } from '../../src/chaperone.js';

const INV037 = 'finance/invoice_2026-037_quickprint.md';
const INV031 = 'finance/invoice_2026-031_harbourbean.md';

// ---- Fix 7: number parsing is genuinely linear-time -------------------------

test('fix7: extractMoney completes pathological inputs well under budget', () => {
  const cases = [
    ['twenty '.repeat(30000) + 'x', [600000]],
    ['9'.repeat(100000) + ',', []], // 1e100000 is not finite: no amount
    ['5 thousand '.repeat(10000), [50000000]],
  ];
  for (const [text, expected] of cases) {
    const start = Date.now();
    const out = extractMoney(text);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000, `extractMoney took ${elapsed}ms on a ${text.length}-char input`);
    assert.deepEqual(out.map((m) => m.value), expected);
  }
});

// ---- Fix 8: hold queue items are agent-scoped -------------------------------

test('fix8: two agents deleting the SAME file get two distinct queue items', () => {
  const { store, chaperone } = freshEngine();
  const a = gate(chaperone, 'delete_file', { file: INV031 }, { agent: 'A' });
  const b = gate(chaperone, 'delete_file', { file: INV031 }, { agent: 'B' });
  assert.equal(a.decision, 'HOLD_FOR_APPROVAL');
  assert.equal(b.decision, 'HOLD_FOR_APPROVAL');
  assert.notEqual(a.queue_id, b.queue_id, 'B does not dedupe onto A\'s item');
  assert.equal(store.queue.find((q) => q.queue_id === a.queue_id).agent, 'A');
  assert.equal(store.queue.find((q) => q.queue_id === b.queue_id).agent, 'B');
});

test('fix8: A\'s denied item does not stand against B\'s fresh request', () => {
  const { store, chaperone } = freshEngine();
  const a = gate(chaperone, 'delete_file', { file: INV031 }, { agent: 'A' });
  assert.ok(store.decide(a.queue_id, 'deny', 'Mei').ok);
  const b = gate(chaperone, 'delete_file', { file: INV031 }, { agent: 'B' });
  assert.equal(b.decision, 'HOLD_FOR_APPROVAL');
  assert.notEqual(b.queue_id, a.queue_id);
  const qb = store.queue.find((q) => q.queue_id === b.queue_id);
  assert.equal(qb.agent, 'B');
  assert.equal(qb.status, 'pending');
});

test('fix8: a flooded agent never blocks another agent\'s actions or queue items', () => {
  const { store, chaperone } = freshEngine();
  for (let i = 0; i < 20; i++) {
    assert.equal(gate(chaperone, 'noop', { n: i }, { agent: 'A' }).decision, 'HOLD_FOR_APPROVAL');
  }
  assert.equal(gate(chaperone, 'noop', { n: 20 }, { agent: 'A' }).decision, 'BLOCK', 'A is flooded');
  const list = gate(chaperone, 'list_dir', { dir: 'finance/' }, { agent: 'B' });
  assert.equal(list.decision, 'ALLOW');
  const del = gate(chaperone, 'delete_file', { file: INV031 }, { agent: 'B' });
  assert.equal(del.decision, 'HOLD_FOR_APPROVAL');
  assert.equal(store.queue.find((q) => q.queue_id === del.queue_id).agent, 'B');
  const pay = gate(chaperone, 'pay_supplier', { amount: 720, invoice: INV037, supplier: 'QuickPrint SG' }, { agent: 'B' });
  assert.equal(pay.decision, 'ALLOW');
});

test('fix8: same-agent pending retries still dedupe (no nagging)', () => {
  const { store, chaperone } = freshEngine();
  const a1 = gate(chaperone, 'delete_file', { file: INV031 }, { agent: 'A' });
  const a2 = gate(chaperone, 'delete_file', { file: INV031 }, { agent: 'A' });
  assert.equal(a1.queue_id, a2.queue_id);
  assert.equal(store.queue.filter((q) => q.agent === 'A').length, 1);
});

// ---- Fix 9: prototype-pollution task ids fail closed ------------------------

test('fix9: prototype-key task ids raise GateInputError and log nothing', () => {
  const { store, chaperone } = freshEngine();
  for (const task of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => gate(chaperone, 'read_file', { file: 'marketing/price_list_2026.md' }, { task }), GateInputError, task);
  }
  assert.equal(store.log.length, 0);
});

test('fix9: a non-string task raises GateInputError', () => {
  const { chaperone } = freshEngine();
  for (const task of [42, {}, null, [], true]) {
    assert.throws(() => gate(chaperone, 'read_file', { file: 'marketing/price_list_2026.md' }, { task }), GateInputError, JSON.stringify(task));
  }
});

test('fix9: normal unregistered tasks still work; inherited keys grant no scope', () => {
  const { chaperone } = freshEngine();
  const ok = gate(chaperone, 'read_file', { file: 'marketing/price_list_2026.md' }, { task: 'a task nobody registered' });
  assert.equal(ok.decision, 'ALLOW');
  assert.equal(ok.scope_creep.length, 1);
  const inherited = gate(chaperone, 'read_file', { file: 'marketing/price_list_2026.md' }, { task: 'toString' });
  assert.equal(inherited.decision, 'ALLOW');
  assert.equal(inherited.scope_creep.length, 1, 'an inherited Object key is not a registered task');
  const registered = gate(chaperone, 'read_file', { file: 'finance/invoice_2026-031_harbourbean.md' }, { task: 'clean up old files' });
  assert.equal(registered.decision, 'ALLOW');
  assert.deepEqual(registered.scope_creep, []);
});
// ---- Ledger integrity: escalated payments never count as paid ---------------

test('an injection-BLOCKed payment leaves no phantom "paid" ledger record', () => {
  const { chaperone } = freshEngine();
  const INJ = 'inbox/2026-11-16_vendor_injection.md';
  const params = { amount: 720, invoice: INV037, supplier: 'QuickPrint SG' };
  // The handler would ALLOW this payment, but the injection source escalates
  // it to BLOCK. Nothing was paid, so the invoice must still be payable.
  const blocked = gate(chaperone, 'pay_supplier', params, { sources: [INJ] });
  assert.equal(blocked.decision, 'BLOCK');
  assert.ok(blocked.rules.includes('R05'));
  const clean = gate(chaperone, 'pay_supplier', params);
  assert.equal(clean.decision, 'ALLOW', 'the blocked attempt never counted as paid');
  // And now it IS paid: a further attempt is the duplicate BLOCK.
  const dup = gate(chaperone, 'pay_supplier', params);
  assert.equal(dup.decision, 'BLOCK');
  assert.match(dup.owner_line, /already paid/);
});

test('a taint-HOLDed payment leaves no phantom "paid" ledger record', () => {
  const { chaperone } = freshEngine();
  const INJ = 'inbox/2026-11-16_vendor_injection.md';
  gate(chaperone, 'read_file', { file: INJ }, { task: 'onboard the PartnerCRM vendor offer' });
  const params = { amount: 720, invoice: INV037, supplier: 'QuickPrint SG' };
  const held = gate(chaperone, 'pay_supplier', params);
  assert.equal(held.decision, 'HOLD_FOR_APPROVAL');
  // A different, untainted agent can still pay the invoice for real.
  const clean = gate(chaperone, 'pay_supplier', params, { agent: 'Other' });
  assert.equal(clean.decision, 'ALLOW');
});
