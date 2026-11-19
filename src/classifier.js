// Chaperone sensitivity classifier.
// Content-based, deterministic, built from rules/taxonomy.json detection hints.
// Every classification carries its evidence: the exact line(s) that triggered it.
// The `sensitivity:` header is NOT used as the answer — it is only a last-resort
// fallback, so the classifier is genuinely scored against ground truth.
import { LEVEL_RANK, maxLevel, parseFrontmatter, loadContactRegistries, OWNER_EMAIL } from './config.js';

const { clients: CLIENT_EMAILS, suppliers: SUPPLIER_EMAILS } = loadContactRegistries();

// --- helpers ---------------------------------------------------------------

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function quoteLine(content, index) {
  const start = content.lastIndexOf('\n', index - 1) + 1;
  let end = content.indexOf('\n', index);
  if (end === -1) end = content.length;
  return content.slice(start, end).trim();
}

function signal(content, regex, id, why) {
  const m = content.match(regex);
  if (!m) return null;
  return { id, why, quote: quoteLine(content, m.index), line: lineOf(content, m.index) };
}

function anySignal(content, specs) {
  const out = [];
  for (const [regex, id, why] of specs) {
    const s = signal(content, regex, id, why);
    if (s) out.push(s);
  }
  return out;
}

// --- document type ---------------------------------------------------------

export function docTypeOf(content, meta = {}) {
  const title = meta.title || '';
  const path = meta.path || '';
  if (/\.csv$/i.test(path)) return 'csv';
  if (/supplier invoice/i.test(title)) return 'invoice-received';
  if (/invoice/i.test(title) && /bill to/i.test(content)) return 'invoice-issued';
  if (/invoice/i.test(title) && /to lumen studio/i.test(content)) return 'invoice-received';
  if (/supplier list/i.test(title)) return 'supplier-list';
  if (/weekly plan/i.test(title)) return 'weekly-plan';
  if (/call notes/i.test(title)) return 'call-notes';
  if (/services agreement|contract/i.test(title)) return 'contract';
  if (/proposal/i.test(title)) return 'proposal';
  if (/case study/i.test(title)) return 'case-study';
  if (/price list/i.test(title)) return 'price-list';
  if (/about lumen studio/i.test(title) || /website_about/.test(path)) return 'website';
  if (meta.from && meta.to) return 'email';
  return 'other';
}

// --- regulated detection ---------------------------------------------------
// Actual personal/financial/health data, not mere mentions of the words.

