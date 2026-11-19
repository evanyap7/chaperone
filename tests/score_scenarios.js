// Scenario scorer CLI. Three checks per scenario, exactly as the kit scores:
//   1. right decision  (on the scenario's primary action)
//   2. right rule(s)   (every expected rule cited somewhere in the run)
//   3. evidence cited  (every expected evidence item matched by a real quote)
// S1–S5 = 15 points (the kit floor). S6–S10 = 15 more (our own scenarios).
// The checks themselves live in src/score.js, shared with the live demo.
// Usage: node tests/score_scenarios.js [S1 S2 ...]   (default: all defined)
import fs from 'node:fs';
import path from 'node:path';
import { scoreScenario } from '../src/score.js';
import { SCRIPTS, loadScenarioDefs } from '../src/scenarios.js';
import { REPORTS_DIR } from '../src/config.js';

const defs = loadScenarioDefs();
const wanted = process.argv.slice(2).filter((a) => /^S\d+$/.test(a));
const selected = defs.filter((d) => SCRIPTS[d.id] && (!wanted.length || wanted.includes(d.id)));

const results = selected.map(scoreScenario);
const total = results.reduce((a, r) => a + r.points, 0);
const max = results.length * 3;

console.log('\nChaperone scenario scorecard');
console.log('='.repeat(72));
for (const r of results) {
  const mark = (ok) => (ok ? 'PASS' : 'FAIL');
  console.log(`${r.id}  ${r.name}`);
  console.log(`    decision ${mark(r.checks.decision)} (${r.got_decision})   rules ${mark(r.checks.rules)} [${r.got_rules.join(',')}]   evidence ${mark(r.checks.evidence)}   data level ${r.got_data_level}${r.data_level_match ? '' : ` (expected ${r.expected_data_level})`}`);
  if (r.failed_evidence.length) console.log(`    missing evidence: ${r.failed_evidence.join('; ')}`);
  console.log(`    points ${r.points}/3`);
}
console.log('='.repeat(72));
console.log(`TOTAL: ${total}/${max}  (${((total / max) * 100).toFixed(1)}%)`);

fs.mkdirSync(REPORTS_DIR, { recursive: true });
const report = { generated_at: new Date().toISOString(), total, max, accuracy: total / max, results };
fs.writeFileSync(path.join(REPORTS_DIR, 'scenario_score.json'), JSON.stringify(report, null, 2));
console.log(`Report: reports/scenario_score.json`);
process.exit(total === max ? 0 : 1);