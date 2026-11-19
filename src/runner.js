// Runs a scripted worker scenario through the gate. Used by the scorer and by
// the live demo replay — the exact same action stream, the exact same gate.
import { SCRIPTS } from './scenarios.js';

export function runScenario(chaperone, id, { onEntry = null } = {}) {
  const s = SCRIPTS[id];
  if (!s) throw new Error(`unknown scenario ${id}`);
  const entries = [];
  for (const step of s.steps) {
    const entry = chaperone.gate({
      agent: s.agent,
      task: s.task,
      action: step.action,
      params: step.params,
      scope: s.scope,
      sources: s.sources,
      scenario: id,
    });
    entries.push(entry);
    if (onEntry) onEntry(entry);
  }
  return entries;
}

export async function runScenarioLive(chaperone, id, { delayMs = 700, onEntry = null, runId = null } = {}) {
  const s = SCRIPTS[id];
  if (!s) throw new Error(`unknown scenario ${id}`);
  const entries = [];
  for (const step of s.steps) {
    const entry = chaperone.gate({
      agent: s.agent, task: s.task, action: step.action, params: step.params,
      scope: s.scope, sources: s.sources, scenario: id, run_id: runId,
    });
    entries.push(entry);
    if (onEntry) onEntry(entry);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return entries;
}