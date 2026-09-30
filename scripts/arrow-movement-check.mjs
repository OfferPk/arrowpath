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
const PREFIX = 'arrowpath:v1:';
const ACTIVE_KEY = `${PREFIX}active-puzzle`;

async function availablePort() {
  const probe = createServer();
  await new Promise((resolveListen, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolveListen);
  });
  const address = probe.address();
  assert(address && typeof address !== 'string');
  await new Promise((resolveClose, reject) =>
    probe.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

async function waitForServer(url, server) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited with code ${server.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Wait for Vite to bind its port.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Timed out waiting for Vite to start');
}

async function readSnapshot(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, ACTIVE_KEY);
}

async function waitForState(page, { levelId = 10, arrowsRemaining, movesMade, status = 'playing' }) {
  await page.waitForFunction(
    ({ key, levelId: expectedLevel, arrowsRemaining: expectedArrows, movesMade: expectedMoves, status: expectedStatus }) => {
      try {
        const snapshot = JSON.parse(localStorage.getItem(key) ?? 'null');
        return snapshot?.levelId === expectedLevel &&
          snapshot.engine.state.arrowsRemaining === expectedArrows &&
          snapshot.engine.state.movesMade === expectedMoves &&
          snapshot.engine.state.status === expectedStatus;
      } catch {
        return false;
      }
    },
    { key: ACTIVE_KEY, levelId, arrowsRemaining, movesMade, status },
    { timeout: 5000 },
  );
}

async function tapCell(page, x, y, { nearCorner = false } = {}) {
  const cell = page.locator(`#board-access button[data-x="${x}"][data-y="${y}"]`);
  const box = await cell.boundingBox();
  assert(box, `Level 10 cell ${x},${y} should have a full-cell tap target`);
  const offset = nearCorner ? 4 : box.width / 2;
  await page.touchscreen.tap(box.x + offset, box.y + (nearCorner ? 4 : box.height / 2));
}

