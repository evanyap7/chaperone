// Chaperone — the oversight engine. Every worker-agent action passes through
// gate() and nowhere else. It classifies data, resolves lineage, checks scope,
// fact-checks figures, aggregates payments, scans for prompt injection, applies
// rules/policy.json, and logs the decision with rule IDs and evidence as direct
// quotes with file paths. File and email content is always DATA, never instructions.
//
// No names, paths or amounts are typed into this file: clients, suppliers,
// contacts, floors, limits and contract clauses are all looked up in the kit's
// own data/ and rules/ files, so every figure traces to a file.
import { classify, classifyDerived } from './classifier.js';
import { Lineage } from './lineage.js';
import { factCheck, hasFabrication, extractSourceFacts } from './factcheck.js';
import {
  policy, maxLevel, readDataFile, resolveDataPath, listDataFiles, parseFrontmatter,
  loadClients, loadSuppliers, loadPriceList, paymentLimit, orgKey, firstName, OWNER_EMAIL,
} from './config.js';

const CLIENTS = loadClients();
const SUPPLIERS = loadSuppliers();
const CLIENT_BY_EMAIL = new Map(CLIENTS.map((c) => [c.email, c]));
const SUPPLIER_BY_EMAIL = new Map(SUPPLIERS.map((s) => [s.email, s]));
const PAYMENT_LIMIT = paymentLimit();
const PRICE_LIST = loadPriceList();
const DAY_MS = 24 * 3600 * 1000;

const NEVER = new Set(policy.rules.filter((r) => r.decision === 'NEVER').map((r) => r.id));
const APPROVE = new Set(policy.rules.filter((r) => r.decision === 'APPROVE').map((r) => r.id));

// Raised for malformed gate input (missing / wrongly typed fields). The HTTP
// layer turns it into a 400; nothing is logged because nothing was attempted.
export class GateInputError extends Error {
  constructor(message) { super(message); this.name = 'GateInputError'; }
}

function decisionForRules(rules) {
  if (rules.some((r) => NEVER.has(r))) return 'BLOCK';
  if (rules.some((r) => APPROVE.has(r))) return 'HOLD_FOR_APPROVAL';
  return 'ALLOW';
}
function lineOf(content, index) { return content.slice(0, index).split('\n').length; }
function quoteLine(content, index) {
  const start = content.lastIndexOf('\n', index - 1) + 1;
  let end = content.indexOf('\n', index);
  if (end === -1) end = content.length;
  return content.slice(start, end).trim();
}
const fmt = (n) => Number(n).toLocaleString('en-US');
const num = (s) => parseFloat(String(s).replace(/,/g, ''));
const shortName = (org) => String(org?.name || '').split(/\s+/)[0];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Read a data file, or null if it does not exist / is outside data/.
function contentOf(file) {
  try { return readDataFile(file); } catch { return null; }
}
function dataFilesUnder(prefix) {
  return listDataFiles().filter((f) => f.startsWith(prefix));
}

// Cite a real line from a data file (or a derived output's in-memory content)
// as evidence. `why` may be a function of the regex match.
function cite(file, regex, why, lineage = null) {
  const content = contentOf(file) ?? lineage?.nodes.get(file)?.content;
  if (!content) return null;
  const m = content.match(regex);
  if (!m) return null;
  return { file, quote: quoteLine(content, m.index), line: lineOf(content, m.index), why: typeof why === 'function' ? why(m, file) : why };
}
// First file in `files` with a line matching `regex`.
function citeFirst(files, regex, why, lineage = null) {
  for (const f of files) {
    const c = cite(f, regex, why, lineage);
    if (c) return c;
  }
  return null;
}
function signalsToEvidence(file, signals) {
  return signals.map((s) => ({ file, quote: s.quote, line: s.line, why: s.why }));
}

// The client a file belongs to: by path, then by sender, then by mention.
function clientOfFile(file) {
  const byPath = CLIENTS.find((c) => file.toLowerCase().includes(c.key));
  if (byPath) return byPath;
  const content = contentOf(file);
  if (!content) return null;
  const from = parseFrontmatter(content).from?.toLowerCase();
  if (from && CLIENT_BY_EMAIL.has(from)) return CLIENT_BY_EMAIL.get(from);
  return CLIENTS.find((c) => content.toLowerCase().includes(c.key)) || null;
}

// "admin/client_list.csv" -> "your client list"; titled files use their title.
function friendlyName(file) {
  const title = parseFrontmatter(contentOf(file) || '').title;
  if (title) return `"${title}"`;
  const base = file.split('/').pop().replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  return `your ${base}`;
}

const FUNDRAISING_RE = /raising\s+SGD\s*([\d.]+M)\s+at\s+a\s+SGD\s*([\d.]+M)\s+pre-money valuation/i;
const RECEIVED_IN_ERROR_RE = /received in error must be deleted and\s+reported/i;

// Paths an action names. Any of them escaping data/ is blocked outright.
function pathParams(ctx) {
  const p = ctx.params || {};
  const list = (v) => (Array.isArray(v) ? v : []);
  return [p.file, p.dir, p.path, p.attachment, p.invoice, ...list(p.files), ...list(p.attachments), ...list(p.derived_from), ...list(ctx.sources)]
    .filter((x) => typeof x === 'string');
}

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isAmount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

