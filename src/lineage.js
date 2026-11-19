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
  //
  // Re-writing an artifact that already exists never launders it: the new node
  // keeps the old level, unannounced flag, facts and ancestry, so overwriting a
  // confidential summary with "harmless" text cannot downgrade it.
  addOutput(id, inputIds, ownLevel, opts = {}) {
    const prev = this.nodes.get(id);
    let level = maxLevel(prev?.level || null, ownLevel || null);
    let unannounced = !!opts.unannounced || !!prev?.unannounced;
    const facts = new Set([...(prev?.facts || []), ...(opts.facts || [])]);
    const derived = new Set(prev?.derived_from || []);
    for (const inp of inputIds) {
      if (inp === id) continue; // an artifact is not its own ancestor
      const n = this.nodes.get(inp);
      if (n) {
        level = maxLevel(level, n.level);
        unannounced = unannounced || n.unannounced;
        for (const f of n.facts || []) facts.add(f);
      }
      derived.add(inp);
    }
    const node = {
      id, kind: prev?.kind === 'file' ? 'file' : 'output', level: level || 'internal',
      unannounced, facts: [...facts], derived_from: [...derived],
      content: opts.content ?? prev?.content ?? null,
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

  // Every ancestor (and the node itself) flagged as carrying unannounced news.
  unannouncedSources(id) {
    return this.chainOf(id).filter((n) => n.unannounced && this.nodes.get(n.id)?.kind === 'file').map((n) => n.id);
  }

  // Effective level of an artifact = its own inherited level (never downgrades).
  effectiveLevel(id, ownLevel) {
    return maxLevel(this.levelOf(id), ownLevel);
  }
}