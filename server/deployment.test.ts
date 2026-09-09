import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';

test('Vercel routes static app pages and the serverless API without external requests', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8')) as {
    rewrites: { source: string; destination: string }[];
    headers?: unknown;
  };
  assert.deepEqual(config.rewrites, [
    { source: '/login', destination: '/login.html' },
    { source: '/onboarding', destination: '/app.html' },
    { source: '/app/:path*', destination: '/app.html' },
  ]);

  const { default: api } = await import('../api/index');
  const { default: nestedApi } = await import('../api/[...path]');
  assert.equal(api, nestedApi);
  assert.equal(typeof api, 'function');

  const server = createServer(nestedApi);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const call = request({ hostname: '127.0.0.1', port: address.port, path: '/api/auth/session' }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    call.on('error', reject);
    call.end();
  });
  await new Promise<void>(resolve => server.close(() => resolve()));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { authenticated: false, email: null, onboardingCompleted: false });
});
