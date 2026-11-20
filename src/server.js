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
  console.log(`Owner sign-in: http://localhost:${PORT}/?owner=${app.ownerToken}`);
  console.log('Visitors get a read-only demo sandbox; real files, payments and approvals are never touched.');
  console.log('The owner token is never embedded in the page. Owner API calls: Authorization: Bearer <token>.');
});

function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
