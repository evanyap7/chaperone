// The daily briefing, written from the log — never from imagination.
// Plain words for a non-technical owner. Money first. Every figure comes from
// a logged entry (which itself traces to a file). Rule IDs stay in "details".
import { OWNER_FIRST_NAME } from './config.js';
import { buildNarration } from './narration.js';

// Fixed locale so the same log always gives the same text, whatever the host.
function money(n) { return `SGD ${Number(n).toLocaleString('en-US')}`; }

export function buildBriefing(store) {
  // The briefing covers real agent actions plus the latest demo run. The log
  // itself is append-only and keeps every earlier run.
  const log = store.log.filter((e) => !e.scenario || e.run_id === store.lastRunId);
  const blocks = log.filter((e) => e.decision === 'BLOCK' && e.action !== 'read_file');
  const scopeReads = log.filter((e) => e.action === 'read_file' && (e.scope_creep?.length || e.decision === 'BLOCK'));
  const holds = store.queue.filter((q) => q.status === 'pending');
  const allowed = log.filter((e) => e.decision === 'ALLOW');
  const injections = log.filter((e) => e.injection?.flagged);
  const factFlags = log.filter((e) => (e.fact_check || []).some((f) => f.status !== 'ok'));

  const heldMoney = holds.reduce((a, q) => a + (q.money_at_stake || 0), 0);
  const blockedDeleteMoney = log
    .filter((e) => e.action === 'delete_file' && e.decision === 'HOLD_FOR_APPROVAL')
    .reduce((a, e) => a + (e.money_at_stake || 0), 0);

  const sections = [];

  sections.push({
    title: 'Stopped before anything went out',
    tone: 'stopped',
    items: blocks.map((e) => ({
      text: e.owner_line,
      agent: e.agent,
      rules: e.rules,
      evidence: e.evidence,
      fact_check: e.fact_check,
      money: e.money_at_stake ?? null,
    })),
  });

  sections.push({
    title: 'Waiting for your yes',
    tone: 'waiting',
    items: holds.map((q) => ({
      text: q.summary + (q.recommendation === 'deny' ? ' Recommend: no.' : ''),
      agent: q.agent,
      rules: log.find((e) => e.id === q.log_id)?.rules || [],
      money: q.money_at_stake ?? null,
      queue_id: q.queue_id,
    })),
  });

  if (scopeReads.length) {
    // Group by task so three sneaky reads become one plain sentence.
    const byTask = new Map();
    for (const e of scopeReads) {
      if (!byTask.has(e.task)) byTask.set(e.task, { agent: e.agent, files: [], rules: new Set() });
      const g = byTask.get(e.task);
      g.files.push(...(e.scope_creep || [{ file: e.params.file }]));
      for (const r of e.rules || []) g.rules.add(r);
    }
    sections.push({
      title: 'You should know',
      tone: 'fyi',
      items: [...byTask.entries()].map(([task, g]) => ({
        text: `While working on "${task}", ${g.agent} read ${g.files.map((f) => f.file).join(', ')} — none of it needed for the task. ${g.files.some((f) => f.level === 'regulated') ? 'These are your private records. Nothing was sent, but you should know.' : 'Logged as scope creep.'}`,
        agent: g.agent,
        rules: [...g.rules].sort(),
        files: g.files,
      })),
    });
  }

  if (injections.length) {
    sections.push({
      title: 'Inbound messages tried to give instructions',
      tone: 'fyi',
      items: injections.map((e) => ({
        text: `A message in ${e.injection.file} addressed your AI agent directly and told it to move data. It was treated as data, not followed.`,
        quote: e.injection.quote,
        rules: [],
      })),
    });
  }

  sections.push({
    title: 'Done without asking',
    tone: 'done',
    items: allowed.map((e) => ({ text: e.owner_line, agent: e.agent, rules: e.rules })),
  });

  const headline = `${blocks.length} risky action${blocks.length === 1 ? '' : 's'} stopped, ${holds.length} waiting for your yes${heldMoney ? ` (${money(heldMoney)} in total)` : ''}, ${allowed.length} routine action${allowed.length === 1 ? '' : 's'} done.`;

  // Short spoken version for the 60-second briefing video (~140 words),
  // split into segments that each carry their slide design.
  const narr = buildNarration({ blocks, holds, heldMoney, blockedDeleteMoney, scopeReads, injections, allowed, factFlags, log });

  const text = [
    `Good morning, ${OWNER_FIRST_NAME}. Here's what your agents did.`,
    headline,
    ...sections.filter((s) => s.items.length).map((s) => `\n${s.title.toUpperCase()}\n` + s.items.map((i) => `- ${i.text}`).join('\n')),
  ].join('\n');

  return { generated_at: new Date().toISOString(), headline, sections, text, narration: narr.text, narration_segments: narr.segments, stats: { blocked: blocks.length, held: holds.length, held_money: heldMoney, allowed: allowed.length, scope_reads: scopeReads.length, injections: injections.length } };
}
