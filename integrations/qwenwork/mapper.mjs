// Maps a Claude-Code-style PreToolUse payload {tool_name, tool_input} to a
// Chaperone action envelope {agent, task, action, params, sources, scope}.
//
// Conservative by design: when a tool call cannot be mapped to a known action
// with confidence, it becomes "unknown:<tool_name>" with the raw input as
// params. The gate fails closed on unknown actions (HOLD, or BLOCK when the
// raw params hide protected data), so nothing unmapped is ever allowed.
//
// Scope is never declared here: the gate takes scope from the task record
// (rules/tasks.json), and sources are tracked by the gate itself.

const DESTRUCTIVE = new Set(['rm', 'unlink', 'rmdir', 'shred']);
const SAFE_RM_FLAGS = /^-(?:[rfv]+|-(?:recursive|force|verbose))$/;

// Host paths are absolute; the gate speaks data/-relative paths. A path under
// a ".../data/" directory is rebased to its data-relative form. Anything else
// is passed through unchanged: the gate blocks paths outside data/ outright.
export function toDataPath(p) {
  if (typeof p !== 'string') return null;
  let s = p.trim();
  if (!s) return null;
  while (s.startsWith('./')) s = s.slice(2);
  const i = s.lastIndexOf('/data/');
  if (i !== -1) s = s.slice(i + '/data/'.length);
  else if (s.startsWith('data/')) s = s.slice('data/'.length);
  return s || null;
}

const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

function unknown(toolName, toolInput) {
  const params = toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput) ? toolInput : {};
  return { action: `unknown:${toolName}`, params };
}

