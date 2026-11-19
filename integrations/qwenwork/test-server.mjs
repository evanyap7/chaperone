// Local HTTP harness for the /api/hook handler — used by tests and the live
// adapter demo BEFORE the orchestrator mounts the handler in src/app.js.
// It mounts the exact same createHookHandler behind the same owner-token +
// Origin checks as /api/queue/decide, on its own port, with an in-memory store.
// This file never edits src/; it only imports it.
import http from 'node:http';
import { Chaperone } from '../../src/chaperone.js';
import { Store } from '../../src/store.js';
import { createHookHandler } from './hook-handler.js';

const PORT = Number(process.env.PORT || 8152);
const TOKEN = process.env.OWNER_TOKEN || 'harness-token';
const store = new Store(null);
const handler = createHookHandler({ chaperone: new Chaperone(store), store });

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST' || req.url !== '/api/hook') return send(404, { error: 'not found' });
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'owner authentication required' });
  const origin = req.headers.origin;
  if (origin) {
    let host = null;
    try { host = new URL(origin).host; } catch { /* malformed */ }
    if (host !== req.headers.host) return send(403, { error: 'cross-origin writes are not allowed' });
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { return send(200, { decision: 'deny', reason: 'fail closed: body is not valid JSON' }); }
  send(200, await handler(body));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`hook harness listening on http://127.0.0.1:${PORT}/api/hook (owner token: ${TOKEN})`);
});