// Phase 1 — score the content-based classifier against the kit's ground truth.
// Usage: npm run score
import fs from 'node:fs';
import path from 'node:path';
import { classifyFile } from '../src/classifier.js';
import { readDataFile, listDataFiles, readJson, RULES_DIR, REPORTS_DIR } from '../src/config.js';

const truth = readJson(path.join(RULES_DIR, 'ground_truth_labels.json'));
const extraPath = path.join(RULES_DIR, 'ground_truth_extra.json');
if (fs.existsSync(extraPath)) truth.push(...readJson(extraPath)); // labels for our S6–S10 files
const rows = [];
let correct = 0;

for (const { file, sensitivity } of truth) {
  const result = classifyFile(file, readDataFile);
  const ok = result.level === sensitivity;
  if (ok) correct++;
  rows.push({
    file,
    expected: sensitivity,
    predicted: result.level,
    ok,
    docType: result.docType,
    fallback: result.fallback,
    evidence: result.signals.map((s) => `${s.id}: "${s.quote}" (line ${s.line})`),
  });
}

const accuracy = correct / truth.length;
const mismatches = rows.filter((r) => !r.ok);
const fallbacks = rows.filter((r) => r.fallback);

console.log(`Classifier accuracy: ${correct}/${truth.length} = ${(accuracy * 100).toFixed(1)}%`);
if (mismatches.length) {
  console.log('\nMismatches:');
  for (const m of mismatches) console.log(`  ${m.file}: expected ${m.expected}, predicted ${m.predicted}`);
} else {
  console.log('No mismatches.');
}
if (fallbacks.length) {
  console.log('\nFiles classified via fallback (not content signals):');
  for (const f of fallbacks) console.log(`  ${f.file} (${f.fallback})`);
}

// Also classify files that are not in the ground truth (informational).
const labelled = new Set(truth.map((t) => t.file));
const unlabelled = listDataFiles().filter((f) => !labelled.has(f) && f !== '00_README.md');
for (const f of unlabelled) {
  const r = classifyFile(f, readDataFile);
  console.log(`\nUnlabelled file: ${f} -> ${r.level}${r.fallback ? ` (fallback: ${r.fallback})` : ''}`);
}

fs.mkdirSync(REPORTS_DIR, { recursive: true });
const report = {
  generated_at: new Date().toISOString(),
  total: truth.length,
  correct,
  accuracy,
  mismatches: mismatches.map((m) => ({ file: m.file, expected: m.expected, predicted: m.predicted })),
  fallbacks: fallbacks.map((f) => ({ file: f.file, fallback: f.fallback })),
  rows,
};
fs.writeFileSync(path.join(REPORTS_DIR, 'classifier_score.json'), JSON.stringify(report, null, 2));
console.log(`\nReport written to reports/classifier_score.json`);
process.exit(mismatches.length ? 1 : 0);