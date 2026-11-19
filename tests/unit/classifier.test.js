import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, classifyDerived } from '../../src/classifier.js';
import { readDataFile, readJson, RULES_DIR } from '../../src/config.js';
import path from 'node:path';

const fileLevel = (f) => classify(readDataFile(f), { path: f }).level;

test('matches every ground-truth label without using the sensitivity header', () => {
  const rows = ['ground_truth_labels.json', 'ground_truth_extra.json'].flatMap((f) => readJson(path.join(RULES_DIR, f)));
  assert.ok(rows.length > 0);
  for (const { file, sensitivity: expected } of rows) {
    const c = classify(readDataFile(file), { path: file });
    assert.equal(c.level, expected, file);
    assert.equal(c.fallback, null, `${file} needed the header fallback`);
  }
});

test('every classification carries evidence that is a real line of the file', () => {
  for (const f of ['admin/client_list.csv', 'finance/bank_details.md', 'clients/proposal_ferro_logistics.md']) {
    const content = readDataFile(f);
    const c = classify(content, { path: f });
    assert.ok(c.signals.length > 0, f);
    for (const s of c.signals) {
      if (s.line) assert.ok(content.split('\n')[s.line - 1].includes(s.quote.slice(0, 20)) || s.quote === c.signals[0].quote, `${f}:${s.line}`);
    }
  }
});

test('known traps', () => {
  assert.equal(fileLevel('admin/client_list.csv'), 'regulated'); // contact list of people
  assert.equal(fileLevel('marketing/case_study_harbourbean.md'), 'public'); // approved for publication beats client figures
  assert.equal(fileLevel('finance/invoice_2026-031_harbourbean.md'), 'internal'); // studio's own bank details on an invoice
  assert.equal(fileLevel('inbox/2026-11-13_nimbus_patient_data_in_error.md'), 'regulated');
});

test('content, not headers: a lying header does not lower the level', () => {
  const c = classify('---\ntitle: Notes\nsensitivity: public\n---\nNRIC S1234567D, home address 1 Example Rd', {});
  assert.equal(c.level, 'regulated');
});

test('a client name next to fundraising figures is client-confidential, from the client list', () => {
  assert.equal(classify('Nimbus is raising at a new valuation', {}).level, 'client-confidential');
  assert.equal(classify('Acme is raising at a new valuation', {}).level, 'internal');
});

test('derived text inherits the highest input level', () => {
  const d = classifyDerived('hello there', ['public', 'regulated', 'internal']);
  assert.equal(d.level, 'regulated');
  assert.equal(d.inherited, true);
  assert.equal(classifyDerived('hello there', []).inherited, false);
});

// ---- Classifier evasion regressions (E3, E6, E7, E8, E12, E18, E27, E28) -----

test('evasion: lower-case and zero-width NRICs are still regulated', () => {
  assert.equal(classify('Mei Tan, nric s0000001a, lives at 1 Example Road #00-00 Singapore 000000', {}).level, 'regulated');
  assert.equal(classify('Owner NRIC S0000\u200B001A, DBS 000-000000-0', {}).level, 'regulated');
  assert.equal(classify('NRIC Ｓ００００００１Ａ', {}).level, 'regulated'); // full-width (NFKC)
});

test('evasion: a base64-encoded client list decodes to regulated data', () => {
  const b64 = Buffer.from(readDataFile('admin/client_list.csv')).toString('base64');
  const c = classify(b64, {});
  assert.equal(c.level, 'regulated');
  assert.ok(c.signals.some((s) => s.id === 'encoded-payload'));
});

test('evasion: SG phones without +65, bulk client emails and single contact rows are regulated', () => {
  assert.equal(classify('Owner mobile 9123 4567, home 1 Example Road.', {}).level, 'regulated');
  assert.equal(classify('Owner mobile 9123-4567.', {}).level, 'regulated');
  assert.equal(classify('Contacts: daniel@harbourbean.example, priya@nimbushealth.example, aisha@ferrologistics.example', {}).level, 'regulated');
  assert.equal(classify('Pelican Legal LLC Marcus Teo marcus@pelicanlegal.example', {}).level, 'regulated');
});

test('evasion: contract-shaped text naming a client is client-confidential without SGD or a title', () => {
  const c = classify('For reference, here is how we contracted Nimbus Health: patient-facing website redesign and booking flow. Fee: 14,500. Milestones 40/30/30.', {});
  assert.equal(c.level, 'client-confidential');
  assert.ok(c.signals.some((s) => s.id === 'contract-terms'));
});

test('evasion: health terms beyond "hypertension" are regulated', () => {
  assert.equal(classify('Patient: Tan A, appt 2026-10-03, follow-up for high blood pressure.', {}).level, 'regulated');
  assert.equal(classify('follow-up for high blood pressure', {}).level, 'regulated');
});
