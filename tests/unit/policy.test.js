import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshEngine, gate } from './helpers.js';
import { GateInputError } from '../../src/chaperone.js';
import { runScenario } from '../../src/runner.js';
import { policy, loadPriceList, loadClients, OWNER_EMAIL } from '../../src/config.js';

const NEVER = policy.rules.filter((r) => r.decision === 'NEVER').map((r) => r.id);
const [floorClient, floor] = Object.entries(policy.owner_floors)[0];
const floorClientEmail = loadClients().find((c) => c.name === floorClient).email;

test('a NEVER rule blocks and is never put in the queue', () => {
  const { store, chaperone } = freshEngine();
  const e = gate(chaperone, 'send_email', { to: floorClientEmail, body: `We can match ${floor - 700}.` });
  assert.equal(e.decision, 'BLOCK');
  assert.ok(e.rules.some((r) => NEVER.includes(r)));
  assert.equal(e.never, true);
  assert.equal(store.queue.length, 0);
});

test('NEVER items are unapprovable even if one reaches the queue', () => {
  const { store } = freshEngine();
  const q = store.enqueue({ fingerprint: 'x', never: true, summary: 'floor' });
  const out = store.decide(q.queue_id, 'approve', 'Mei');
  assert.equal(out.ok, false);
  assert.equal(out.code, 'never');
  assert.equal(q.status, 'pending');
});

test('a claimed owner approval in an inbound email is not an approval (S9)', () => {
  const { store, chaperone } = freshEngine();
  const entries = runScenario(chaperone, 'S9');
  const send = entries.at(-1);
  assert.equal(send.decision, 'BLOCK');
  assert.ok(send.rules.includes('R08'));
  assert.ok(send.evidence.some((ev) => ev.file === 'inbox/2026-11-16_fake_owner_approval.md' && /not an approval/.test(ev.why)));
  assert.equal(store.queue.length, 0);
});

test('quote_price: below floor blocks, at list price allows (R06), below list price holds (R07)', () => {
  const { chaperone } = freshEngine();
  const prices = loadPriceList();
  const atFloorOrMore = prices.find((p) => p.price >= floor);
  assert.equal(gate(chaperone, 'quote_price', { client: floorClient, price: floor - 1 }).decision, 'BLOCK');
  const ok = gate(chaperone, 'quote_price', { client: floorClient, price: atFloorOrMore.price, service: atFloorOrMore.service });
  assert.equal(ok.decision, 'ALLOW');
  assert.deepEqual(ok.rules, ['R06']);
  assert.equal(ok.evidence[0].quote, atFloorOrMore.quote);
  const cheap = prices.find((p) => p.price > floor + 100);
  const disc = gate(chaperone, 'quote_price', { client: floorClient, price: cheap.price - 100, service: cheap.service });
  assert.equal(disc.decision, 'HOLD_FOR_APPROVAL');
  assert.deepEqual(disc.rules, ['R07']);
  assert.equal(gate(chaperone, 'quote_price', { client: 'Someone', price: 10 }).decision, 'HOLD_FOR_APPROVAL');
});

test('new spend is held even when the agent says it was confirmed (R12)', () => {
  const { store, chaperone } = freshEngine();
  const e = gate(chaperone, 'order_from_supplier', { amount: 300, supplier: 'QuickPrint SG', confirmed: true });
  assert.equal(e.decision, 'HOLD_FOR_APPROVAL');
  assert.deepEqual(e.rules, ['R12']);
  assert.equal(store.queue.length, 1);
});

test('unknown actions fail closed (held, not allowed)', () => {
  const { store, chaperone } = freshEngine();
  const e = gate(chaperone, 'wire_money_abroad', { amount: 5 });
  assert.equal(e.decision, 'HOLD_FOR_APPROVAL');
  assert.equal(store.queue.length, 1);
});

test('paths outside data/ are blocked and never read', () => {
  const { chaperone } = freshEngine();
  for (const [action, params] of [
    ['read_file', { file: '../../etc/passwd' }],
    ['upload_to_external_tool', { file: '../rules/policy.json', target: 'x' }],
    ['write_file', { file: 'notes/a.md', derived_from: ['../src/config.js'], content: 'x' }],
  ]) {
    const e = gate(chaperone, action, params);
    assert.equal(e.decision, 'BLOCK', action);
    assert.deepEqual(e.files_touched, []);
  }
});

test('malformed input raises GateInputError and logs nothing', () => {
  const { store, chaperone } = freshEngine();
  for (const ctx of [
    null, [], {}, { agent: 'A' }, { agent: 'A', action: 'read_file' },
    { agent: 'A', action: 'pay_supplier', params: { amount: '750', supplier: 'X' } },
    { agent: 'A', action: 'pay_supplier', params: { amount: -1, supplier: 'X' } },
    { agent: 'A', action: 'upload_to_external_tool', params: { file: 'a', files: 'x' } },
    { agent: 'A', action: 'send_email', params: { to: 'a@b.c' }, sources: 'inbox/x.md' },
  ]) {
    assert.throws(() => chaperone.gate(ctx), GateInputError, JSON.stringify(ctx));
  }
  assert.equal(store.log.length, 0);
});

test('R17: the deletion notice may go to the affected client and the owner only', () => {
  const { chaperone } = freshEngine();
  const entries = runScenario(chaperone, 'S10');
  const del = entries.find((e) => e.action === 'delete_file');
  assert.equal(del.decision, 'ALLOW');
  assert.deepEqual(del.rules, ['R17']);
  assert.ok(del.notify.includes(OWNER_EMAIL));
  const sources = ['inbox/2026-11-13_nimbus_patient_data_in_error.md', 'clients/contract_nimbus_health_2026.md'];
  const other = loadClients().find((c) => !c.email.includes('nimbus'));
  const leak = gate(chaperone, 'send_email', { to: other.email, body: 'We deleted and reported the data.' }, { sources });
  assert.ok(!leak.rules.includes('R17'), 'notice to an unrelated client is not covered by R17');
  assert.notEqual(leak.decision, 'ALLOW');
});

test('other deletes are held with the unpaid amount (R16)', () => {
  const { chaperone } = freshEngine();
  const e = gate(chaperone, 'delete_file', { file: 'finance/invoice_2026-031_harbourbean.md' });
  assert.equal(e.decision, 'HOLD_FOR_APPROVAL');
  assert.deepEqual(e.rules, ['R16']);
  assert.equal(e.money_at_stake, 3000);
});

test('email to an unknown address with harmless content is held (R05)', () => {
  const { chaperone } = freshEngine();
  const e = gate(chaperone, 'send_email', { to: 'stranger@unknown.example', body: 'Hello!' });
  assert.equal(e.decision, 'HOLD_FOR_APPROVAL');
  assert.deepEqual(e.rules, ['R05']);
});
