import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ts from 'typescript';
import { loginErrorMessage } from '../src/login/response';

test('Vercel routes static app pages and the serverless API without external requests', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8')) as {
    rewrites: { source: string; destination: string }[];
    headers?: unknown;
  };
  assert.deepEqual(config.rewrites, [
    { source: '/api/:path*', destination: '/api' },
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

test('login distinguishes unavailable API routes/functions from rejected credentials', () => {
  for (const status of [404, 405, 500, 502, 503]) {
    const message = loginErrorMessage(status, 'NOT_FOUND or FUNCTION_INVOCATION_FAILED');
    assert.match(message, /temporarily unavailable/);
    assert.doesNotMatch(message, /credentials/);
  }
  assert.match(loginErrorMessage(401, {}), /temporarily unavailable/, 'non-JSON platform failures are not credential rejections');
  assert.equal(loginErrorMessage(401, { error: 'Those credentials do not match the DRIFT account.' }), 'Those credentials do not match the DRIFT account.');
  assert.match(loginErrorMessage(429, {}), /wait a moment/);
});

test('compiled API starts and authenticates in plain Node without the development TS loader', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'drift-production-api-'));
  try {
    const program = ts.createProgram([resolve('api/index.ts'), resolve('api/[...path].ts')], {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, esModuleInterop: true,
      strict: true, skipLibCheck: true, rootDir: resolve('.'), outDir: directory,
    });
    const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
    assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
    assert.equal(program.emit().emitSkipped, false);
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
    // Deliberately run without tsx, NODE_OPTIONS, local env files, or real keys.
    const check = `
      import assert from 'node:assert/strict';
      import { createServer, request } from 'node:http';
      globalThis.fetch = async () => { throw new Error('External requests forbidden'); };
      const { default: app } = await import('./api/index.js');
      const { default: nested } = await import('./api/[...path].js');
      assert.equal(app, nested);
      const server = createServer(app);
      try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const call = (path, body, cookie, method = body ? 'POST' : 'GET') => new Promise((resolve, reject) => {
          const req = request({hostname: '127.0.0.1', port: server.address().port, path,
            method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }}, res => {
            let text = ''; res.on('data', chunk => text += chunk);
            res.on('end', () => resolve({status: res.statusCode, data: JSON.parse(text), cookies: res.headers['set-cookie']}));
          });
          req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
        });
        assert.equal((await call('/api/auth/session')).data.authenticated, false);
        assert.equal((await call('/api/auth/login', {email: 'fixture@example.test', password: 'incorrect'})).status, 401);
        const login = await call('/api/auth/login', {email: 'fixture@example.test', password: 'fixture-only-password'});
        assert.equal(login.status, 200);
        assert.match(login.cookies[0], /HttpOnly/);
        assert.match(login.cookies[0], /Secure/);
        const firstCookie = login.cookies[0].split(';')[0];
        await call('/api/profile/onboarding', { exploring: ['Design'], purposes: [], interests: [] }, firstCookie, 'PUT');
        const firstSession = await call('/api/auth/session', null, firstCookie);
        assert.equal(firstSession.data.authenticated, true);
        assert.equal(firstSession.data.email, 'fixture@example.test');
        assert.equal(firstSession.data.onboardingCompleted, true);

        assert.equal((await call('/api/auth/login', {email: 'second@example.test', password: 'fixture-only-password'})).status, 401);
        const secondLogin = await call('/api/auth/login', {email: 'second@example.test', password: 'second-only-password'});
        assert.equal(secondLogin.status, 200);
        const secondSession = await call('/api/auth/session', null, secondLogin.cookies[0].split(';')[0]);
        assert.equal(secondSession.data.email, 'second@example.test');
        assert.equal(secondSession.data.onboardingCompleted, false);

        const thirdLogin = await call('/api/auth/login', {email: 'third@example.test', password: 'third-only-password'});
        assert.equal(thirdLogin.status, 200);
        const thirdSession = await call('/api/auth/session', null, thirdLogin.cookies[0].split(';')[0]);
        assert.equal(thirdSession.data.email, 'third@example.test');
        assert.equal(thirdSession.data.onboardingCompleted, false);
        console.log('Native Node multi-account login passed');
      } finally { await new Promise(resolve => server.close(resolve)); }
    `;
    const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', check], {
      cwd: directory, timeout: 15000,
      env: { PATH: process.env.PATH, NODE_ENV: 'production', VERCEL: '1',
        DRIFT_LOGIN_EMAIL: 'fixture@example.test', DRIFT_LOGIN_PASSWORD: 'fixture-only-password',
        DRIFT_LOGIN_EMAIL_2: 'second@example.test', DRIFT_LOGIN_PASSWORD_2: 'second-only-password',
        DRIFT_LOGIN_EMAIL_3: 'third@example.test', DRIFT_LOGIN_PASSWORD_3: 'third-only-password',
        SESSION_SECRET: 'fixture-only-session-secret', DRIFT_RESEARCH_DATA_DIR: join(directory, 'research') },
    });
    assert.match(result.stdout, /Native Node multi-account login passed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
