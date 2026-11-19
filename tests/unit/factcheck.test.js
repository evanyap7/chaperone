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

// ---- Fix 11 regressions (F1-F6, F8, F9, F10, F12) ----------------------------

test('fix11: percents, fractions, working/business days, dates and bare totals are all extracted', () => {
  const claims = extractClaims('The surcharge is 25 per cent, one quarter of the fee. It moved by 5 working days, two business days, to 30 Sep. You owe 5,250; the balance is 9,999.');
  const by = (type, value) => claims.some((c) => c.type === type && Math.abs(c.value - value) < 0.01);
  assert.ok(by('percent', 25), '25 per cent');
  assert.ok(by('percent', 25), 'one quarter');
  assert.ok(by('days', 5), '5 working days');
  assert.ok(by('days', 2), 'two business days');
  assert.ok(claims.some((c) => c.type === 'date' && c.value.day === 30 && c.value.month === 9), '30 Sep');
  assert.ok(by('amount', 5250), 'you owe 5,250');
  assert.ok(by('amount', 9999), 'balance is 9,999');
  assert.ok(extractClaims('a third of the fee').some((c) => c.type === 'percent' && Math.abs(c.value - 100 / 3) < 0.01));
  assert.ok(extractClaims('a fifth of the fee').some((c) => c.type === 'percent' && c.value === 20));
  assert.ok(extractClaims('half the fee').some((c) => c.type === 'percent' && c.value === 50));
  assert.ok(extractClaims('comes to five thousand two hundred and fifty dollars').some((c) => c.type === 'amount' && c.value === 5250));
});

test('fix11 F5: a claimed date that contradicts the file is contradicted, with the real date', () => {
  const r = factCheck('Recall the deadline was moved to 30 Sep at your request.', [DISPUTE, INV36]);
  const date = r.find((x) => /30\s+Sep/.test(x.claimed));
  assert.equal(date.status, 'contradicted');
  assert.match(date.source_quote, /24 Sep/);
  assert.equal(date.source_file, INV36);
  const ok = factCheck('The deadline was moved to 24 Sep.', [INV36]);
  assert.deepEqual(ok.map((x) => x.status), ['ok']);
});

test('fix11 F6: working days are compared to the real day count', () => {
  const r = factCheck('The deadline moved by 5 working days.', [DISPUTE, INV36]);
  assert.equal(r[0].status, 'contradicted');
  assert.equal(r[0].real, 2);
});

test('fix11 F3/F4: "you owe" and number-word totals are checked against the invoice', () => {
  const a = factCheck('All in, you owe 5,250 on 2026-036.', [DISPUTE, INV36]);
  assert.equal(a[0].status, 'contradicted');
  assert.equal(a[0].real, 5040);
  const b = factCheck('The bill comes to five thousand two hundred and fifty dollars.', [DISPUTE, INV36]);
  assert.equal(b[0].status, 'contradicted');
  assert.equal(b[0].real, 5040);
});

test('fix11 F9: recipient-org filtering stops source shopping', () => {
  const r = factCheck('The rush surcharge on 2026-036 is SGD 4,350.', ['finance/invoice_2026-034_nimbus_health.md'], { recipientOrg: 'ferro' });
  assert.equal(r[0].status, 'contradicted');
  assert.ok(!/nimbus/.test(r[0].source_file || ''), 'the Nimbus invoice is not a Ferro source');
});

test('fix11 F8/F10: the recipient\'s own files are the fallback — true figures pass, wrong ones fail', () => {
  const ok = factCheck('The rush surcharge is 20 per cent.', [], { recipientOrg: 'ferro' });
  assert.deepEqual(ok.map((x) => x.status), ['ok']);
  const bad = factCheck('Your outstanding balance is 9,999.', [], { recipientOrg: 'ferro' });
  assert.equal(bad[0].status, 'contradicted');
});
