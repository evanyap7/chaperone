// /api/hook handler for the QwenWork PreToolUse integration.
//
// createHookHandler({chaperone, store}) -> async (body) => {decision, reason, queue_id?, entry_id?}
//
// Accepts either a raw PreToolUse payload {tool_name, tool_input} (mapped here)
// or an already-mapped Chaperone envelope {agent, task, action, params, ...}.
// Every call goes through chaperone.gate() — the same single logged channel as
// /api/gate — and the gate decision is translated to the hook contract:
//
//   ALLOW             -> {decision: "allow", reason: owner_line}
//   HOLD_FOR_APPROVAL -> {decision: "deny",  reason: "held for owner approval (queue <id>)"}
//                        (the gate has already queued the item for the owner)
//   BLOCK             -> {decision: "deny",  reason: owner_line}
//   malformed input   -> {decision: "deny",  reason: "fail closed: ..."}
//
// Mounting in src/app.js is 5 lines (the orchestrator adds this after TASK 0):
//
//   import { createHookHandler } from '../integrations/qwenwork/hook-handler.js';
//   const hook = createHookHandler({ chaperone, store });
//   '/api/hook': {
//     POST: async (req, res) => { requireOwner(req); return json(res, 200, await hook(await readJsonBody(req))); },
//   },
//
// guardWrite already applies to every POST route in createApp's handle().
import { mapToolToEnvelope } from './mapper.mjs';

export function createHookHandler({ chaperone }) {
  return async function hookHandler(body) {
    let envelope;
    if (body && typeof body.tool_name === 'string') {
      envelope = mapToolToEnvelope(body.tool_name, body.tool_input ?? {}, { agent: body.agent, task: body.task });
    } else if (body && typeof body.action === 'string') {
      envelope = {
        agent: typeof body.agent === 'string' && body.agent ? body.agent : 'QwenWork agent (hook)',
        ...(typeof body.task === 'string' && body.task ? { task: body.task } : {}),
        action: body.action,
        params: body.params ?? {},
        sources: Array.isArray(body.sources) ? body.sources : [],
        scope: Array.isArray(body.scope) ? body.scope : [],
      };
    } else {
      return { decision: 'deny', reason: 'fail closed: hook body must carry tool_name or action' };
    }
    let entry;
    try {
      entry = chaperone.gate(envelope);
    } catch (e) {
      return { decision: 'deny', reason: `fail closed: ${e?.message || 'gate rejected the input'}` };
    }
    if (entry.decision === 'ALLOW') {
      return { decision: 'allow', reason: entry.owner_line, entry_id: entry.id };
    }
    if (entry.decision === 'HOLD_FOR_APPROVAL') {
      return { decision: 'deny', reason: `held for owner approval (queue ${entry.queue_id})`, queue_id: entry.queue_id, entry_id: entry.id };
    }
    return { decision: 'deny', reason: entry.owner_line, entry_id: entry.id };
  };
}