// Lineage graph. Every output an agent creates inherits the HIGHEST sensitivity
// of every input it was derived from. Sensitivity never goes down because content
// was summarised, reworded or split. The graph is shown in the UI as a visible
// chain: source file -> derived output -> attempted action.
import { maxLevel, LEVEL_RANK } from './config.js';

export class Lineage {
  constructor() {
    // node id -> { id, kind: 'file'|'output'|'action', level, unannounced, facts, derived_from: [ids] }
    this.nodes = new Map();
  }

  reset() { this.nodes.clear(); }

  // Register a source file with its classified level and any unannounced facts.
  addFile(path, level, opts = {}) {
    const existing = this.nodes.get(path);
    const node = existing || { id: path, kind: 'file', derived_from: [] };
    node.level = maxLevel(node.level, level);
    node.unannounced = node.unannounced || !!opts.unannounced;
    node.facts = [...new Set([...(node.facts || []), ...(opts.facts || [])])];
    this.nodes.set(path, node);
    return node;
  }

  // Register a derived output. It inherits the max level + unannounced flag of
  // every input, regardless of how casually it is worded.
  addOutput(id, inputIds, ownLevel, opts = {}) {
    let level = ownLevel || null;
    let unannounced = !!opts.unannounced;
    const facts = new Set(opts.facts || []);
    const resolvedInputs = [];
    for (const inp of inputIds) {
      const n = this.nodes.get(inp);
      if (n) {
        level = maxLevel(level, n.level);
        unannounced = unannounced || n.unannounced;
        for (const f of n.facts || []) facts.add(f);
        resolvedInputs.push(inp);
      } else {
        resolvedInputs.push(inp);
      }
    }
    const node = {
      id, kind: 'output', level: level || 'internal',
      unannounced, facts: [...facts], derived_from: resolvedInputs,
      content: opts.content ?? null,
    };
    this.nodes.set(id, node);
    return node;
  }

  levelOf(id) {
    return this.nodes.get(id)?.level || null;
  }

  isUnannounced(id) {
    return !!this.nodes.get(id)?.unannounced;
  }

  factsOf(id) {
    return this.nodes.get(id)?.facts || [];
  }

  // Full ancestor chain for an artifact (source files first), for the UI.
  chainOf(id, seen = new Set()) {
    if (seen.has(id)) return [];
    seen.add(id);
    const node = this.nodes.get(id);
    if (!node) return [{ id, level: null }];
    const chain = [];
    for (const inp of node.derived_from) chain.push(...this.chainOf(inp, seen));
    chain.push({ id, level: node.level, kind: node.kind, unannounced: node.unannounced });
    return chain;
  }

  // Effective level of an artifact = its own inherited level (never downgrades).
  effectiveLevel(id, ownLevel) {
    return maxLevel(this.levelOf(id), ownLevel);
  }
}