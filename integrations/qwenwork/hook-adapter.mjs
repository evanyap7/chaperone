#!/usr/bin/env node
// Chaperone PreToolUse hook adapter (zero deps, Node >= 18).
//
// Reads one Claude-Code-style PreToolUse hook payload on stdin:
//   {"tool_name": "Bash", "tool_input": {"command": "rm finance/invoice_2026-031_harbourbean.md"}}
// maps it to a Chaperone action envelope, POSTs it to http://127.0.0.1:<port>/api/hook
// with Authorization: Bearer $CHAPERONE_OWNER_TOKEN, and prints the decision.
//
// Output contracts (both supported):
//   default        {"decision":"allow"|"deny","reason":"..."}
//   --claude-output (or CHAPERONE_HOOK_OUTPUT=claude):
//                  {"hookSpecificOutput":{"hookEventName":"PreToolUse",
//                   "permissionDecision":"allow"|"deny","permissionDecisionReason":"..."}}
//
// HOLD maps to deny with reason "held for owner approval (queue <id>)" — the
// gate queues the item for the owner; the tool call does not run.
//
// Fail closed: bad stdin, missing token, unreachable gate, timeout or HTTP
// error all print a deny. The tool never runs when the gate cannot be reached.
//
// Env:
//   CHAPERONE_URL          default http://127.0.0.1:8081
//   CHAPERONE_OWNER_TOKEN  required for the HTTP path
//   CHAPERONE_AGENT        agent name recorded in the log
//   CHAPERONE_TASK         task name (scope comes from rules/tasks.json)
//
// Flags:
//   --in-process     skip HTTP; run the exact /api/hook handler against a fresh
//                    in-memory Chaperone/Store. Used to prove the adapter
//                    end-to-end before the orchestrator mounts /api/hook.
//   --claude-output  emit the hookSpecificOutput form.
import { mapToolToEnvelope } from './mapper.mjs';
import { createHookHandler } from './hook-handler.js';

const argv = process.argv.slice(2);
const IN_PROCESS = argv.includes('--in-process');
const CLAUDE_OUTPUT = argv.includes('--claude-output') || process.env.CHAPERONE_HOOK_OUTPUT === 'claude';
const BASE = (process.env.CHAPERONE_URL || 'http://127.0.0.1:8081').replace(/\/+$/, '');
const TOKEN = process.env.CHAPERONE_OWNER_TOKEN;

function emit(decision, reason) {
  const out = CLAUDE_OUTPUT
    ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } }
    : { decision, reason };
  process.stdout.write(JSON.stringify(out) + '\n');
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return emit('deny', 'fail closed: stdin is not valid JSON');
  }
  if (!payload || typeof payload !== 'object') return emit('deny', 'fail closed: hook payload must be a JSON object');

  // Map once, here at the tool boundary; the handler also accepts raw payloads.
  const envelope = typeof payload.tool_name === 'string'
    ? mapToolToEnvelope(payload.tool_name, payload.tool_input ?? {}, {
        agent: process.env.CHAPERONE_AGENT || payload.agent,
        task: process.env.CHAPERONE_TASK || payload.task,
      })
    : payload;

  if (IN_PROCESS) {
    const { Chaperone } = await import('../../src/chaperone.js');
    const { Store } = await import('../../src/store.js');
    const store = new Store(null); // in-memory only; never touches logs/
    const handler = createHookHandler({ chaperone: new Chaperone(store), store });
    const r = await handler(envelope);
    return emit(r.decision, r.reason);
  }

  if (!TOKEN) return emit('deny', 'fail closed: CHAPERONE_OWNER_TOKEN is not set');
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch(`${BASE}/api/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(envelope),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return emit('deny', `fail closed: gate returned HTTP ${res.status}`);
    const r = await res.json();
    return emit(r.decision === 'allow' ? 'allow' : 'deny', r.reason || 'no reason given');
  } catch (e) {
    return emit('deny', `fail closed: cannot reach Chaperone at ${BASE} (${e?.message || e})`);
  }
}

main();