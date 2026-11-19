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