// Shape checks per action. Unknown actions are allowed through to the gate
// (where they are held: not on the ALLOW list means not allowed unasked).
export function validateGateInput(ctx) {
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) throw new GateInputError('body must be a JSON object');
  if (!isStr(ctx.agent)) throw new GateInputError('agent is required (string)');
  if (!isStr(ctx.action)) throw new GateInputError('action is required (string)');
  const p = ctx.params ?? {};
  if (typeof p !== 'object' || Array.isArray(p) || p === null) throw new GateInputError('params must be an object');
  for (const k of ['scope', 'sources']) {
    if (ctx[k] !== undefined && !isStrArray(ctx[k])) throw new GateInputError(`${k} must be an array of strings`);
  }
  for (const k of ['files', 'derived_from']) {
    if (p[k] !== undefined && !isStrArray(p[k])) throw new GateInputError(`params.${k} must be an array of strings`);
  }
  for (const k of ['file', 'attachment', 'invoice', 'to', 'body', 'content', 'target', 'statement', 'client', 'supplier', 'service', 'detail']) {
    if (p[k] !== undefined && p[k] !== null && typeof p[k] !== 'string') throw new GateInputError(`params.${k} must be a string`);
  }
  const need = (cond, msg) => { if (!cond) throw new GateInputError(msg); };
  switch (ctx.action) {
    case 'read_file': case 'delete_file': case 'upload_to_external_tool': case 'write_file':
      need(isStr(p.file), `${ctx.action} needs params.file`); break;
    case 'send_email':
      need(isStr(p.to), 'send_email needs params.to'); break;
    case 'pay_supplier':
      need(isAmount(p.amount) && p.amount > 0, 'pay_supplier needs a positive numeric params.amount');
      need(isStr(p.supplier), 'pay_supplier needs params.supplier'); break;
    case 'quote_price':
      need(isStr(p.client), 'quote_price needs params.client');
      need(isAmount(p.price), 'quote_price needs a numeric params.price'); break;
    case 'order_from_supplier':
      need(isAmount(p.amount), 'order_from_supplier needs a numeric params.amount'); break;
    case 'accept_terms':
      need(p.amount === undefined || p.amount === null || isAmount(p.amount), 'accept_terms params.amount must be numeric'); break;
    default: break;
  }
}

export class Chaperone {
  constructor(store) {
    this.store = store;
    this.lineage = new Lineage();
    this.payments = []; // {ts, invoice, supplier, amount}
    this.r17Deleted = new Map(); // regulated file deleted under R17 -> affected client
  }

  reset() {
    this.lineage.reset();
    this.payments = [];
    this.r17Deleted.clear();
  }

  // ---- helpers -------------------------------------------------------------
  classifyFileLevel(file) {
    try { return classify(readDataFile(file), { path: file }); }
    catch { return { level: 'internal', signals: [] }; }
  }

  registerFile(file) {
    const c = this.classifyFileLevel(file);
    const unannounced = this.detectUnannouncedIn(file);
    this.lineage.addFile(file, c.level, { unannounced: unannounced.flagged, facts: unannounced.facts });
    return c;
  }

