import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tests never load .env.local or touch the user's research. Unexpected fetches
// fail closed. Individual provider tests replace fetch with their own mocks.
const directory = mkdtempSync(join(tmpdir(), 'drift-tests-'));
process.env.MONGODB_URI = '';
process.env.DRIFT_RESEARCH_DATA_DIR = directory;
process.env.OPENROUTER_API_KEY = '';
process.env.SERPAPI_API_KEY = '';
process.env.DRIFT_RESEARCH_MONTHLY_BUDGET = '75';
globalThis.fetch = async () => { throw new Error('Real API requests are forbidden in tests. Inject a mock.'); };
process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
