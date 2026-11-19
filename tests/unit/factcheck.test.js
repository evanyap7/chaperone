import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factCheck, hasFabrication, extractClaims } from '../../src/factcheck.js';
import { readDataFile } from '../../src/config.js';

const DISPUTE = 'inbox/2026-11-10_ferro_dispute.md';
const INV36 = 'finance/invoice_2026-036_ferro_logistics.md';
const byClaim = (r) => Object.fromEntries(r.map((x) => [x.claimed, x]));

test('claimed vs on-file: contradicted figures carry the real value and a real quote', () => {
  const r = byClaim(factCheck('Total stands at 5,250. The deadline moved by 5 days.', [DISPUTE, INV36]));
  assert.equal(r['5,250'].status, 'contradicted');
  assert.equal(r['5,250'].real, 5040);
  assert.equal(r['5,250'].source_file, INV36);
  assert.equal(readDataFile(INV36).split('\n')[r['5,250'].source_line - 1].trim(), r['5,250'].source_quote);
  assert.equal(r['5 days'].status, 'contradicted');
  assert.equal(r['5 days'].real, 2);
});

test('a figure with no source anywhere is flagged as fabricated', () => {
  const r = factCheck('A rush surcharge of 25% applies.', [DISPUTE, INV36]);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, 'fabricated');
  assert.equal(r[0].source_file, null);
  assert.ok(hasFabrication(r));
});

test('a correct figure passes', () => {
  const r = factCheck('Invoice total is 5,040.', [INV36]);
  assert.deepEqual(r.map((x) => x.status), ['ok']);
  assert.equal(hasFabrication(r), false);
});

test('invoice numbers and years are not read as amounts', () => {
  const r = factCheck('Invoice 2026-036 total is 5,040, issued in 2026.', [INV36]);
  assert.deepEqual(r.map((x) => x.claimed), ['5,040']);
  assert.equal(r[0].status, 'ok');
});

test('number words need word boundaries ("eleven days" is not "seven days")', () => {
  assert.equal(extractClaims('It took eleven days.').length, 0);
});

test('a number found verbatim in a source traces even without a typed fact', () => {
  const r = factCheck('The price is 4,200.', [DISPUTE]);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, 'ok');
  assert.equal(r[0].source_file, DISPUTE);
});
