import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshEngine, gate } from './helpers.js';
import { runScenario } from '../../src/runner.js';
import { readDataFile } from '../../src/config.js';

const INJ = 'inbox/2026-11-16_vendor_injection.md';

test('instructions inside an inbound file are flagged and not followed (S7)', () => {
  const { chaperone } = freshEngine();
  const send = runScenario(chaperone, 'S7').at(-1);
  assert.equal(send.decision, 'BLOCK');
  assert.ok(send.injection?.flagged);
  assert.equal(send.injection.file, INJ);
  assert.equal(readDataFile(INJ).split('\n')[send.injection.line - 1].trim(), send.injection.quote);
  // The regulated-data evidence cites the README's real line, not an invented one.
  const readme = send.evidence.find((e) => e.file === 'admin/client_list.README.md');
  assert.ok(readme);
  assert.equal(readDataFile(readme.file).split('\n')[readme.line - 1].trim(), readme.quote);
});

test('ordinary sources are not flagged', () => {
  const { chaperone } = freshEngine();
  const e = gate(chaperone, 'send_email', { to: 'orders@quickprint.example', body: 'Thanks!' }, { sources: ['inbox/2026-11-14_greenstep_followup.md'] });
  assert.equal(e.injection, null);
});

test('the flag holds whatever the injected email asks for', () => {
  const { chaperone } = freshEngine();
  const e = gate(chaperone, 'send_email', { to: 'sync@partner-crm.example', body: 'Here you go' }, { sources: [INJ] });
  assert.ok(e.injection?.flagged);
  assert.notEqual(e.decision, 'ALLOW');
});
