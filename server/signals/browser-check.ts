import express from 'express';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { get } from 'node:http';
import assert from 'node:assert/strict';
import { toSignal } from '../llm/extract';

/** Local fixture-only desktop/mobile smoke test. No production API or AI. */
const directory = await mkdtemp(join(tmpdir(), 'drift-browser-'));
const app = express(); let writes = 0;
const signals = [toSignal({ name: 'Saved repair gatherings', summary: 'Evidence of repair meetings', industries: ['retail'] }, 0, 1, [{ source: 'web', provider: 'perplexity-sonar', title: 'Saved observation', url: 'https://example.com/repair', snippet: 'Repair meetings were reported.', metrics: {}, date: null, reason: null }]), toSignal({ name: 'Unclassified research', summary: 'A saved signal without industry evidence', industries: [] }, 1, 1, [])];
const profile = { email: 'fixture@example.test', onboarding: { completed: true, interests: [], exploring: [], purposes: [] } };
app.use('/api', (req, res) => {
  if (req.method !== 'GET') { writes++; res.status(500).json({ error: 'Writes forbidden in fixture smoke test' }); return; }
  const data: Record<string, unknown> = {
    '/auth/session': { authenticated: true, email: profile.email, onboardingCompleted: true }, '/profile': profile,
    '/signals': signals,
    '/signals/status': { state: 'complete', totalEvidence: 1, processedEvidence: 1, pendingEvidence: 0, topicCount: 1, unavailableTopics: 0, failures: [], updatedAt: null, analysisVersion: 'fixture' },
    '/trends': { configured: false, topics: [], state: { status: 'idle', runId: '', coverage: [], initialized: false, startedAt: null, lastPulledAt: null, error: null } },
    '/transfers': [], '/opportunities': [], '/saved': [], '/chat': [],
  };
  res.json(data[req.path] ?? null);
});
app.use(express.static(resolve('dist')));
app.use((_req, res) => res.sendFile(resolve('dist/app.html')));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-extensions', '--no-proxy-server', '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1, EXCLUDE localhost', '--remote-debugging-port=0', `--user-data-dir=${directory}`, 'about:blank'], { stdio: 'ignore' });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const localJson = (url: string) => new Promise<any>((resolve, reject) => { get(url, res => { let text = ''; res.on('data', x => { text += x; }); res.on('end', () => resolve(JSON.parse(text))); }).on('error', reject); });
let socket: WebSocket | undefined;
try {
  let port = '';
  for (let n = 0; n < 100; n++) { try { port = (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await wait(100); } }
  assert.ok(port, 'Chrome started');
  const targets = await localJson(`http://127.0.0.1:${port}/json/list`);
  socket = new WebSocket(targets.find((t: any) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise<void>(resolve => socket!.addEventListener('open', () => resolve(), { once: true }));
  let id = 0; const pending = new Map<number, (data: any) => void>(); const errors: unknown[] = [];
  socket.addEventListener('message', event => { const data = JSON.parse(String(event.data)); if (data.id) { pending.get(data.id)?.(data); pending.delete(data.id); } else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params); });
  const send = (method: string, params: unknown = {}) => new Promise<any>((resolve, reject) => { const key = ++id; pending.set(key, data => data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result)); socket!.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async (expression: string) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  await send('Runtime.enable'); await send('Page.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['https://*', 'http://fonts.*'] });
  const report: unknown[] = [];
  for (const width of [1440, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
    for (const path of ['/app/discover', `/app/map?signal=${signals[0].id}`, `/app/transfer?signal=${signals[0].id}`, '/app/saved']) {
      await send('Page.navigate', { url: base + path });
      await wait(1000);
      const body = await evaluate('document.body.innerText');
      assert.ok(body.length > 100, path);
      const overflow = await evaluate('document.documentElement.scrollWidth > innerWidth + 2');
      assert.equal(overflow, false, `${width}px ${path} horizontal overflow`);
      if (!path.includes('saved')) {
        assert.ok(body.includes(signals[0].name), `${path} source ID/name loaded`);
        assert.match(body, /Not measured/i, path);
      }
      if (path.includes('/map')) {
        for (const row of ['signals', 'domains']) {
          const metrics = () => evaluate(`(() => {
            const viewport = document.getElementById('map-${row}');
            return { left: viewport.scrollLeft, overflows: viewport.scrollWidth > viewport.clientWidth + 1,
              leftDisabled: document.querySelector('[aria-label="Scroll ${row} left"]').disabled,
              rightDisabled: document.querySelector('[aria-label="Scroll ${row} right"]').disabled };
          })()`);
          const initial = await metrics();
          assert.equal(initial.leftDisabled, true, `${row}: left arrow disabled at start`);
          assert.equal(initial.rightDisabled, !initial.overflows, `${row}: arrows reflect available content`);
          if (initial.overflows) {
            await evaluate(`document.querySelector('[aria-label="Scroll ${row} right"]').click()`);
            await wait(600);
            assert.ok((await metrics()).left > 0, `${row}: right arrow scrolls with a click`);
            await evaluate(`document.querySelector('[aria-label="Scroll ${row} left"]').click()`);
            await wait(600);
            assert.ok((await metrics()).left <= 1, `${row}: left arrow returns to start`);
            await evaluate(`document.getElementById('map-${row}').scrollTo({ left: 100000, behavior: 'instant' })`);
            await wait(100);
            assert.equal((await metrics()).rightDisabled, true, `${row}: right arrow disabled at end`);
            await evaluate(`document.getElementById('map-${row}').scrollTo({ left: 0, behavior: 'instant' })`);
          }
        }
        assert.equal(await evaluate('document.querySelectorAll(".map-node--signal").length'), 2);
        assert.equal(await evaluate('document.querySelectorAll(".map-attach").length'), 1);
        assert.match(body, /AI-classified association/i);
        await evaluate('document.querySelector(".map-node--signal").dispatchEvent(new MouseEvent("click", {bubbles:true}))');
        await wait(100);
        assert.ok(await evaluate('!!document.querySelector(".map-panel")'));
        const transform = await evaluate('document.querySelector(".map-svg > g").getAttribute("transform")');
        const point = await evaluate('(() => { const r = document.querySelector(".map-svg").getBoundingClientRect(); return { x: r.left + 30, y: Math.min(innerHeight - 40, r.top + 100) }; })()');
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: -120 });
        await wait(200);
        assert.notEqual(await evaluate('document.querySelector(".map-svg > g").getAttribute("transform")'), transform, 'zoom remains interactive');
      }
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const name = `/tmp/drift-${width}-${path.split('/')[2].split('?')[0]}.png`;
      await writeFile(name, Buffer.from(shot.data, 'base64'));
      report.push({ width, path, overflow, screenshot: name });
    }
  }
  assert.equal(writes, 0, 'page entry/reload must never generate');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  await writeFile('/tmp/drift-browser-report.json', JSON.stringify({ passed: true, writes, errors, pages: report }, null, 2));
} finally {
  socket?.close();
  const exited = new Promise<void>(resolve => chrome.once('exit', () => resolve()));
  chrome.kill(); await Promise.race([exited, wait(3000)]);
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch(() => {});
}
