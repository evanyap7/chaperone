// Shared paths and loaders. No secrets here — everything is local kit data.
// Names, emails, limits and floors are read from the kit's own files, never
// typed in here: every figure traces to a file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const RULES_DIR = path.join(ROOT, 'rules');
export const LOGS_DIR = path.join(ROOT, 'logs');
export const REPORTS_DIR = path.join(ROOT, 'reports');

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export const policy = readJson(path.join(RULES_DIR, 'policy.json'));
export const taxonomy = readJson(path.join(RULES_DIR, 'taxonomy.json'));

export const LEVEL_RANK = Object.fromEntries(
  taxonomy.levels.map((l) => [l.id, l.rank])
);
export const LEVELS = taxonomy.levels.map((l) => l.id); // low -> high

export function maxLevel(a, b) {
  if (!a) return b;
  if (!b) return a;
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

// Walk every data file (relative paths like "admin/client_list.csv").
export function listDataFiles(dir = DATA_DIR, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listDataFiles(path.join(dir, entry.name), rel));
    else if (/\.(md|csv|txt)$/i.test(entry.name)) out.push(rel);
  }
  return out.sort();
}

// Resolve a data-relative path, refusing anything that escapes data/.
// Agent-supplied paths reach this function, so "../" must never work.
export function resolveDataPath(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) {
    throw new Error(`invalid data path: ${JSON.stringify(rel)}`);
  }
  const abs = path.resolve(DATA_DIR, rel);
  const inside = path.relative(DATA_DIR, abs);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error(`path outside data/: ${rel}`);
  }
  return abs;
}

export function readDataFile(rel) {
  return fs.readFileSync(resolveDataPath(rel), 'utf8');
}

// Parse YAML-ish frontmatter used by the kit (title, sensitivity, from, to, date).
export function parseFrontmatter(content) {
  const meta = {};
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return meta;
}

// Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, commas in quotes).
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header = [], ...body] = rows.filter((r) => r.some((c) => c.trim()));
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Short match key for an organisation: its first word, lower-cased
// ("Ferro Logistics Pte Ltd" -> "ferro"). Used to find its files and mentions.
export function orgKey(name) {
  return String(name || '').trim().split(/\s+/)[0].toLowerCase();
}

// First name of a contact, without honorifics ("Dr Priya Nair" -> "Priya").
export function firstName(contact) {
  const parts = String(contact || '').trim().split(/\s+/).filter((p) => !/^(dr|mr|mrs|ms|mdm|prof)\.?$/i.test(p));
  return parts[0] || '';
}

// Clients from admin/client_list.csv: [{ name, contact, email, key }].
export function loadClients() {
  return parseCsv(readDataFile('admin/client_list.csv'))
    .filter((r) => r.email && r.email.includes('@'))
    .map((r) => ({ name: r.client, contact: r.contact, email: r.email.toLowerCase(), key: orgKey(r.client) }));
}

// Suppliers from admin/supplier_list.md (markdown table): [{ name, email, key }].
export function loadSuppliers() {
  const out = [];
  for (const line of readDataFile('admin/supplier_list.md').split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const email = cells.join(' ').match(EMAIL_RE)?.[0];
    if (email) out.push({ name: cells[0], email: email.toLowerCase(), key: orgKey(cells[0]) });
  }
  return out;
}

// Known client and supplier email addresses, parsed from the kit's own lists.
export function loadContactRegistries() {
  return {
    clients: new Set(loadClients().map((c) => c.email)),
    suppliers: new Set(loadSuppliers().map((s) => s.email)),
  };
}

// Owner identity: the name from rules/policy.json, the email from the line in
// data/00_README.md that names the owner ("Owner: Mei Tan · mei@... · ...").
function loadOwner() {
  const name = policy.owner;
  let email = null;
  try {
    const readme = readDataFile('00_README.md');
    const line = readme.split('\n').find((l) => /^owner:/i.test(l.trim()) && l.includes(name));
    email = line?.match(EMAIL_RE)?.[0]?.toLowerCase() ?? null;
  } catch { /* README missing: owner email unknown */ }
  return { name, email };
}
const OWNER = loadOwner();
export const OWNER_NAME = OWNER.name;
export const OWNER_EMAIL = OWNER.email;
export const OWNER_FIRST_NAME = firstName(OWNER_NAME);

// Supplier-payment approval limit, read from the R10 rule text
// ("an invoice already received, under SGD 1,000").
export function paymentLimit() {
  const r10 = policy.rules.find((r) => r.id === 'R10');
  const m = r10?.condition.match(/under SGD\s*([\d,]+)/i);
  if (!m) throw new Error('rules/policy.json R10 must state "under SGD <amount>"');
  return parseFloat(m[1].replace(/,/g, ''));
}

// Published prices from marketing/price_list_*.md: [{ service, price, file, line, quote }].
export function loadPriceList() {
  const file = listDataFiles().find((f) => /^marketing\/price_list/.test(f));
  if (!file) return [];
  const content = readDataFile(file);
  const out = [];
  content.split('\n').forEach((line, i) => {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([\d,]+)\s*\|$/);
    if (m) out.push({ service: m[1], price: parseFloat(m[2].replace(/,/g, '')), file, line: i + 1, quote: line.trim() });
  });
  return out;
}