async function runSyntheticWallRegression(browser, baseUrl) {
  const syntheticContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  });
  try {
    const syntheticPage = await syntheticContext.newPage();
    const syntheticErrors = [];
    syntheticPage.on('pageerror', (error) => syntheticErrors.push(error.message));
    await syntheticContext.addInitScript(({ prefix }) => {
      localStorage.setItem(`${prefix}onboarded`, JSON.stringify({ ok: true }));
      localStorage.setItem(`${prefix}progress`, JSON.stringify({ unlocked: 1, cleared: [] }));
      localStorage.setItem(`${prefix}settings`, JSON.stringify({ muted: true, adsRemoved: false }));
    }, { prefix: PREFIX });
    await syntheticPage.route('**/arrowpath/levels.json', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        theme: 'synthetic-wall-blocker',
        levels: [{
          id: 1,
          w: 4,
          h: 1,
          cells: [
            { x: 0, y: 0, t: 'arrow', d: 'E' },
            { x: 2, y: 0, t: 'wall' },
          ],
        }],
      }),
    }));
    await syntheticPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await syntheticPage.locator('[data-screen="home"]:not([hidden])').waitFor();
    await syntheticPage.locator('#btn-play').tap();
    await syntheticPage.locator('[data-screen="play"]:not([hidden])').waitFor();
    await waitForState(syntheticPage, { levelId: 1, arrowsRemaining: 1, movesMade: 0 });
    await tapCell(syntheticPage, 0, 0);
    await waitForState(syntheticPage, { levelId: 1, arrowsRemaining: 1, movesMade: 1 });
    let snapshot = await readSnapshot(syntheticPage);
    assert.deepEqual(snapshot.engine.state.cells.slice(0, 3), [
      { kind: 'empty' },
      { kind: 'arrow', dir: 'E' },
      { kind: 'wall' },
    ]);
    assert.equal(snapshot.engine.state.status, 'playing');
    assert.equal(snapshot.engine.history.length, 1);
    assert.equal(await syntheticPage.locator('#overlay-fail:not([hidden])').count(), 0);
    assert.match(
      await syntheticPage.locator('#board-announcement').textContent() ?? '',
      /stopped at row 1, column 2 before wall at row 1, column 3/i,
    );
    console.log('PASS synthetic cross-hatched wall stops an arrow in the last free cell without failing');

    const beforeAdjacentWallTap = snapshot;
    await tapCell(syntheticPage, 1, 0);
    await syntheticPage.getByText(/No movement\./).waitFor({ timeout: 2000 });
    assert.deepEqual(await readSnapshot(syntheticPage), beforeAdjacentWallTap);
    await syntheticPage.locator('#btn-undo').tap();
    await waitForState(syntheticPage, { levelId: 1, arrowsRemaining: 1, movesMade: 0 });
    snapshot = await readSnapshot(syntheticPage);
    assert.equal(snapshot.engine.state.undosLeft, 2);
    assert.equal(snapshot.engine.history.length, 0);
    assert.deepEqual(snapshot.engine.state.cells[2], { kind: 'wall' });
    assert.deepEqual(syntheticErrors, [], `no synthetic browser errors: ${syntheticErrors.join('; ')}`);
    console.log('PASS adjacent synthetic wall does not count a move; Undo restores state and preserves the wall');
  } finally {
    await syntheticContext.close();
  }
}

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}/arrowpath/`;
const server = spawn(
  process.execPath,
  [viteEntry, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: root, stdio: 'ignore' },
);
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
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(({ prefix }) => {
    localStorage.setItem(`${prefix}onboarded`, JSON.stringify({ ok: true }));
    localStorage.setItem(`${prefix}progress`, JSON.stringify({
      unlocked: 10,
      cleared: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    }));
    localStorage.setItem(`${prefix}settings`, JSON.stringify({ muted: true, adsRemoved: false }));
  }, { prefix: PREFIX });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  await page.locator('#btn-play').tap();
  await page.locator('[data-screen="play"]:not([hidden])').waitFor();
  assert.equal(await page.locator('#hud-level').textContent(), '10');
  assert.equal(await page.locator('#hud-left').textContent(), '8');
  assert.equal(await page.locator('#hud-undos').textContent(), '3');
  console.log('PASS touch browser launches the existing Level 10 board and counters');

  // Tap near the edge of the complete cell target rather than on the arrow glyph.
  const animationStartedAt = Date.now();
  await tapCell(page, 0, 0, { nearCorner: true });
  await tapCell(page, 0, 0);
  await waitForState(page, { arrowsRemaining: 7, movesMade: 1 });
  const firstAnimationMs = Date.now() - animationStartedAt;
  assert(firstAnimationMs >= 200, `arrow should slide for at least 200 ms (observed ${firstAnimationMs})`);
  assert.equal(await page.locator('#hud-left').textContent(), '7');
  console.log(`PASS full-cell touch target moves the north arrow off-board smoothly and ignores a same-cell double-tap (${firstAnimationMs} ms)`);

  await tapCell(page, 4, 4);
  await waitForState(page, { arrowsRemaining: 6, movesMade: 2 });
  await tapCell(page, 0, 2);
  await waitForState(page, { arrowsRemaining: 5, movesMade: 3 });
  console.log('PASS south- and west-facing Level 10 arrows exit in their unchanged orientations');

  // Row 1, column 2 slides east to column 4, stopping before the east-facing
  // arrow at column 5. A second touch during the animation must be ignored.
  await tapCell(page, 1, 0);
  await tapCell(page, 4, 2);
  await waitForState(page, { arrowsRemaining: 5, movesMade: 4 });
  let current = await readSnapshot(page);
  assert.deepEqual(current.engine.state.cells[3], { kind: 'arrow', dir: 'E' });
  assert.deepEqual(current.engine.state.cells[4], { kind: 'arrow', dir: 'E' });
  assert.equal(current.engine.history.length, 4);
  assert.match(await page.locator('#board-announcement').textContent(), /stopped at row 1, column 4/);
  assert.match(await page.locator('#board-announcement').textContent(), /another arrow at row 1, column 5/);
  console.log('PASS east arrow slides to the last free cell, shows blocker feedback, and ignores a second tap during animation');

  const beforeStationaryTap = await readSnapshot(page);
  await tapCell(page, 3, 0);
  await page.getByText(/No movement\./).waitFor({ timeout: 2000 });
  assert.deepEqual(await readSnapshot(page), beforeStationaryTap, 'an adjacent blocker must not change counters, board, or undo history');
  assert.match(await page.locator('#board-announcement').textContent(), /No move recorded/);
  console.log('PASS an adjacent arrow blocker prevents movement without counting a move');

  await page.locator('#btn-undo').tap();
  await waitForState(page, { arrowsRemaining: 5, movesMade: 3 });
  current = await readSnapshot(page);
  assert.equal(current.engine.state.undosLeft, 2);
  assert.equal(current.engine.history.length, 3);
  assert.deepEqual(current.engine.state.cells[1], { kind: 'arrow', dir: 'E' });
  assert.deepEqual(current.engine.state.cells[3], { kind: 'empty' });
  assert.equal(await page.locator('#hud-left').textContent(), '5');
  console.log('PASS Undo restores the prior arrow position and move/left counters');

  // Clear the right-side blocker, then move the previously stopped arrow again.
  await tapCell(page, 4, 0);
  await waitForState(page, { arrowsRemaining: 4, movesMade: 4 });
  await tapCell(page, 1, 0);
  await waitForState(page, { arrowsRemaining: 3, movesMade: 5 });
  assert.equal(await page.locator('#hud-left').textContent(), '3');
  console.log('PASS clearing a blocker allows the stopped arrow to slide off on its next tap');

  await page.locator('#btn-retry').tap();
  await page.locator('#overlay-puzzle-confirm:not([hidden])').waitFor();
  await page.locator('#btn-puzzle-confirm').tap();
  await waitForState(page, { arrowsRemaining: 8, movesMade: 0 });
  current = await readSnapshot(page);
  assert.equal(current.engine.history.length, 0);
  assert.equal(current.engine.state.undosLeft, 3);
  assert.deepEqual(current.engine.state.cells[12], { kind: 'wall' });
  assert.deepEqual(current.engine.state.cells[1], { kind: 'arrow', dir: 'E' });
  assert.deepEqual(current.engine.state.cells[4], { kind: 'arrow', dir: 'E' });
  assert.equal(await page.locator('#hud-left').textContent(), '8');
  assert.equal(await page.locator('#hud-undos').textContent(), '3');
  console.log('PASS Retry restores all Level 10 arrows, the permanent wall, counters, and a fresh undo history');

  await runSyntheticWallRegression(browser, baseUrl);
  assert.deepEqual(pageErrors, [], `no uncaught browser errors: ${pageErrors.join('; ')}`);
  console.log('All ArrowPath movement browser regressions passed.');
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
