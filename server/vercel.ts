import { existsSync } from 'node:fs';
import express from 'express';
import { createApi } from './app';

// `vercel dev` and local `tsx` runs do not execute vite.config.ts, so load the
// same server-only development env here. Vercel deployments use project env vars.
if (!process.env.VERCEL && !process.env.DRIFT_TEST && existsSync('.env.local')) process.loadEnvFile('.env.local');

const app = express();
app.disable('x-powered-by');
app.use('/api', createApi());

export default app;