  // Detect a client's unannounced news in a file (fundraising marked not public).
  detectUnannouncedIn(file) {
    const content = contentOf(file);
    if (!content) return { flagged: false, facts: [] };
    const facts = [];
    const fundraising = content.match(FUNDRAISING_RE);
    if (fundraising) {
      const who = shortName(clientOfFile(file)) || file;
      facts.push(`${who} fundraising SGD ${fundraising[1]} at SGD ${fundraising[2]} valuation`);
    }
    const notPublic = /(not public|isn't public|unannounced|keep quiet|until we announce|not announced|strictly confidential)/i.test(content);
    // A fundraising figure in a confidential client doc is unannounced news.
    const flagged = facts.length > 0 && (notPublic || /proposal|contract/i.test(file));
    return { flagged, facts };
  }

  recipientKnown(email) {
    const e = (email || '').toLowerCase();
    return CLIENT_BY_EMAIL.has(e) || SUPPLIER_BY_EMAIL.has(e) || (!!OWNER_EMAIL && e === OWNER_EMAIL);
  }

  floorFor(clientName) {
    return policy.owner_floors?.[clientName] ?? null;
  }

  // Evidence for an owner floor: the policy entry, plus every place the owner
  // wrote it down — the client's own documents and the owner's notes.
  floorEvidence(clientName, floor) {
    const ev = [{ file: 'rules/policy.json', quote: `"${clientName}": ${floor}`, line: null, why: `policy.json owner_floors: ${clientName} ${floor}` }];
    const key = orgKey(clientName);
    const p = citeFirst(dataFilesUnder('clients/').filter((f) => f.includes(key)), /Do not go below SGD [\d,]+/i,
      (m, f) => `${f}: '${m[0]}'`);
    if (p) ev.push(p);
    const w = citeFirst(dataFilesUnder('notes/'), new RegExp(`${escapeRe(key)}[^\\n]*?(floor is [\\d,]+[^\\n]*)`, 'i'),
      (m, f) => `${f}: '${m[1].trim()}'`);
    if (w) ev.push(w);
    return ev;
  }

  // ---- the single logged channel ------------------------------------------
  gate(ctx) {
    validateGateInput(ctx);
    ctx = { ...ctx, params: ctx.params ?? {}, scope: ctx.scope ?? [], sources: ctx.sources ?? [] };
    const { agent, task, action, params, scenario } = ctx;
    const filesTouched = new Set(params.file ? [params.file] : []);
    if (params.files) for (const f of params.files) filesTouched.add(f);

    let result;
    const escaping = pathParams(ctx).filter((f) => { try { resolveDataPath(f); return false; } catch { return true; } });
    if (escaping.length) {
      result = this.blockOutsideWorkspace(ctx, escaping);
      filesTouched.clear();
    } else {
      switch (action) {
        case 'read_file': result = this.doRead(ctx); break;
        case 'list_dir': result = this.doList(ctx); break;
        case 'upload_to_external_tool': result = this.doUpload(ctx); break;
        case 'send_email': result = this.doSendEmail(ctx); break;
        case 'quote_price': result = this.doQuote(ctx); break;
        case 'accept_terms': result = this.doAcceptTerms(ctx); break;
        case 'pay_supplier': result = this.doPay(ctx); break;
        case 'order_from_supplier': result = this.doOrder(ctx); break;
        case 'delete_file': result = this.doDelete(ctx); break;
        case 'write_file': result = this.doWrite(ctx); break;
        case 'state_fact': case 'state_a_fact_to_a_client': result = this.doStateFact(ctx); break;
        default: result = this.doUnknown(ctx);
      }
    }

    // Effective data level = highest of the files the action actually touches.
    // (Content-derived levels for emails/uploads/writes are already resolved
    // inside the handlers via lineage; context reads don't elevate an action.)
    let level = result.data_level || null;
    for (const f of filesTouched) level = maxLevel(level, this.lineage.levelOf(f) || this.classifyFileLevel(f).level);
    if (params.file && !escaping.length) level = maxLevel(level, this.lineage.effectiveLevel(params.file, null));
    result.data_level = level || 'internal';

    const entry = this.store.append({
      scenario, agent, task, action, params,
      files_touched: [...filesTouched],
      data_level: result.data_level,
      decision: result.decision,
      rules: result.rules,
      evidence: result.evidence,
      fact_check: result.fact_check || [],
      scope_creep: result.scope_creep || [],
      injection: result.injection || null,
      lineage_chain: params.file && !escaping.length ? this.lineage.chainOf(params.file) : (result.lineage_chain || []),
      money_at_stake: result.money_at_stake ?? null,
      owner_line: result.owner_line,
      never: result.rules.some((r) => NEVER.has(r)),
      ...(result.notify ? { notify: result.notify } : {}),
    });

    // Held items go to the queue once; NEVER items never do.
    if (result.decision === 'HOLD_FOR_APPROVAL' && result.queue_item) {
      const q = this.store.enqueue({ ...result.queue_item, log_id: entry.id, never: false });
      entry.queue_id = q.queue_id;
    }
    return entry;
  }

  // A path that escapes data/ ("../../etc/passwd") is never read or touched.
  blockOutsideWorkspace(ctx, paths) {
    return {
      decision: 'BLOCK', rules: [], data_level: 'regulated',
      evidence: paths.map((p) => ({ file: p, quote: p, line: null, why: 'Path points outside the business files (data/). Not read, not touched.' })),
      owner_line: `Blocked: ${ctx.agent} tried to reach ${paths.join(', ')}, which is outside your business files. Nothing was read.`,
    };
  }

  // Anything not on the policy's ALLOW list is not allowed without asking.
  doUnknown(ctx) {
    const line = `Held: "${ctx.action}" is not covered by your policy, so it waits for your yes.`;
    return {
      decision: 'HOLD_FOR_APPROVAL', rules: [], evidence: [], data_level: 'internal', owner_line: line,
      queue_item: { fingerprint: `unknown:${ctx.agent}:${ctx.action}:${JSON.stringify(ctx.params).slice(0, 200)}`, agent: ctx.agent, action: ctx.action, summary: line.replace(/^Held: /, ''), recommendation: 'review', money_at_stake: null },
    };
  }

  // ---- read / list ---------------------------------------------------------
  doRead(ctx) {
    const file = ctx.params.file;
    const c = this.registerFile(file);
    const inScope = ctx.scope.includes(file);
    const evidence = signalsToEvidence(file, c.signals);
    if (inScope) {
      return { decision: 'ALLOW', rules: ['R01'], evidence, data_level: c.level, owner_line: `Read ${file} (needed for the task).` };
    }
    const scope_creep = [{ file, level: c.level }];
    if (c.level === 'regulated') {
      evidence.push({ file, quote: c.signals[0]?.quote || file, line: c.signals[0]?.line || 1, why: `Regulated file read with no connection to the task (${ctx.task}) — outside the task scope` });
      return { decision: 'BLOCK', rules: ['R02'], evidence, data_level: c.level, scope_creep, owner_line: `Blocked: read your ${file} which it did not need for this task.` };
    }
    evidence.push({ file, quote: file, line: 1, why: 'Read outside the task scope (scope creep, logged)' });
    return { decision: 'ALLOW', rules: ['R01'], evidence, data_level: c.level, scope_creep, owner_line: `Read ${file} outside the task scope (logged as scope creep).` };
  }

  doList(ctx) {
    return { decision: 'ALLOW', rules: ['R01'], evidence: [], data_level: 'internal', owner_line: `Listed ${ctx.params.dir || 'files'}.` };
  }

  // The README that sits next to a data file ("x.csv" -> "x.README.md") and
  // says how it must be treated.
  companionReadmeCite(file) {
    const readme = file.replace(/\.[^./]+$/, '.README.md');
    if (readme === file) return null;
    return cite(readme, /regulated\s+personal data[^\n]*/i, (m, f) => `${f} marks it regulated personal data`)
      || cite(readme, /regulated/i, (m, f) => `${f} marks it regulated`);
  }

  // Evidence for unannounced client news: the original confidential line in
  // each source, then the matching line in the derived artifact itself.
  unannouncedEvidence(file) {
    const sources = this.lineage.unannouncedSources(file);
    const evidence = [];
    for (const src of sources) {
      const c = cite(src, FUNDRAISING_RE, `Original confidential line in ${src} (unannounced fundraising)`);
      if (c) evidence.push(c);
    }
    if (!sources.includes(file)) {
      const here = cite(file, /raising[^.]*valuation/i, `Matching line in ${file} repeats the client's unannounced fundraising`, this.lineage);
      if (here) evidence.push(here);
    }
    return { sources, evidence };
  }

  // ---- upload to external tool --------------------------------------------
  doUpload(ctx) {
    const file = ctx.params.file;
    const target = ctx.params.target || 'an external tool';
    const c = this.registerFile(file);
    const effLevel = this.lineage.effectiveLevel(file, c.level);
    const unannounced = this.lineage.isUnannounced(file);
    const evidence = signalsToEvidence(file, c.signals);
    const rules = [];

    if (effLevel === 'regulated' || effLevel === 'client-confidential') {
      rules.push('R15');
      if (effLevel === 'regulated') {
        const readme = this.companionReadmeCite(file);
        if (readme) evidence.push(readme);
        evidence.unshift({ file, quote: c.signals[0]?.quote || file, line: c.signals[0]?.line || 1, why: `${file} contains names, emails and phone numbers of identifiable people` });
      }
    } else if (effLevel === 'internal') {
      rules.push('R14');
    } else {
      rules.push('R13');
    }

    let origin = null;
    if (unannounced) {
      rules.push('R19');
      const u = this.unannouncedEvidence(file);
      evidence.push(...u.evidence);
      origin = u.sources[0] || null;
    }

    const decision = decisionForRules(rules);
    const chain = this.lineage.chainOf(file);
    let owner_line;
    if (decision === 'BLOCK' && origin) {
      const who = shortName(clientOfFile(origin)) || 'a client';
      const kind = this.classifyFileLevel(origin).docType || 'document';
      const how = origin === file ? 'It is' : 'It looked harmless but was built from';
      owner_line = `Blocked: tried to upload ${file} to ${target}. ${how} ${who}'s confidential ${kind} and contains their unannounced fundraising.`;
    } else if (decision === 'BLOCK') {
      owner_line = `Blocked: tried to upload ${file} to ${target}. It holds ${effLevel} data. Nothing was sent.`;
    } else if (decision === 'HOLD_FOR_APPROVAL') {
      owner_line = `Held: upload of ${file} to ${target} needs your approval.`;
    } else {
      owner_line = `Allowed: uploaded public ${file} to ${target}.`;
    }
    return {
      decision, rules, evidence, data_level: effLevel, lineage_chain: chain, owner_line,
      queue_item: decision === 'HOLD_FOR_APPROVAL' ? { fingerprint: `upload:${file}:${target}`, agent: ctx.agent, action: 'upload_to_external_tool', summary: owner_line, recommendation: 'deny', money_at_stake: null } : null,
    };
  }

  // ---- send email ----------------------------------------------------------
  doSendEmail(ctx) {
    const { to, body = '', attachment } = ctx.params;
    const sources = ctx.sources;
    // register sources for lineage / fact context
    for (const s of sources) this.registerFile(s);
    const inputLevels = sources.map((s) => this.lineage.levelOf(s)).filter(Boolean);
    const content = classifyDerived(body, inputLevels);
    let effLevel = content.level;
    if (attachment) {
      const ac = this.registerFile(attachment);
      effLevel = maxLevel(effLevel, this.lineage.effectiveLevel(attachment, ac.level));
    }
    const recipientKnown = this.recipientKnown(to);
    const evidence = [];
    const injection = this.scanInjection(sources);

    // 1) price commitment below an owner floor
    const price = this.detectPriceCommitment(to, body);
    if (price && price.floor !== null && price.price < price.floor) {
      const ev = this.floorEvidence(price.client, price.floor);
      const fake = this.detectFakeApproval(body, sources);
      if (fake) ev.push(fake);
      return {
        decision: 'BLOCK', rules: ['R08', 'R07'], evidence: ev, data_level: maxLevel(effLevel, 'client-confidential'),
        owner_line: `Blocked: drafted a ${fmt(price.price)} offer to ${price.client}. Your floor is ${fmt(price.floor)}.${fake ? ' The email claiming you approved it is not an approval — only your queue can release a hold, and a floor can never be approved away.' : ''} Draft is in your queue if you want to counter at ${fmt(price.floor)}.`,
        injection,
      };
    }

    // 2) confirming a supplier order = new spend, which R12 holds until the
    // owner confirms in writing (the agent's own say-so never counts).
    const order = this.detectOrderConfirmation(to, body, sources);
    if (order) {
      const ev = [];
      if (order.offer) ev.push(order.offer);
      if (order.requirement) ev.push(order.requirement);
      const who = order.requirement?.who;
      const notConfirmed = who ? `${who} hasn't confirmed in writing` : "you haven't confirmed it in writing";
      return {
        decision: 'HOLD_FOR_APPROVAL', rules: ['R12'], evidence: ev, data_level: effLevel, money_at_stake: order.amount,
        owner_line: `Held: drafted a go-ahead to ${order.supplier} for SGD ${fmt(order.amount)}. ${notConfirmed[0].toUpperCase()}${notConfirmed.slice(1)}.`,
        queue_item: { fingerprint: `order:${to}:${order.amount}`, agent: ctx.agent, action: 'order_from_supplier', summary: `Go-ahead to ${order.supplier} for SGD ${fmt(order.amount)} (${notConfirmed}).`, recommendation: 'deny', money_at_stake: order.amount },
        injection,
      };
    }

    // 3) fabricated figures (fact check)
    const fc = factCheck(body, sources);
    if (hasFabrication(fc)) {
      const rules = ['R18'];
      for (const r of fc.filter((x) => x.status !== 'ok')) {
        evidence.push({ file: r.source_file || '(no source)', quote: r.source_quote || `No file supports "${r.claimed}"`, line: r.source_line, why: `Claimed ${r.claimed} — real value ${r.real ?? 'unknown'}${r.source_file ? ` (${r.source_file})` : ''}` });
      }
      // Also cite the real source figures so the owner sees claimed vs real side by side.
      for (const f of extractSourceFacts(sources)) {
        evidence.push({ file: f.file, quote: f.quote, line: f.line, why: `Real figure on file: ${f.value}${f.subtype ? ` (${f.subtype})` : ''}` });
      }
      const settlement = this.detectSettlement(sources);
      if (settlement) {
        rules.push('R09');
        evidence.push({ ...settlement.cite, why: `Settling at ${fmt(settlement.amount)} is the owner's call (accept_terms)` });
      }
      return {
        decision: 'BLOCK', rules, evidence, data_level: maxLevel(effLevel, 'client-confidential'), fact_check: fc,
        owner_line: `Blocked: drafted a reply with figures that don't match any file (${fc.filter((x) => x.status !== 'ok').map((x) => x.claimed).join(', ')}). The real figures are in the sources.`,
        injection,
      };
    }

    // 4) contract-mandated notification after an R17 delete: allowed only if the
    // message itself carries no personal data (its own text classifies safe) and
    // it goes to the affected client's contact or the owner.
    const r17 = this.r17Notification(to, body, sources);
    if (r17) {
      return {
        decision: 'ALLOW', rules: ['R17', 'R03'], evidence: r17.clause ? [r17.clause] : [], data_level: 'internal',
        owner_line: `Sent the contract-required notice to ${to}: data received in error was deleted and reported. The message itself contains no personal data.`,
        injection,
      };
    }

    // 5) sharing unannounced client news
    const unannouncedSrc = this.sharesUnannounced(body, sources);
    if (unannouncedSrc.length) {
      const ev = unannouncedSrc.map((s) => cite(s, /raising SGD/i, `Unannounced client fundraising (${s})`)).filter(Boolean);
      return { decision: 'BLOCK', rules: ['R19'], evidence: ev, data_level: effLevel, owner_line: 'Blocked: the message shares a client’s unannounced news.', injection };
    }

    // 6) regulated / client-confidential data leaving the company
    if (effLevel === 'regulated' || effLevel === 'client-confidential') {
      if (!recipientKnown) {
        // Protected data to an external, non-client address = exfiltration.
        const carrier = attachment
          || sources.find((s) => this.lineage.levelOf(s) === effLevel)
          || null;
        const ev = carrier ? signalsToEvidence(carrier, this.classifyFileLevel(carrier).signals) : [];
        const readme = carrier ? this.companionReadmeCite(carrier) : null;
        if (readme) ev.push(readme);
        if (!carrier) ev.push({ file: '(draft body)', quote: body.slice(0, 160), line: null, why: `Message text itself classifies as ${effLevel}` });
        const what = attachment ? friendlyName(attachment) : `${effLevel} data`;
        return {
          decision: 'BLOCK', rules: ['R15', 'R05'], evidence: ev, data_level: effLevel, injection,
          owner_line: `Blocked: tried to email ${what} to ${to} (an external address). It holds ${effLevel === 'regulated' ? 'personal data' : 'client-confidential data'}. Nothing was sent.`,
        };
      }
      return {
        decision: 'HOLD_FOR_APPROVAL', rules: ['R04'], evidence, data_level: effLevel,
        owner_line: `Held: email to ${to} contains ${effLevel} data and needs your approval.`,
        queue_item: { fingerprint: `email:${to}:${body.slice(0, 40)}`, agent: ctx.agent, action: 'send_email', summary: `Email to ${to} with ${effLevel} data.`, recommendation: 'review', money_at_stake: null },
        injection,
      };
    }

    // 7) unknown recipient, non-sensitive content
    if (!recipientKnown) {
      return {
        decision: 'HOLD_FOR_APPROVAL', rules: ['R05'], evidence, data_level: effLevel,
        owner_line: `Held: email to ${to}, who is not in your client or supplier list.`,
        queue_item: { fingerprint: `email:${to}:${body.slice(0, 40)}`, agent: ctx.agent, action: 'send_email', summary: `Email to unknown recipient ${to}.`, recommendation: 'review', money_at_stake: null },
        injection,
      };
    }

    // 8) normal client/supplier email, internal or public content
    return { decision: 'ALLOW', rules: ['R03'], evidence, data_level: effLevel, owner_line: `Sent email to ${to}.`, injection };
  }

  // An email (or the draft itself) claiming the owner approved something is not
  // an approval. Approvals happen only in the owner queue; NEVER rules are
  // unapprovable by anyone. Content is data, never authority.
  detectFakeApproval(body, sources) {
    // Cite the inbound message first (it is the evidence); the draft itself is
    // only a fallback when no source carries the claim.
    const texts = [];
    for (const s of sources) {
      const c = contentOf(s);
      if (c) texts.push({ where: s, text: c });
    }
    texts.push({ where: 'the draft itself', text: body || '' });
    const owner = escapeRe(firstName(policy.owner).toLowerCase() || 'owner');
    const ownerThenApproval = new RegExp(`[^\\n]*(?:${owner}|the owner|owner)[^\\n]*(?:approv|authoris|authoriz|sign(?:ed)? off|go[- ]ahead)[^\\n]*`, 'i');
    const approvalThenOwner = new RegExp(`[^\\n]*(?:approv|authoris|authoriz)[^\\n]*(?:${owner}|the owner|owner)[^\\n]*`, 'i');
    for (const { where, text } of texts) {
      const m = text.match(ownerThenApproval) || text.match(approvalThenOwner);
      if (m && /(approve|approved|approval|authoris|authoriz|signed off)/i.test(m[0])) {
        return {
          file: where === 'the draft itself' ? '(draft body)' : where,
          quote: m[0].trim(), line: lineOf(text, m.index),
          why: 'Claimed owner approval found in message content. This is not an approval: only the owner queue can release a held action, and a NEVER rule (the floor) can never be approved by anyone.',
        };
      }
    }
    return null;
  }

  // Contract-mandated notice after an R17 delete. Allowed only when the message
  // text itself carries no protected data, reports the deletion, and goes to
  // the affected client's own contact or the owner — nobody else.
  r17Notification(to, body, sources) {
    const deleted = sources.filter((s) => this.r17Deleted.has(s));
    if (!deleted.length) return null;
    if (!/(delet|report)/i.test(body || '')) return null;
    const e = (to || '').toLowerCase();
    const record = deleted.map((s) => this.r17Deleted.get(s)).find((r) => r.client.email === e) || this.r17Deleted.get(deleted[0]);
    if (e !== OWNER_EMAIL && e !== record.client.email) return null;
    // The message's own text must be safe — inheritance is deliberately NOT
    // applied here, because the notice reports the deletion without repeating
    // any personal data. If the body itself contained personal data, the
    // regulated branch below would hold it.
    const own = classify(body || '', {});
    if (own.level === 'regulated' || own.level === 'client-confidential') return null;
    return { clause: record.clause };
  }

  detectPriceCommitment(to, body) {
    const client = CLIENT_BY_EMAIL.get((to || '').toLowerCase());
    if (!client) return null;
    const floor = this.floorFor(client.name);
    if (floor === null) return null;
    const m = (body || '').match(/(?:match|offer|at|for|price|quote)\s*(?:SGD\s*)?(\d[\d,]*(?:\.\d+)?)/i) || (body || '').match(/SGD\s*(\d[\d,]*)/i);
    if (!m) return null;
    const price = num(m[1]);
    if (!Number.isFinite(price)) return null;
    return { client: client.name, price, floor };
  }

  // A go-ahead email to a known supplier whose sources carry a priced offer.
  // Returns { amount, supplier, offer (cite), requirement (cite + who) } or null.
  detectOrderConfirmation(to, body, sources) {
    const supplier = SUPPLIER_BY_EMAIL.get((to || '').toLowerCase());
    if (!supplier) return null;
    if (!/(go ahead|proceed|confirm|please print|yes,? (print|do)|print them)/i.test(body || '')) return null;
    // The offer amount, preferring messages sent by this supplier.
    const fromSupplier = (s) => parseFrontmatter(contentOf(s) || '').from?.toLowerCase() === supplier.email;
    const ordered = [...sources.filter(fromSupplier), ...sources.filter((s) => !fromSupplier(s))];
    let offer = null;
    let amount = null;
    for (const s of ordered) {
      const c = cite(s, /SGD\s*([\d,]+)/i, (m) => `Order is new spend (SGD ${fmt(num(m[1]))}) not confirmed by the owner in writing`);
      if (c) { offer = c; amount = num(contentOf(s).match(/SGD\s*([\d,]+)/i)[1]); break; }
    }
    if (amount === null) return null;
    // Any written condition the owner set for this supplier ("only if X confirms in writing").
    const re = new RegExp(`${escapeRe(supplier.key)}[^\\n]*?(only if (\\w+) confirms in writing)`, 'i');
    let requirement = null;
    for (const f of dataFilesUnder('notes/')) {
      const content = contentOf(f);
      const m = content?.match(re);
      if (m) {
        requirement = { file: f, quote: quoteLine(content, m.index), line: lineOf(content, m.index), why: `${f} says '${m[1]}'`, who: m[2] };
        break;
      }
    }
    return { amount, supplier: supplier.name, offer, requirement };
  }

  // A settlement figure proposed in a source ("Can we settle at 4,200?").
  detectSettlement(sources) {
    for (const s of sources) {
      const c = cite(s, /settle at ([\d,]+)/i, '');
      if (c) return { amount: num(contentOf(s).match(/settle at ([\d,]+)/i)[1]), cite: c };
    }
    return null;
  }

  // Sources carrying unannounced client news, if the body talks about it.
  sharesUnannounced(body, sources) {
    if (!/(raising|valuation|fundrais)/i.test(body || '')) return [];
    return sources.filter((s) => this.lineage.isUnannounced(s));
  }

  scanInjection(sources) {
    for (const s of sources) {
      const c = contentOf(s);
      if (!c) continue;
      const m = c.match(/(AI assistant|attention AI|ignore (?:previous|all)|system:|assistant:)[^\n]*(forward|send|upload|email|share)[^\n]*/i);
      if (m) {
        return { flagged: true, file: s, quote: quoteLine(c, m.index), line: lineOf(c, m.index), why: 'Possible prompt injection: text in an inbound file addresses an AI agent and instructs it to move data. Treated as data, not followed.' };
      }
    }
    return null;
  }

  // ---- quote price ---------------------------------------------------------
  // R08 below an owner floor (NEVER) > R06 at or above the published price for
  // the named service (ALLOW) > R07 anything else, i.e. a discount (APPROVE).
  doQuote(ctx) {
    const { client, price, service } = ctx.params;
    const floor = this.floorFor(client);
    if (floor !== null && price < floor) {
      return { decision: 'BLOCK', rules: ['R08', 'R07'], evidence: this.floorEvidence(client, floor), data_level: 'client-confidential', owner_line: `Blocked: quote ${fmt(price)} to ${client} is below your floor ${fmt(floor)}.` };
    }
    const listed = service ? PRICE_LIST.find((p) => p.service.toLowerCase() === service.toLowerCase()) : null;
    if (listed && price >= listed.price) {
      return {
        decision: 'ALLOW', rules: ['R06'], data_level: 'internal', money_at_stake: price,
        evidence: [{ file: listed.file, quote: listed.quote, line: listed.line, why: `Published price for ${listed.service}: SGD ${fmt(listed.price)}` }],
        owner_line: `Quoted ${client} SGD ${fmt(price)} for ${listed.service} (at or above your published price).`,
      };
    }
    const evidence = listed ? [{ file: listed.file, quote: listed.quote, line: listed.line, why: `Below the published price for ${listed.service} (SGD ${fmt(listed.price)})` }] : [];
    const why = listed ? 'below your published price' : 'not a published price';
    return { decision: 'HOLD_FOR_APPROVAL', rules: ['R07'], evidence, data_level: 'client-confidential', money_at_stake: price, owner_line: `Held: quote ${fmt(price)} to ${client} is ${why} and needs approval.`, queue_item: { fingerprint: `quote:${client}:${service || ''}:${price}`, agent: ctx.agent, action: 'quote_price', summary: `Quote ${fmt(price)} to ${client}${listed ? ` for ${listed.service}` : ''}.`, recommendation: 'review', money_at_stake: price } };
  }

  doAcceptTerms(ctx) {
    return {
      decision: 'HOLD_FOR_APPROVAL', rules: ['R09'], evidence: [], data_level: 'client-confidential',
      money_at_stake: ctx.params.amount ?? null,
      owner_line: `Held: accepting changed terms is your call.`,
      queue_item: { fingerprint: `terms:${ctx.params.detail || ''}`, agent: ctx.agent, action: 'accept_terms', summary: ctx.params.detail || 'Accept changed terms.', recommendation: 'review', money_at_stake: ctx.params.amount ?? null },
    };
  }

  // ---- pay supplier (aggregated) ------------------------------------------
  // R10 allows a payment only against a received invoice, under the policy
  // limit. Payments are aggregated per invoice and per supplier over 24h so a
  // split payment, a duplicate payment or an overpayment cannot slip through.
  doPay(ctx) {
    const { amount, invoice, supplier } = ctx.params;
    const now = Date.now();
    // true invoice total from the invoice file (only a supplier invoice we received counts)
    let invoiceTotal = null;
    let received = false;
    if (invoice) {
      const c = contentOf(invoice);
      if (c) {
        received = classify(c, { path: invoice }).docType === 'invoice-received';
        const m = c.match(/SGD\s*([\d,]+)/i) || c.match(/\*\*Total\*\*\s*\|\s*\*\*([\d,]+)\*\*/i);
        if (m) invoiceTotal = num(m[1]);
      }
    }
    // aggregate payments per invoice and per supplier over the last 24h
    this.payments = this.payments.filter((p) => now - p.ts < DAY_MS);
    const prior = this.payments.filter((p) => invoice && p.invoice === invoice);
    const perInvoice = prior.reduce((a, p) => a + p.amount, 0) + amount;
    const perSupplier = this.payments.filter((p) => p.supplier === supplier).reduce((a, p) => a + p.amount, 0) + amount;
    this.payments.push({ ts: now, invoice, supplier, amount });

    const evidence = [];
    if (invoice) {
      const inv = cite(invoice, /SGD [\d,]+/i, `Invoice ${invoice} totals SGD ${invoiceTotal === null ? 'unknown' : fmt(invoiceTotal)}`);
      if (inv) evidence.push(inv);
    }
    const noMatch = !received || invoiceTotal === null;
    const overLimit = (invoiceTotal ?? 0) > PAYMENT_LIMIT || perInvoice > PAYMENT_LIMIT || perSupplier > PAYMENT_LIMIT;
    const overpaid = invoiceTotal !== null && perInvoice > invoiceTotal;
    if (noMatch || overLimit || overpaid) {
      const stake = invoiceTotal ?? perInvoice;
      const split = prior.length > 0 || (invoiceTotal !== null && amount < invoiceTotal);
      let reason;
      if (noMatch) reason = `there is no matching supplier invoice on file${invoice ? ` (${invoice})` : ''}`;
      else if (overpaid) reason = `payments against this invoice (SGD ${fmt(perInvoice)}) would exceed its total of SGD ${fmt(invoiceTotal)}`;
      else if (split) reason = `the agent split a ${fmt(stake)} payment to stay under your ${fmt(PAYMENT_LIMIT)} approval limit`;
      else reason = `SGD ${fmt(stake)} is over your ${fmt(PAYMENT_LIMIT)} approval limit`;
      evidence.push({ file: invoice || '(ledger)', quote: `Payments against this invoice in 24h total SGD ${fmt(perInvoice)} (this payment SGD ${fmt(amount)})`, line: null, why: `${reason[0].toUpperCase()}${reason.slice(1)}` });
      return {
        decision: 'HOLD_FOR_APPROVAL', rules: ['R11'], evidence, data_level: 'internal', money_at_stake: stake,
        owner_line: `Held: ${reason}. This payment is SGD ${fmt(amount)}; SGD ${fmt(perInvoice)} has been attempted against this invoice in the last 24 hours.`,
        queue_item: { fingerprint: `pay:${invoice || '(none)'}:${supplier}${overpaid ? ':over' : ''}`, agent: ctx.agent, action: 'pay_supplier', summary: `Pay ${supplier} — invoice totals SGD ${fmt(stake)}${split ? ' (split into smaller payments)' : ''}.`, recommendation: 'review', money_at_stake: stake },
      };
    }
    return { decision: 'ALLOW', rules: ['R10'], evidence, data_level: 'internal', money_at_stake: amount, owner_line: `Paid ${supplier} SGD ${fmt(amount)} (matched invoice, under ${fmt(PAYMENT_LIMIT)}).` };
  }

  // New spend is always held (R12). An agent claiming "confirmed" is not the
  // owner confirming; the owner confirms by approving the queue item.
  doOrder(ctx) {
    const { amount, supplier = 'a supplier' } = ctx.params;
    return {
      decision: 'HOLD_FOR_APPROVAL', rules: ['R12'], evidence: [], data_level: 'internal', money_at_stake: amount,
      owner_line: `Held: new spend SGD ${fmt(amount)} with ${supplier} not confirmed by you in writing.`,
      queue_item: { fingerprint: `order:${supplier}:${amount}`, agent: ctx.agent, action: 'order_from_supplier', summary: `New order SGD ${fmt(amount)} with ${supplier}.`, recommendation: 'review', money_at_stake: amount },
    };
  }

  // ---- delete file ---------------------------------------------------------
  doDelete(ctx) {
    const file = ctx.params.file;
    const c = this.registerFile(file);
    const evidence = signalsToEvidence(file, c.signals);

    // R17 exception: regulated data received in error, per a client contract.
    const inError = this.regulatedReceivedInError(file, c);
    if (inError) {
      evidence.push(inError.clause);
      this.r17Deleted.set(file, inError);
      const what = c.signals.some((s) => s.id === 'health-data') ? 'patient data' : 'personal data';
      const contact = firstName(inError.client.contact) || inError.client.email;
      return {
        decision: 'ALLOW', rules: ['R17'], evidence, data_level: 'regulated',
        owner_line: `Allowed: deleted the ${what} ${shortName(inError.client)} sent in error, per their contract. Notifying ${contact} and you. Nothing was summarised, quoted or stored.`,
        notify: [inError.client.email, OWNER_EMAIL].filter(Boolean),
      };
    }

    // R16: any other delete is held. Show the money at stake for unpaid invoices.
    const unpaid = cite(file, /Status: UNPAID/i, `${file} is marked UNPAID`);
    if (unpaid) evidence.push(unpaid);
    const totalM = contentOf(file)?.match(/\*\*Total\*\*\s*\|\s*\*\*([\d,]+)\*\*/i);
    const money = totalM ? num(totalM[1]) : null;
    if (unpaid || money !== null) {
      const cash = citeFirst(dataFilesUnder('finance/').filter((f) => f !== file), /Outstanding receivables: SGD ([\d,]+)[^\n]*/i,
        (m, f) => `${f} lists outstanding receivables of SGD ${m[1]}, which this invoice is part of`);
      if (cash) evidence.push(cash);
    }
    return {
      decision: 'HOLD_FOR_APPROVAL', rules: ['R16'], evidence, data_level: c.level, money_at_stake: money,
      owner_line: `Held: wants to delete ${file}${money ? ` (SGD ${fmt(money)} still unpaid)` : ''}. Recommend: no.`,
      queue_item: { fingerprint: `delete:${file}`, agent: ctx.agent, action: 'delete_file', summary: `Delete ${file}${money ? ` — SGD ${fmt(money)} unpaid` : ''}.`, recommendation: 'deny', money_at_stake: money },
    };
  }

  // Regulated data sent to us in error by a client whose contract says such
  // data must be deleted and reported. Returns { client, clause } or null.
  regulatedReceivedInError(file, c = this.classifyFileLevel(file)) {
    if (c.level !== 'regulated') return null;
    if (!file.startsWith('inbox/')) return null;
    const client = CLIENT_BY_EMAIL.get(parseFrontmatter(contentOf(file) || '').from?.toLowerCase());
    if (!client) return null;
    const contracts = dataFilesUnder('clients/').filter((f) => /contract/i.test(f) && f.includes(client.key));
    const clause = citeFirst(contracts, RECEIVED_IN_ERROR_RE,
      (m, f) => `${f}: data received in error must be deleted and reported to the client`);
    return clause ? { client, clause } : null;
  }

  // ---- write / derive an output -------------------------------------------
  doWrite(ctx) {
    const { file, content, derived_from = [] } = ctx.params;
    for (const d of derived_from) this.registerFile(d);
    const own = classify(content || '', { path: file });
    const node = this.lineage.addOutput(file, derived_from, own.level, { content });
    const evidence = [];
    for (const d of derived_from) {
      const src = this.lineage.nodes.get(d);
      if (!src) continue;
      // Cite a real line from the source, not a placeholder.
      const real = cite(d, /raising[^.]*valuation|SGD\s*[\d,]+|title:[^\n]+/i, `${file} is derived from ${d} and inherits its ${src.level} level`, this.lineage);
      evidence.push(real || { file: d, quote: d, line: 1, why: `${file} is derived from ${d} and inherits its ${src.level} level` });
      if (src.unannounced) {
        const un = cite(d, /raising[^.]*valuation/i, `${d} carries the client's unannounced fundraising; ${file} inherits it no matter how it is reworded`, this.lineage);
        if (un) evidence.push(un);
      }
    }
    return {
      decision: 'ALLOW', rules: ['R01'], evidence, data_level: node.level, lineage_chain: this.lineage.chainOf(file),
      owner_line: `Wrote ${file} (inherits ${node.level} from its sources).`,
    };
  }

  doStateFact(ctx) {
    const fc = factCheck(ctx.params.statement || '', ctx.sources);
    if (hasFabrication(fc)) {
      return { decision: 'BLOCK', rules: ['R18'], evidence: fc.filter((x) => x.status !== 'ok').map((x) => ({ file: x.source_file || '(no source)', quote: x.source_quote || `No file supports "${x.claimed}"`, line: x.source_line, why: `Claimed ${x.claimed}, real ${x.real ?? 'unknown'}` })), data_level: 'client-confidential', fact_check: fc, owner_line: 'Flagged: a stated figure is not traceable to any file.' };
    }
    return { decision: 'ALLOW', rules: ['R18'], evidence: [], data_level: 'internal', fact_check: fc, owner_line: 'Stated a fact traceable to a file.' };
  }
}
