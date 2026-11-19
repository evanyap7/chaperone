// Append-only action log + approval queue. Every entry is hash-chained to the
// previous one, so tampering or deletion is detectable. The queue shows each
// held item once (dedup by fingerprint) so the owner is never nagged twice.
// Approvals are single-use: an approved item never releases a new request.
// NEVER-rule decisions are never enqueued and can never be approved by anyone.
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LOGS_DIR } from './config.js';

export class Store extends EventEmitter {
  // logName: file under logs/ to append every decision to; null keeps the log
  // in memory only (tests).
  constructor(logName = 'actions.jsonl') {
    super();
    this.logName = logName;
    this.log = [];
    this.queue = [];
    this.seq = 0;
    this.lastHash = null;
    this.lastRunId = null;
    this.scenarioResults = [];
    this.classifierReport = null;
    this.briefing = null;
  }

  // In-process test isolation only. No HTTP route ever calls this: the audit
  // log is append-only from the outside.
  reset() {
    this.log = [];
    this.queue = [];
    this.seq = 0;
    this.lastHash = null;
    this.scenarioResults = [];
    this.briefing = null;
    this.emit('reset');
  }

  append(entry) {
    entry.id = ++this.seq;
    entry.ts = entry.ts || new Date().toISOString();
    entry.prev_hash = this.lastHash;
    const { hash, ...core } = entry;
    entry.hash = createHash('sha256').update((entry.prev_hash || 'GENESIS') + JSON.stringify(core)).digest('hex');
    this.lastHash = entry.hash;
    this.log.push(entry);
    this.emit('action', entry);
    this.persist(entry);
    return entry;
  }

  // Recompute the chain: every entry must hash to its recorded value and link
  // to the previous entry. Returns { ok, length, broken_at }.
  verifyChain() {
    let prev = null;
    for (let i = 0; i < this.log.length; i++) {
      const e = this.log[i];
      const { hash, ...core } = e;
      const expect = createHash('sha256').update((prev || 'GENESIS') + JSON.stringify(core)).digest('hex');
      if (e.prev_hash !== prev || e.hash !== expect) return { ok: false, length: this.log.length, broken_at: i + 1 };
      prev = e.hash;
    }
    return { ok: true, length: this.log.length, broken_at: null };
  }

  persist(entry) {
    if (!this.logName) return;
    try {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
      fs.appendFileSync(path.join(LOGS_DIR, this.logName), JSON.stringify(entry) + '\n');
    } catch { /* logging must never break the gate */ }
  }

  // Enqueue a held item once. Fingerprint = agent + action + canonical target.
  // Pending and denied items dedupe (no nagging; a denial stands). An APPROVED
  // item is single-use: a new request with the same fingerprint gets a fresh
  // pending item — the old approval never releases it.
  enqueue(item) {
    const fp = item.fingerprint;
    const existing = this.queue.find((q) => q.fingerprint === fp);
    if (existing && existing.status !== 'approved') {
      return existing; // already queued or already denied; no nag
    }
    const q = {
      // Never reset, so a stale decision from before a reset cannot land on a new item.
      queue_id: `Q${(this.qseq = (this.qseq || 0) + 1)}`,
      fingerprint: fp,
      status: 'pending',
      created_at: new Date().toISOString(),
      ...item,
    };
    this.queue.push(q);
    this.emit('queue', q);
    return q;
  }

  decide(queue_id, decision, by = 'owner') {
    const q = this.queue.find((x) => x.queue_id === queue_id);
    if (decision !== 'approve' && decision !== 'deny') return { ok: false, code: 'invalid', error: 'decision must be "approve" or "deny"' };
    if (!q) return { ok: false, code: 'not_found', error: 'not found' };
    if (q.never) return { ok: false, code: 'never', error: 'This is a NEVER rule. It cannot be approved by anyone.' };
    if (q.status !== 'pending') return { ok: false, code: 'already_decided', error: 'already decided', queue: q };
    q.status = decision === 'approve' ? 'approved' : 'denied';
    q.decided_by = by;
    q.decided_at = new Date().toISOString();
    this.emit('queue', q);
    return { ok: true, queue: q };
  }

  setScenarioResults(results) {
    this.scenarioResults = results;
    this.emit('scorecard', results);
  }
}

export const store = new Store();