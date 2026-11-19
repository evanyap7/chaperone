import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lineage } from '../../src/lineage.js';
import { freshEngine, gate } from './helpers.js';

test('outputs inherit the highest level of every input', () => {
  const l = new Lineage();
  l.addFile('a', 'public');
  l.addFile('b', 'client-confidential', { unannounced: true, facts: ['x'] });
  const n = l.addOutput('out', ['a', 'b'], 'public');
  assert.equal(n.level, 'client-confidential');
  assert.equal(n.unannounced, true);
  assert.deepEqual(n.facts, ['x']);
  assert.deepEqual(l.chainOf('out').map((c) => c.id), ['a', 'b', 'out']);
  assert.deepEqual(l.unannouncedSources('out'), ['b']);
});

test('chains are transitive', () => {
  const l = new Lineage();
  l.addFile('src', 'regulated');
  l.addOutput('mid', ['src'], 'internal');
  l.addOutput('final', ['mid'], 'public');
  assert.equal(l.levelOf('final'), 'regulated');
  assert.deepEqual(l.chainOf('final').map((c) => c.id), ['src', 'mid', 'final']);
});

test('never downgrades: rewriting an output with harmless text keeps its level', () => {
  const l = new Lineage();
  l.addFile('secret', 'client-confidential', { unannounced: true });
  l.addOutput('summary', ['secret'], 'internal');
  const again = l.addOutput('summary', [], 'public', { content: 'nothing to see' });
  assert.equal(again.level, 'client-confidential');
  assert.equal(again.unannounced, true);
  assert.deepEqual(again.derived_from, ['secret']);
});

test('re-registering a file never lowers it, and self-derivation is ignored', () => {
  const l = new Lineage();
  l.addFile('f', 'regulated');
  l.addFile('f', 'public');
  assert.equal(l.levelOf('f'), 'regulated');
  const n = l.addOutput('f', ['f'], 'public');
  assert.equal(n.kind, 'file');
  assert.deepEqual(n.derived_from, []);
  assert.deepEqual(l.chainOf('f').map((c) => c.id), ['f']);
});

test('engine: a reworded summary of a confidential proposal is still blocked on upload (laundering)', () => {
  const { chaperone } = freshEngine();
  const src = 'clients/proposal_ferro_logistics.md';
  gate(chaperone, 'write_file', { file: 'notes/x.md', derived_from: [src], content: 'They are doing well.' });
  // Overwrite with innocuous text and no declared source: still inherits.
  gate(chaperone, 'write_file', { file: 'notes/x.md', content: 'Weather is nice.' });
  const up = gate(chaperone, 'upload_to_external_tool', { file: 'notes/x.md', target: 'tool.example' });
  assert.equal(up.decision, 'BLOCK');
  assert.ok(up.rules.includes('R19'));
  assert.ok(up.evidence.some((e) => e.file === src && /raising/i.test(e.quote)));
});
