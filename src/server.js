// Chaperone live service entry point. Reads PORT and HOST from the environment
// (HOST is set by the QwenWork Pages runtime), serves the app from src/app.js,
// and shuts down cleanly on SIGTERM / SIGINT.
import fs from 'node:fs';
import path from 'node:path';
import { Chaperone } from './chaperone.js';
import { store } from './store.js';
import { createApp } from './app.js';
import { REPORTS_DIR } from './config.js';

const PORT = Number(process.env.PORT || 8081);
const HOST = process.env.HOST || '0.0.0.0';

// Classifier report from the scored test run (honest, pre-computed).
try {
  store.classifierReport = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, 'classifier_score.json'), 'utf8'));
} catch { store.classifierReport = null; }

const chaperone = new Chaperone(store);
const app = createApp({ store, chaperone });
const { server } = app;

// A stray rejection is logged, never allowed to take the live service down.
process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e));

server.listen(PORT, HOST, () => {
  console.log(`Chaperone live on http://localhost:${PORT}`);
  // The owner token is never printed or embedded in the page. Sign in with the
  // token you configured: visit /?owner=<your OWNER_TOKEN> (sets an httpOnly
  // cookie). If OWNER_TOKEN is unset, a random token is generated for this boot
  // and is deliberately not shown — set OWNER_TOKEN to sign in.
  console.log(process.env.OWNER_TOKEN
    ? 'Owner sign-in: visit /?owner=<your OWNER_TOKEN>. The token is never printed.'
    : 'Owner sign-in: set OWNER_TOKEN and restart, then visit /?owner=<token>. A random boot token is never printed.');
  console.log('Visitors get a read-only demo sandbox; real files, payments and approvals are never touched.');
  console.log('Worker agents authenticate to /api/gate with Authorization: Bearer <token>.');
});

function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
