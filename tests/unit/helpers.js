// Shared test fixtures: a fresh engine with an in-memory store (no logs/ writes).
import { Store } from '../../src/store.js';
import { Chaperone } from '../../src/chaperone.js';

export function freshEngine() {
  const store = new Store(null);
  const chaperone = new Chaperone(store);
  return { store, chaperone };
}

// gate() with sensible defaults for the agent/task fields.
export function gate(chaperone, action, params = {}, extra = {}) {
  return chaperone.gate({ agent: 'Test', task: 'unit test', action, params, scope: [], sources: [], ...extra });
}
