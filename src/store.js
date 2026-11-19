// Append-only action log + approval queue. The queue shows each held item once
// (dedup by fingerprint) so the owner is never nagged twice. NEVER-rule decisions
// are never enqueued and can never be approved by anyone.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { LOGS_DIR } from './config.js';

export class Store extends EventEmitter {
  constructor(logName = 'actions.jsonl') {
    super();
    this.logName = logName;
    this.log = [];
    this.queue = [];
    this.seq = 0;
    this.scenarioResults = [];
    this.classifierReport = null;
    this.briefing = null;
    this.videoUrl = null;
  }

  reset() {
    this.log = [];
    this.queue = [];
    this.seq = 0;
    this.scenarioResults = [];
    this.briefing = null;
    this.emit('reset');
  }

  append(entry) {
    entry.id = ++this.seq;
    entry.ts = entry.ts || new Date().toISOString();
    this.log.push(entry);
    this.emit('action', entry);
    this.persist(entry);
    return entry;
  }

  persist(entry) {
    try {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
      fs.appendFileSync(path.join(LOGS_DIR, this.logName), JSON.stringify(entry) + '\n');
    } catch { /* logging must never break the gate */ }
  }

  // Enqueue a held item once. Fingerprint = agent + action + canonical target.
  enqueue(item) {
    const fp = item.fingerprint;
    if (this.queue.some((q) => q.fingerprint === fp)) {
      return this.queue.find((q) => q.fingerprint === fp); // already queued; no nag
    }
    const q = {
      queue_id: `Q${this.queue.length + 1}`,
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
    if (!q) return { ok: false, error: 'not found' };
    if (q.never) return { ok: false, error: 'This is a NEVER rule. It cannot be approved by anyone.' };
    if (q.status !== 'pending') return { ok: false, error: 'already decided' };
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