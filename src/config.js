// Shared paths and loaders. No secrets here — everything is local kit data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const RULES_DIR = path.join(ROOT, 'rules');
export const LOGS_DIR = path.join(ROOT, 'logs');
export const REPORTS_DIR = path.join(ROOT, 'reports');

export const OWNER_EMAIL = 'mei@lumenstudio.example';
export const OWNER_NAME = 'Mei Tan';

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

export function readDataFile(rel) {
  return fs.readFileSync(path.join(DATA_DIR, rel), 'utf8');
}

// Parse YAML-ish frontmatter used by the kit (title, sensitivity, from, to, date).
export function parseFrontmatter(content) {
  const meta = {};
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (m) {
    for (const line of m[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return meta;
}

// Known client and supplier email addresses, parsed from the kit's own lists.
export function loadContactRegistries() {
  const clients = new Set();
  const csv = readDataFile('admin/client_list.csv');
  for (const line of csv.split('\n').slice(1)) {
    const cols = line.split(',');
    if (cols[2] && cols[2].includes('@')) clients.add(cols[2].trim().toLowerCase());
  }
  const suppliers = new Set();
  const md = readDataFile('admin/supplier_list.md');
  for (const m of md.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    suppliers.add(m[0].toLowerCase());
  }
  return { clients, suppliers };
}