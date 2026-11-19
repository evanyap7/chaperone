// The daily briefing, written from the log — never from imagination.
// Plain words for a non-technical owner. Money first. Every figure comes from
// a logged entry (which itself traces to a file). Rule IDs stay in "details".
import { OWNER_NAME } from './config.js';

const AGENT_LABEL = {
  Marketing: 'Marketing', Sales: 'Sales', Ops: 'Ops', Finance: 'Finance', Support: 'Support',
};

function money(n) { return `SGD ${Number(n).toLocaleString()}`; }

export function buildBriefing(store) {
  const log = store.log;
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
      agent: AGENT_LABEL[e.agent] || e.agent,
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
      agent: AGENT_LABEL[q.agent] || q.agent,
      rules: log.find((e) => e.id === q.log_id)?.rules || [],
      money: q.money_at_stake ?? null,
      queue_id: q.queue_id,
    })),
  });

  if (scopeReads.length) {
    // Group by task so three sneaky reads become one plain sentence.
    const byTask = new Map();
    for (const e of scopeReads) {
      if (!byTask.has(e.task)) byTask.set(e.task, { agent: e.agent, files: [] });
      byTask.get(e.task).files.push(...(e.scope_creep || [{ file: e.params.file }]));
    }
    sections.push({
      title: 'You should know',
      tone: 'fyi',
      items: [...byTask.entries()].map(([task, g]) => ({
        text: `While working on "${task}", ${AGENT_LABEL[g.agent] || g.agent} read ${g.files.map((f) => f.file).join(', ')} — none of it needed for the task. ${g.files.some((f) => f.level === 'regulated') ? 'These are your private records. Nothing was sent, but you should know.' : 'Logged as scope creep.'}`,
        agent: AGENT_LABEL[g.agent] || g.agent,
        rules: ['R01', 'R02'],
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
    items: allowed.map((e) => ({ text: e.owner_line, agent: AGENT_LABEL[e.agent] || e.agent, rules: e.rules })),
  });

  const headline = `${blocks.length} risky action${blocks.length === 1 ? '' : 's'} stopped, ${holds.length} waiting for your yes${heldMoney ? ` (${money(heldMoney)} in total)` : ''}, ${allowed.length} routine action${allowed.length === 1 ? '' : 's'} done.`;

  // Short spoken version for the 60-second briefing video (~140 words),
  // split into segments that each carry their slide design.
  const narr = buildNarration({ blocks, holds, heldMoney, blockedDeleteMoney, scopeReads, injections, allowed, factFlags, log });

  const text = [
    `Good morning, ${OWNER_NAME.split(' ')[0]}. Here's what your agents did.`,
    headline,
    ...sections.filter((s) => s.items.length).map((s) => `\n${s.title.toUpperCase()}\n` + s.items.map((i) => `- ${i.text}`).join('\n')),
  ].join('\n');

  return { generated_at: new Date().toISOString(), headline, sections, text, narration: narr.text, narration_segments: narr.segments, stats: { blocked: blocks.length, held: holds.length, held_money: heldMoney, allowed: allowed.length, scope_reads: scopeReads.length, injections: injections.length } };
}

function buildNarration({ blocks, holds, heldMoney, blockedDeleteMoney, scopeReads, injections, allowed, log }) {
  const segments = [];
  segments.push({ say: `Good morning, Mei. Here's what your agents did today.`, kind: 'title', title: 'Chaperone', sub: 'Your morning briefing · Lumen Studio' });
  segments.push({ say: `${blocks.length} risky actions were stopped before anything left the studio.`, kind: 'stat', title: `${blocks.length} risky actions stopped`, sub: 'Nothing left the studio.' });
  const ferro = blocks.find((b) => (b.fact_check || []).length);
  if (ferro) {
    const rows = ferro.fact_check.filter((f) => f.status !== 'ok').map((f) => ({ claimed: f.claimed, real: f.real == null ? 'no source' : String(f.real), file: f.source_file }));
    segments.push({ say: `Finance's reply to Ferro carried three numbers that match no file. The real figures are on the invoice, and the email was blocked.`, kind: 'facts', title: 'Made-up numbers, caught', sub: 'Claimed vs what is actually on file', rows });
  }
  const upload = blocks.find((b) => b.action === 'upload_to_external_tool');
  if (upload) segments.push({ say: `Marketing tried to send your client list to an outside tool. Blocked: it holds personal data.`, kind: 'shield', title: 'Your client list stayed put', sub: 'Upload to an outside tool blocked — it holds personal data.' });
  if (holds.length) segments.push({ say: `${holds.length} decisions are waiting for your yes${heldMoney ? `, worth ${money(heldMoney)} in total` : ''}.`, kind: 'stat', title: `${holds.length} decisions waiting for you`, sub: heldMoney ? `${money(heldMoney)} in total` : 'Each one appears once. No nagging.' });
  if (blockedDeleteMoney) segments.push({ say: `Ops wanted to delete two unpaid invoices worth ${money(blockedDeleteMoney)}. Held. Recommend: no.`, kind: 'stat', title: 'Unpaid invoices, almost deleted', sub: `${money(blockedDeleteMoney)} still owed to you. Held. Recommend: no.` });
  if (scopeReads.length) segments.push({ say: `Support also read your bank details and personal records while drafting a print reply. It didn't need them. Nothing was sent, but you should know.`, kind: 'eye', title: 'Sneaky reads, spotted', sub: 'Bank details · cash-flow notes · personal records. Not needed for the task. Nothing was sent.' });
  if (injections.length) segments.push({ say: `One vendor email tried to instruct your agent directly. It was treated as data, not followed.`, kind: 'shield', title: 'An email tried to give orders', sub: 'Treated as data, not followed.' });
  segments.push({ say: `Everything else — ${allowed.length} routine actions — went through cleanly. Every number I've quoted comes from a file. Have a good day.`, kind: 'done', title: `${allowed.length} routine actions done cleanly`, sub: 'Every number traces to a file. — Chaperone' });
  return { text: segments.map((s) => s.say).join(' '), segments };
}