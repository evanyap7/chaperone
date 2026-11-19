import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDataPath, readDataFile, parseCsv, parseFrontmatter, orgKey, firstName,
  loadClients, loadSuppliers, paymentLimit, loadPriceList, policy, OWNER_EMAIL, OWNER_FIRST_NAME, maxLevel,
} from '../../src/config.js';

test('resolveDataPath refuses anything outside data/', () => {
  for (const bad of ['../package.json', '../../etc/passwd', '/etc/passwd', 'admin/../../src/config.js', '', 'a\0b', null, 42]) {
    assert.throws(() => resolveDataPath(bad), `${JSON.stringify(bad)} should be refused`);
  }
  assert.throws(() => readDataFile('../rules/policy.json'));
  assert.ok(resolveDataPath('admin/client_list.csv').endsWith('client_list.csv'));
});

test('parseCsv handles quotes, escaped quotes, commas and CRLF', () => {
  const rows = parseCsv('name,note\r\n"Koh, Daniel","said ""hi"""\r\nPlain,x\r\n\r\n');
  assert.deepEqual(rows, [{ name: 'Koh, Daniel', note: 'said "hi"' }, { name: 'Plain', note: 'x' }]);
});

test('parseFrontmatter reads LF and CRLF headers', () => {
  assert.deepEqual(parseFrontmatter('---\ntitle: A\nfrom: x@y.z\n---\nbody'), { title: 'A', from: 'x@y.z' });
  assert.deepEqual(parseFrontmatter('---\r\ntitle: B\r\n---\r\nbody'), { title: 'B' });
  assert.deepEqual(parseFrontmatter('no header'), {});
});

test('name helpers', () => {
  assert.equal(orgKey('Ferro Logistics Pte Ltd'), 'ferro');
  assert.equal(firstName('Dr Priya Nair'), 'Priya');
  assert.equal(firstName('Mr. Daniel Koh'), 'Daniel');
  assert.equal(firstName(''), '');
});

test('clients, suppliers, owner, limit and prices come from the kit files', () => {
  const clients = loadClients();
  const csv = parseCsv(readDataFile('admin/client_list.csv')).filter((r) => r.email?.includes('@'));
  assert.equal(clients.length, csv.length);
  assert.ok(clients.every((c) => c.email === c.email.toLowerCase() && c.key));
  const suppliers = loadSuppliers();
  assert.ok(suppliers.length >= 1);
  for (const s of suppliers) assert.ok(readDataFile('admin/supplier_list.md').toLowerCase().includes(s.email));
  assert.ok(OWNER_EMAIL && readDataFile('00_README.md').toLowerCase().includes(OWNER_EMAIL));
  assert.equal(OWNER_FIRST_NAME, policy.owner.split(' ')[0]);
  const r10 = policy.rules.find((r) => r.id === 'R10').condition.replace(/,/g, '');
  assert.ok(r10.includes(String(paymentLimit())));
  const prices = loadPriceList();
  assert.ok(prices.length > 0);
  for (const p of prices) assert.equal(readDataFile(p.file).split('\n')[p.line - 1].trim(), p.quote);
});

test('maxLevel never goes down', () => {
  assert.equal(maxLevel('public', 'regulated'), 'regulated');
  assert.equal(maxLevel('regulated', 'public'), 'regulated');
  assert.equal(maxLevel(null, 'internal'), 'internal');
  assert.equal(maxLevel('internal', null), 'internal');
});
