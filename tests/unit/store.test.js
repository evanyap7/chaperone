import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../src/store.js';
import { freshEngine, gate } from './helpers.js';

test('queue dedupes by fingerprint and returns the existing item', () => {
  const s = new Store(null);
  const events = [];
  s.on('queue', (q) => events.push(q.queue_id));
  const a = s.enqueue({ fingerprint: 'f1', summary: 'one' });
  const b = s.enqueue({ fingerprint: 'f1', summary: 'one again' });
  const c = s.enqueue({ fingerprint: 'f2', summary: 'two' });
  assert.equal(a, b);
  assert.equal(s.queue.length, 2);
  assert.deepEqual([a.queue_id, c.queue_id], ['Q1', 'Q2']);
  assert.deepEqual(events, ['Q1', 'Q2']);
});

test('a decided item is not re-queued when the agent retries', () => {
  const { store, chaperone } = freshEngine();
  const e1 = gate(chaperone, 'delete_file', { file: 'finance/invoice_2026-031_harbourbean.md' });
  store.decide(e1.queue_id, 'deny', 'Mei');
  const e2 = gate(chaperone, 'delete_file', { file: 'finance/invoice_2026-031_harbourbean.md' });
  assert.equal(e2.queue_id, e1.queue_id);
  assert.equal(store.queue.length, 1);
});

test('decide: approve/deny once; unknown, invalid and repeat decisions are refused with codes', () => {
  const s = new Store(null);
  const q = s.enqueue({ fingerprint: 'f' });
  assert.equal(s.decide('Q9', 'approve').code, 'not_found');
  assert.equal(s.decide(q.queue_id, 'maybe').code, 'invalid');
  const ok = s.decide(q.queue_id, 'approve', 'Mei');
  assert.equal(ok.ok, true);
  assert.equal(ok.queue.status, 'approved');
  assert.equal(ok.queue.decided_by, 'Mei');
  const again = s.decide(q.queue_id, 'deny');
  assert.equal(again.code, 'already_decided');
  assert.equal(q.status, 'approved');
});

test('append numbers entries and reset clears everything', () => {
  const s = new Store(null);
  const resets = [];
  s.on('reset', () => resets.push(1));
  assert.equal(s.append({ a: 1 }).id, 1);
  assert.equal(s.append({ a: 2 }).id, 2);
  s.enqueue({ fingerprint: 'x' });
  s.reset();
  assert.deepEqual([s.log.length, s.queue.length, resets.length], [0, 0, 1]);
  assert.equal(s.append({ a: 3 }).id, 1);
});

test('queue ids are not reused after a reset', () => {
  const s = new Store(null);
  const a = s.enqueue({ fingerprint: 'f1' });
  s.reset();
  const b = s.enqueue({ fingerprint: 'f1' });
  assert.notEqual(a.queue_id, b.queue_id);
});

// ---- Fix 9: approvals are single-use -----------------------------------------

test('fix9: an APPROVED item never releases a new request — a fresh pending item is created', () => {
  const s = new Store(null);
  const a = s.enqueue({ fingerprint: 'f1', summary: 'one' });
  s.decide(a.queue_id, 'approve', 'Mei');
  const b = s.enqueue({ fingerprint: 'f1', summary: 'one again' });
  assert.notEqual(a, b);
  assert.notEqual(a.queue_id, b.queue_id);
  assert.equal(b.status, 'pending');
  assert.equal(a.status, 'approved');
  assert.equal(s.queue.length, 2);
});

test('fix9: a denied item still stands (no re-queue), a pending item still dedupes', () => {
  const s = new Store(null);
  const a = s.enqueue({ fingerprint: 'f1' });
  s.decide(a.queue_id, 'deny', 'Mei');
  assert.equal(s.enqueue({ fingerprint: 'f1' }), a);
  const b = s.enqueue({ fingerprint: 'f2' });
  assert.equal(s.enqueue({ fingerprint: 'f2' }), b);
  assert.equal(s.queue.length, 2);
});

// ---- Fix 10: the log is append-only and hash-chained -------------------------

test('fix10: entries hash-chain; tampering or deletion breaks the chain at the right entry', () => {
  const s = new Store(null);
  s.append({ decision: 'ALLOW' });
  s.append({ decision: 'BLOCK' });
  s.append({ decision: 'HOLD_FOR_APPROVAL' });
  assert.deepEqual(s.verifyChain(), { ok: true, length: 3, broken_at: null });
  assert.equal(s.log[0].prev_hash, null);
  assert.equal(s.log[1].prev_hash, s.log[0].hash);
  s.log[1].decision = 'ALLOW'; // tamper
  assert.deepEqual(s.verifyChain(), { ok: false, length: 3, broken_at: 2 });
  s.log[1].decision = 'BLOCK'; // restore
  s.log.splice(0, 1); // delete the first entry
  assert.equal(s.verifyChain().ok, false);
});

test('fix10: queue_id is assigned before hashing, so it is covered by the chain', () => {
  const { store, chaperone } = freshEngine();
  const e = gate(chaperone, 'delete_file', { file: 'finance/invoice_2026-031_harbourbean.md' });
  assert.ok(e.queue_id);
  assert.equal(store.verifyChain().ok, true);
  const entry = store.log.find((x) => x.id === e.id);
  entry.queue_id = 'Q999';
  const v = store.verifyChain();
  assert.equal(v.ok, false);
  assert.equal(v.broken_at, e.id);
});