// Bash: only a single-target destructive command with no shell metacharacters
// maps to delete_file. Pipes, chains, globs, quotes, substitutions or multiple
// targets are not understood well enough to be safe -> unknown (fail closed).
function mapBash(toolName, input) {
  const cmd = typeof input.command === 'string' ? input.command.trim() : '';
  if (!cmd || /[;&|`$><\n*?'"\\]/.test(cmd)) return unknown(toolName, input);
  const parts = cmd.split(/\s+/);
  if (!DESTRUCTIVE.has(parts[0])) return unknown(toolName, input);
  const flags = parts.slice(1).filter((a) => a.startsWith('-'));
  const targets = parts.slice(1).filter((a) => !a.startsWith('-'));
  if (flags.some((f) => !SAFE_RM_FLAGS.test(f))) return unknown(toolName, input);
  if (targets.length !== 1) return unknown(toolName, input);
  const file = toDataPath(targets[0]);
  if (!file) return unknown(toolName, input);
  return { action: 'delete_file', params: { file } };
}

function mapWrite(toolName, input) {
  const file = toDataPath(input.file_path);
  const content = toolName === 'Write' ? input.content : input.new_string;
  if (!file || typeof content !== 'string') return unknown(toolName, input);
  return { action: 'write_file', params: { file, content } };
}

function mapRead(toolName, input) {
  const file = toDataPath(input.file_path);
  if (!file) return unknown(toolName, input);
  return { action: 'read_file', params: { file } };
}

// Email-send MCP tools (mcp__gmail__send_email, mcp__email__send, ...).
// Every recipient and attachment is carried over so the gate checks them all.
function mapEmail(toolName, input) {
  let to = input.to ?? input.recipient;
  if (Array.isArray(to) && to.length === 1) to = to[0];
  if (!isEmail(to)) return unknown(toolName, input);
  const body = input.body ?? input.text ?? input.content ?? input.message ?? '';
  if (typeof body !== 'string') return unknown(toolName, input);
  const params = { to: to.trim(), body };
  for (const k of ['cc', 'bcc']) {
    const v = input[k];
    if (typeof v === 'string' || (Array.isArray(v) && v.every(isEmail))) params[k] = v;
    else if (v !== undefined) return unknown(toolName, input);
  }
  const att = input.attachment ?? input.file ?? input.file_path;
  if (att !== undefined) {
    const f = toDataPath(att);
    if (!f) return unknown(toolName, input);
    params.attachment = f;
  }
  if (input.attachments !== undefined) {
    if (!Array.isArray(input.attachments) || input.attachments.some((a) => !toDataPath(a))) return unknown(toolName, input);
    params.attachments = input.attachments.map(toDataPath);
  }
  return { action: 'send_email', params };
}

// Payment MCP tools (mcp__stripe__pay, pay_supplier, ...). Amount must be a
// positive number (or an unambiguous numeric string); supplier is required.
function mapPayment(toolName, input) {
  let amount = input.amount ?? input.total ?? input.value;
  if (typeof amount === 'string' && /^\d+(?:\.\d+)?$/.test(amount.trim())) amount = parseFloat(amount);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return unknown(toolName, input);
  const supplier = input.supplier ?? input.payee ?? input.vendor ?? input.merchant;
  if (typeof supplier !== 'string' || !supplier.trim()) return unknown(toolName, input);
  const params = { amount, supplier: supplier.trim() };
  const invoice = input.invoice ?? input.invoice_path ?? input.invoice_id;
  if (invoice !== undefined) {
    if (typeof invoice !== 'string' || !invoice.trim()) return unknown(toolName, input);
    params.invoice = invoice.includes('/') || /\.(md|csv|txt)$/i.test(invoice) ? toDataPath(invoice) : invoice.trim();
    if (!params.invoice) return unknown(toolName, input);
  }
  if (input.currency !== undefined) {
    if (typeof input.currency !== 'string') return unknown(toolName, input);
    params.currency = input.currency;
  }
  return { action: 'pay_supplier', params };
}

// Upload / WebFetch tools. upload_to_external_tool needs a file; a WebFetch
// with only a URL has no file to classify, so it fails closed as unknown.
function mapUpload(toolName, input) {
  const file = toDataPath(input.file ?? input.file_path ?? input.path);
  if (!file) return unknown(toolName, input);
  const target = input.target ?? input.url ?? input.destination ?? input.tool;
  return { action: 'upload_to_external_tool', params: { file, ...(typeof target === 'string' && target ? { target } : {}) } };
}

// The documented mapping table (also rendered in README.md).
export const MAPPING_TABLE = [
  ['Bash: rm / unlink / rmdir / shred, single target, no shell metacharacters', 'delete_file', 'file extracted from the command'],
  ['Bash: anything else (pipes, chains, globs, other commands)', 'unknown:Bash', 'fail closed'],
  ['Write', 'write_file', 'file_path -> file, content -> content'],
  ['Edit', 'write_file', 'file_path -> file, new_string -> content (overwrite = delete in the gate)'],
  ['Read', 'read_file', 'file_path -> file'],
  ['MCP email-send tools (name contains mail/email/gmail/sendgrid/mailgun + send)', 'send_email', 'to, body, cc, bcc, attachment(s)'],
  ['MCP payment tools (name contains pay/payment/transfer/charge/invoice)', 'pay_supplier', 'amount, supplier/payee, invoice, currency'],
  ['Upload tools / WebFetch with a file path', 'upload_to_external_tool', 'file + target/url'],
  ['WebFetch with only a URL (no file to classify)', 'unknown:WebFetch', 'fail closed'],
  ['Any other tool', 'unknown:<tool_name>', 'raw tool_input as params; gate fails closed'],
];

export function mapToolToEnvelope(toolName, toolInput = {}, opts = {}) {
  const name = String(toolName || '');
  const lower = name.toLowerCase();
  const input = toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput) ? toolInput : {};
  let mapped;
  if (name === 'Bash') mapped = mapBash(name, input);
  else if (name === 'Write' || name === 'Edit') mapped = mapWrite(name, input);
  else if (name === 'Read') mapped = mapRead(name, input);
  else if (/mail|gmail|sendgrid|mailgun/.test(lower) && /send|compose/.test(lower)) mapped = mapEmail(name, input);
  else if (/pay|payment|transfer|charge|invoice/.test(lower)) mapped = mapPayment(name, input);
  else if (/upload|webfetch|web_fetch/.test(lower)) mapped = mapUpload(name, input);
  else mapped = unknown(name, input);
  return {
    agent: opts.agent || 'QwenWork agent (PreToolUse hook)',
    ...(opts.task ? { task: opts.task } : {}),
    action: mapped.action,
    params: mapped.params,
    sources: [],
    scope: [],
  };
}