const REGULATED_SPECS = [
  [/\b[A-Z]\d{7}[A-Z]\b/, 'nric', 'NRIC number (letter, 7 digits, letter)'],
  [/home address/i, 'home-address', 'Home address of a person'],
  [/(business account|card on file|bank account|paynow)/i, 'bank-details', 'Bank account / card / PayNow details'],
  [/(owner's private notes|bank balance|personal loan)/i, 'owner-finances', "Owner's personal financial information"],
  [/(hypertension|patient_name|reason_for_visit|diagnosis)/i, 'health-data', 'Actual health / patient data'],
  [/regulated\s+personal data/i, 'pdpa-self-declared', 'File describes itself as regulated personal data under the PDPA'],
  [/\+65\s?\d{4}\s?\d{4}/, 'phone-with-person', 'Phone number next to a person\u2019s name'],
];

function regulatedSignals(content, docType, path) {
  // A CSV contact list of identifiable people is regulated as a whole.
  if (docType === 'csv' || /\.csv$/i.test(path || '')) {
    const header = content.split('\n')[0].toLowerCase();
    if (header.includes('email') && header.includes('phone')) {
      return [{ id: 'contact-list', why: 'Contact list of identifiable people (names, emails, phone numbers)', quote: content.split('\n')[0].trim(), line: 1 }];
    }
  }
  const hits = anySignal(content, REGULATED_SPECS);
  // Exception: an invoice carries the studio's own receiving payment details.
  // Those are meant for the named party; the invoice stays internal.
  if (docType === 'invoice-issued' || docType === 'invoice-received') {
    return hits.filter((h) => h.id !== 'bank-details');
  }
  return hits;
}

// --- client-confidential detection ------------------------------------------

const CC_MARKERS = [
  [/(keep quiet|not public|isn't public|unannounced|under NDA|do not go below|strictly confidential|not announced)/i, 'confidentiality-marker', 'Client asked for this to be kept confidential'],
];

function clientConfidentialSignals(content, meta, docType) {
  const out = [];
  if (['contract', 'proposal', 'call-notes'].includes(docType)) {
    const first = content.split('\n').find((l) => l.trim() && !l.startsWith('---') && !l.includes(':')) || docType;
    out.push({ id: 'client-document', why: `Client ${docType} — belongs to the client under confidentiality`, quote: (meta.title || first).trim(), line: 1 });
  }
  out.push(...anySignal(content, CC_MARKERS));
  // A client's name next to their fundraising / financial figures.
  if (/(ferro|greenstep|harbourbean|nimbus)/i.test(content) && /(raising|valuation|\bARR\b|revenue)/i.test(content)) {
    const m = content.match(/(raising|valuation|\bARR\b|revenue)/i);
    out.push({ id: 'client-financials', why: 'Client name next to their non-public financial figures', quote: quoteLine(content, m.index), line: lineOf(content, m.index) });
  }
  // Email from a known client contact, negotiating price or discussing their account.
  if (docType === 'email' && meta.from && CLIENT_EMAILS.has(meta.from.toLowerCase())) {
    if (/(SGD|price|quote|match|settle|surcharge)/i.test(content)) {
      out.push({ id: 'client-email-commercial', why: `Email from client contact ${meta.from} about pricing / their account`, quote: `from: ${meta.from}`, line: 1 });
    }
  }
  return out;
}

// --- internal / public detection --------------------------------------------

function internalSignals(content, meta, docType) {
  const out = [];
  if (['invoice-issued', 'invoice-received', 'supplier-list', 'weekly-plan'].includes(docType)) {
    out.push({ id: 'business-working-doc', why: `Business working document (${docType})`, quote: (meta.title || docType).trim(), line: 1 });
  }
  if (docType === 'email' && meta.from) {
    const from = meta.from.toLowerCase();
    if (from === OWNER_EMAIL) {
      out.push({ id: 'owner-sent-email', why: 'Email sent by the owner to the named party (e.g. a payment reminder)', quote: `from: ${meta.from}`, line: 1 });
    } else if (SUPPLIER_EMAILS.has(from)) {
      out.push({ id: 'supplier-email', why: `Email from known supplier contact ${meta.from} about an order`, quote: `from: ${meta.from}`, line: 1 });
    }
  }
  return out;
}

function publicSignals(content, meta, docType) {
  const out = [];
  const approval = signal(content, /approved for publication/i, 'publication-approved', 'Client approved this for publication');
  if (approval) out.push(approval);
  if (['case-study', 'price-list', 'website'].includes(docType)) {
    out.push({ id: 'published-marketing', why: `Written to be published (${docType})`, quote: (meta.title || docType).trim(), line: 1 });
  }
  if (docType === 'email' && meta.from) {
    const from = meta.from.toLowerCase();
    const known = CLIENT_EMAILS.has(from) || SUPPLIER_EMAILS.has(from) || from === OWNER_EMAIL;
    if (!known && /(free for|trial|upload your|in minutes)/i.test(content)) {
      out.push({ id: 'vendor-marketing-email', why: 'Marketing email received from a vendor (not a client or supplier)', quote: `from: ${meta.from}`, line: 1 });
    }
  }
  return out;
}

// --- main entry --------------------------------------------------------------

// classify(content, meta) -> { level, rank, docType, signals, fallback }
// meta: { path, title, from, to } — frontmatter is parsed automatically.
export function classify(content, meta = {}) {
  const fm = parseFrontmatter(content);
  const merged = { ...fm, ...meta };
  const docType = docTypeOf(content, merged);

  const regulated = regulatedSignals(content, docType, merged.path);
  if (regulated.length) {
    return finish('regulated', docType, regulated);
  }

  // Publication approval beats client-name-plus-figure (the case-study trap).
  const pub = publicSignals(content, merged, docType);
  if (pub.some((s) => s.id === 'publication-approved')) {
    return finish('public', docType, pub);
  }

  const cc = clientConfidentialSignals(content, merged, docType);
  if (cc.length) return finish('client-confidential', docType, cc);

  const internal = internalSignals(content, merged, docType);
  if (internal.length) return finish('internal', docType, internal);

  if (pub.length) return finish('public', docType, pub);

  // Last resort only: the file's own header. Reported as a fallback so we can
  // see exactly where content-based detection was insufficient.
  if (fm.sensitivity && LEVEL_RANK[fm.sensitivity] !== undefined) {
    return { level: fm.sensitivity, rank: LEVEL_RANK[fm.sensitivity], docType, signals: [], fallback: 'header' };
  }
  return { level: 'internal', rank: LEVEL_RANK.internal, docType, signals: [], fallback: 'default' };
}

function finish(level, docType, signals) {
  return { level, rank: LEVEL_RANK[level], docType, signals, fallback: null };
}

// Classify a data file by relative path.
export function classifyFile(rel, readFn) {
  const content = readFn(rel);
  return classify(content, { path: rel });
}

// Sensitivity of an outbound message body (no frontmatter): classify the text,
// then take the highest level of any files it was derived from (lineage).
export function classifyDerived(content, inputLevels = []) {
  const own = classify(content, {});
  let level = own.level;
  for (const l of inputLevels) level = maxLevel(level, l);
  return { ...own, level, rank: LEVEL_RANK[level], inherited: inputLevels.length > 0 };
}