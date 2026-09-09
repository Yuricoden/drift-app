import { resolve } from 'node:path';
import express from 'express';
import { cleanUrls, createApi, pageGuard } from './app.js';
import { env } from './env.js';
import { getStore } from './db.js';

/** Production entry: serves the Vite build plus the DRIFT API on one port. */
async function main() {
  await getStore(); // connect (or warn) before accepting traffic
  const app = express();
  app.disable('x-powered-by');
  app.use(pageGuard());
  app.use(cleanUrls());
  app.use('/api', createApi());
  app.use(express.static(resolve('dist')));
  app.use((_req, res) => {
    res.sendFile(resolve('dist/index.html'));
  });
  app.listen(env.port, () => {
    console.log(`[drift] DRIFT is listening on http://localhost:${env.port}`);
  });
}

main().catch((error) => {
  console.error('[drift] Failed to start:', error);
  process.exit(1);
});
