// Spoken script for the 60-second briefing video. Each segment carries the
// line to say and the slide it sits on. Every count, amount and name below is
// derived from the log / queue passed in; nothing is typed in by hand.
// Written to be spoken to Mei, not read at her: money first, plain words,
// contractions, no rule IDs.
import { OWNER_FIRST_NAME, readDataFile } from './config.js';

// The business name, from the heading of data/00_README.md ("# Lumen Studio — ...").
function businessName() {
  try { return readDataFile('00_README.md').match(/^#\s*(.+?)\s+[—–-]\s/m)?.[1] ?? null; } catch { return null; }
}
const OUTWARD = new Set(['send_email', 'upload_to_external_tool', 'pay_supplier']);

function money(n) { return `SGD ${Number(n).toLocaleString('en-US')}`; }
// Spoken amount ("8,040 dollars"); the slide shows "SGD 8,040".
function dollars(n) { return `${Number(n).toLocaleString('en-US')} dollars`; }
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
function count(n) { return n >= 0 && n < WORDS.length ? WORDS[n] : String(n); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function plural(n, one, many) { return n === 1 ? one : many; }
function list(items) {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
const base = (file) => String(file || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '');
// "finance/cashflow_notes_nov2026.md" -> "cashflow notes" (drop dates/months/years).
function fileLabel(file) {
  return base(file).split(/[_-]+/)
    .filter((w) => w && !/\d/.test(w) && !/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i.test(w))
    .join(' ').toLowerCase();
}
// "draft a reply to QuickPrint about the reprint" -> "drafting a reply to QuickPrint"
function gerund(task) {
  const [verb, ...rest] = String(task).split(' ');
  const v = verb.toLowerCase();
  const ing = /[^aeiou]e$/.test(v) ? v.slice(0, -1) + 'ing' : v + 'ing';
  return [ing, ...rest].join(' ').replace(/\s+about\s.*$/, '');
}
// The value on file, spoken the way people correct a figure ("it said 25 percent; the contract says 20").
function realIn(real) {
  const n = Number(real);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : String(real);
}
function spoken(claimed) { return String(claimed).replace(/%$/, ' percent'); }
// Where a corrected figure lives, said the way a person would.
function sourceName(file) {
  const b = base(file).toLowerCase();
  if (b.includes('contract')) return 'the contract';
  if (b.includes('invoice')) return 'the invoice';
  if (file && String(file).startsWith('inbox/')) return 'their own email';
  return 'your files';
}
// A person's first name, only when the address's local part names someone the task mentions.
function personFrom(email, task) {
  const local = String(email || '').split('@')[0];
  if (!/^[a-z]+$/i.test(local)) return null;
  return new RegExp(`\\b${local}\\b`, 'i').test(String(task || '')) ? cap(local.toLowerCase()) : null;
}

export function buildNarration({ blocks, holds, heldMoney, blockedDeleteMoney, scopeReads, injections, allowed, log }) {
  const first = OWNER_FIRST_NAME;
  const biz = businessName();
  const segments = [];

  segments.push({
    say: `Morning, ${first}. Here's how your agents got on.`,
    kind: 'title', kicker: 'Good morning', title: 'Chaperone', sub: biz ? `Your morning briefing · ${biz}` : 'Your morning briefing',
  });

  // Money first: what's waiting on her, and how much it's worth.
  if (holds.length) {
    segments.push({
      say: `Money first. ${cap(count(holds.length))} ${plural(holds.length, 'thing needs', 'things need')} your okay${heldMoney ? `, worth ${dollars(heldMoney)} altogether` : ''}.`,
      kind: 'stat', kicker: 'Waiting for you',
      title: heldMoney ? `${money(heldMoney)} waiting for your yes` : `${holds.length} ${plural(holds.length, 'decision', 'decisions')} waiting for you`,
      sub: `${holds.length} ${plural(holds.length, 'decision', 'decisions')} in your queue. Each one appears once.`,
    });
  }

  const deletes = log.filter((e) => e.action === 'delete_file' && e.decision === 'HOLD_FOR_APPROVAL');
  if (blockedDeleteMoney && deletes.length) {
    const agent = deletes[0].agent;
    const allDeny = deletes.every((e) => holds.find((q) => q.queue_id === e.queue_id)?.recommendation === 'deny');
    const lead = holds.length && blockedDeleteMoney * 2 > heldMoney ? 'Most of that is' : 'Part of that is';
    segments.push({
      say: `${lead} ${count(deletes.length)} unpaid ${plural(deletes.length, 'invoice', 'invoices')} ${agent} wanted to delete: ${dollars(blockedDeleteMoney)} you're still owed.${allDeny ? ` I'd say no.` : ` I've held ${plural(deletes.length, 'it', 'them')}.`}`,
      kind: 'stat', kicker: 'Held for you',
      title: 'Unpaid invoices, almost deleted',
      sub: `${money(blockedDeleteMoney)} still owed to you. Held${allDeny ? ' — I recommend no.' : '.'}`,
    });
  }

  if (blocks.length) {
    segments.push({
      say: `I also stopped ${count(blocks.length)} risky ${plural(blocks.length, 'action', 'actions')}. None of them went through.`,
      kind: 'stat', kicker: 'Stopped',
      title: `${blocks.length} risky ${plural(blocks.length, 'action', 'actions')} stopped`,
      sub: 'Each one was stopped before it ran.',
    });
  }

  const fc = blocks.find((b) => (b.fact_check || []).some((f) => f.status !== 'ok'));
  if (fc) {
    const bad = fc.fact_check.filter((f) => f.status !== 'ok');
    const rows = bad.map((f) => ({ claimed: f.claimed, real: f.real == null ? 'no source' : String(f.real), file: f.source_file }));
    const ex = bad.find((f) => f.real != null);
    const who = personFrom(fc.params?.to, fc.task);
    const what = who ? `${fc.agent}'s reply to ${who}` : `A reply ${fc.agent} drafted`;
    const example = ex ? ` It said ${spoken(ex.claimed)}; ${sourceName(ex.source_file)} says ${realIn(ex.real)}.` : '';
    segments.push({
      say: `${what} had ${count(bad.length)} made-up ${plural(bad.length, 'number', 'numbers')}.${example} It didn't go.`,
      kind: 'facts', kicker: 'Fact-check', title: 'Made-up numbers, caught', sub: 'What the agent claimed vs what is actually on file', rows,
    });
  }

  // Attempts to send one regulated file out of the studio, grouped by file.
  const outward = blocks.filter((b) => b.data_level === 'regulated' && (b.params?.file || b.params?.attachment));
  if (outward.length) {
    const file = outward[0].params.file || outward[0].params.attachment;
    const same = outward.filter((b) => (b.params.file || b.params.attachment) === file);
    const agents = [...new Set(same.map((b) => b.agent))];
    const label = fileLabel(file);
    const times = same.length === 1 ? '' : same.length === 2 ? ' twice' : ` ${count(same.length)} times`;
    const how = same.map((b) => (b.action === 'send_email' ? 'by email' : 'to an outside tool'));
    const verdict = same.length === 1 ? 'I blocked it' : same.length === 2 ? 'Blocked both times' : 'Blocked every time';
    segments.push({
      say: `${list(agents)} tried to send your ${label} out${times}. ${verdict}.`,
      kind: 'shield', kicker: 'Protected',
      title: `Your ${label} stayed put`,
      sub: `${same.length} ${plural(same.length, 'attempt', 'attempts')} (${[...new Set(how)].join(', ')}) — blocked. It's classed as ${same[0].data_level} data.`,
    });
  }

  if (scopeReads.length) {
    const task = scopeReads[0].task;
    const same = scopeReads.filter((e) => e.task === task);
    const agent = same[0].agent;
    const labels = [...new Set(same.flatMap((e) => (e.scope_creep?.length ? e.scope_creep.map((s) => s.file) : [e.params?.file])).map(fileLabel))];
    // Only say "nothing went out" if no outward action from that task was let through.
    const leaked = log.some((e) => e.task === task && e.agent === agent && OUTWARD.has(e.action) && e.decision === 'ALLOW');
    segments.push({
      say: `While ${gerund(task)}, ${agent} peeked at your ${list(labels)}. It didn't need ${plural(labels.length, 'it', 'them')}${leaked ? '.' : ', and nothing went out.'}`,
      kind: 'eye', kicker: 'You should know',
      title: 'Sneaky reads, spotted',
      sub: `${labels.map(cap).join(' · ')}. Not needed for the task.${leaked ? '' : ' Nothing was sent.'}`,
    });
  }

  if (injections.length) {
    const n = injections.length;
    segments.push({
      say: `And ${n === 1 ? 'one email' : `${count(n)} emails`} tried to give your agent orders. ${injections.every((e) => e.decision === 'BLOCK') ? 'I caught that too.' : `I flagged ${plural(n, 'it', 'them')}.`}`,
      kind: 'shield', kicker: 'Ignored',
      title: n === 1 ? 'An email tried to give orders' : `${n} emails tried to give orders`,
      sub: injections.every((e) => e.decision === 'BLOCK') ? 'Treated as data, not followed. What it asked for was blocked.' : 'Treated as data, not followed.',
    });
  }

  segments.push({
    say: `The other ${count(allowed.length)} routine ${plural(allowed.length, 'job', 'jobs')} went through fine. Every number here comes straight from your files. Have a good day, ${first}.`,
    kind: 'done', kicker: 'All clear',
    title: `${allowed.length} routine ${plural(allowed.length, 'action', 'actions')} done cleanly`,
    sub: 'Every number traces to a file. — Chaperone',
  });

  return { text: segments.map((s) => s.say).join(' '), segments };
}
