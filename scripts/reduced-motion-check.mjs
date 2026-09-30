import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const viteEntry = resolve(root, 'node_modules/vite/bin/vite.js');
const chromiumPath = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
const prefix = 'arrowpath:v1:';
const activeKey = `${prefix}active-puzzle`;

async function availablePort() {
  const probe = createServer();
  await new Promise((resolveListen, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolveListen);
  });
  const address = probe.address();
  assert(address && typeof address !== 'string');
  await new Promise((resolveClose, reject) =>
    probe.close((error) => error ? reject(error) : resolveClose()),
  );
  return address.port;
}

async function waitForServer(url, server) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited with code ${server.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Wait for Vite to bind.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Timed out waiting for the local Vite server');
}

async function readSnapshot(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, activeKey);
}

async function waitForState(page, expected) {
  await page.waitForFunction(({ key, expected: wanted }) => {
    try {
      const snapshot = JSON.parse(localStorage.getItem(key) ?? 'null');
      const state = snapshot?.engine?.state;
      return Boolean(state) && Object.entries(wanted).every(([name, value]) => state[name] === value);
    } catch {
      return false;
    }
  }, { key: activeKey, expected }, { timeout: 5000 });
}

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}/arrowpath/`;
const server = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});
let browser;
let context;
try {
  await waitForServer(baseUrl, server);
  const launchOptions = { headless: true, args: ['--no-sandbox'] };
  if (process.env.CHROMIUM_PATH || existsSync(chromiumPath)) launchOptions.executablePath = chromiumPath;
  browser = await chromium.launch(launchOptions);
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await context.addInitScript(({ keyPrefix }) => {
    localStorage.setItem(`${keyPrefix}onboarded`, JSON.stringify({ ok: true }));
    localStorage.setItem(`${keyPrefix}progress`, JSON.stringify({ unlocked: 1, cleared: [] }));
    localStorage.setItem(`${keyPrefix}settings`, JSON.stringify({ muted: true, adsRemoved: false }));
    window.__motionAuditEvents = [];
    document.addEventListener('click', (event) => {
      const target = event.target;
      const cell = target instanceof Element ? target.closest('#board-access .board-cell') : null;
      if (cell) {
        window.__motionAuditEvents.push({
          kind: 'cell-click',
          at: performance.now(),
          x: Number(cell.dataset.x),
          y: Number(cell.dataset.y),
        });
      }
    }, true);
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === `${keyPrefix}active-puzzle`) {
        try {
          const snapshot = JSON.parse(String(value));
          const state = snapshot?.engine?.state;
          window.__motionAuditEvents.push({
            kind: 'active-puzzle-save',
            at: performance.now(),
            movesMade: state?.movesMade,
            arrowsRemaining: state?.arrowsRemaining,
          });
        } catch {
          // Ignore non-JSON values in the instrumentation hook.
        }
      }
      return Reflect.apply(originalSetItem, this, [key, value]);
    };
  }, { keyPrefix: prefix });
  await page.route('**/arrowpath/levels.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      version: 1,
      theme: 'reduced-motion-disposable-fixture',
      levels: [{
        id: 1,
        w: 4,
        h: 1,
        cells: [
          { x: 0, y: 0, t: 'arrow', d: 'E' },
          { x: 2, y: 0, t: 'arrow', d: 'E' },
        ],
      }],
    }),
  }));

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  assert.equal(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    true,
    'the isolated browser must actually emulate reduced motion',
  );
  await page.locator('#btn-play').click();
  await page.locator('[data-screen="play"]:not([hidden])').waitFor();
  const initial = await readSnapshot(page);
  assert.equal(initial.engine.state.arrowsRemaining, 2);
  assert.equal(initial.engine.state.movesMade, 0);
  assert.equal(initial.engine.state.undosLeft, 3);

  // Fire east into the second arrow. It must stop in the last free cell.
  await page.locator('#board-access button[data-x="0"][data-y="0"]').click();
  await waitForState(page, { movesMade: 1, arrowsRemaining: 2, status: 'playing' });
  const blocked = await readSnapshot(page);
  assert.deepEqual(blocked.engine.state.cells.slice(0, 4), [
    { kind: 'empty' },
    { kind: 'arrow', dir: 'E' },
    { kind: 'arrow', dir: 'E' },
    { kind: 'empty' },
  ]);
  assert.equal(blocked.engine.history.length, 1);
  const blockedAnnouncement = await page.locator('#board-announcement').textContent() ?? '';
  assert.match(blockedAnnouncement, /stopped .* before another arrow/i);
  const events = await page.evaluate(() => window.__motionAuditEvents);
  const moveClick = events.findLast((event) => event.kind === 'cell-click' && event.x === 0 && event.y === 0);
  const moveSave = events.findLast((event) => event.kind === 'active-puzzle-save' && event.movesMade === 1 && event.arrowsRemaining === 2);
  assert(moveClick && moveSave, 'the blocked move should emit a click and persist its resulting state');
  const completionLatencyMs = Number((moveSave.at - moveClick.at).toFixed(1));
  assert(
    completionLatencyMs < 100,
    `reduced-motion move should not spend time sliding; observed ${completionLatencyMs} ms`,
  );

  // Undo must restore the exact starting board, counters, and empty history.
  await page.locator('#btn-undo').click();
  await waitForState(page, { movesMade: 0, arrowsRemaining: 2, undosLeft: 2, status: 'playing' });
  const undone = await readSnapshot(page);
  assert.deepEqual(undone.engine.state.cells.slice(0, 4), initial.engine.state.cells.slice(0, 4));
  assert.equal(undone.engine.history.length, 0);
  assert.equal(undone.engine.state.undosLeft, 2);

  // Remove the blocker, then clear the same east-facing arrow and complete.
  await page.locator('#board-access button[data-x="2"][data-y="0"]').click();
  await waitForState(page, { movesMade: 1, arrowsRemaining: 1, status: 'playing' });
  const afterBlocker = await readSnapshot(page);
  assert.deepEqual(afterBlocker.engine.state.cells.slice(0, 4), [
    { kind: 'arrow', dir: 'E' },
    { kind: 'empty' },
    { kind: 'empty' },
    { kind: 'empty' },
  ]);
  await page.locator('#board-access button[data-x="0"][data-y="0"]').click();
  await page.locator('#overlay-win').waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), activeKey), null);
  const progress = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), `${prefix}progress`);
  assert.deepEqual(progress.cleared, [1]);
  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('; ')}`);

  console.log(`PASS reduced motion completes the blocked east move in ${completionLatencyMs} ms; blocker feedback, Undo, resumed directional movement, and win completion are preserved.`);
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  server.kill('SIGTERM');
  await new Promise((resolveExit) => {
    if (server.exitCode !== null) return resolveExit();
    server.once('exit', resolveExit);
    setTimeout(resolveExit, 1000).unref();
  });
}
