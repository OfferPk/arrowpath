import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
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

async function waitForState(page, { levelId, arrowsRemaining, status = 'playing' }) {
  await page.waitForFunction(
    ({ key, levelId: wantedLevel, arrowsRemaining: wantedArrows, status: wantedStatus }) => {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      try {
        const snapshot = JSON.parse(raw);
        return snapshot.levelId === wantedLevel &&
          snapshot.engine.state.arrowsRemaining === wantedArrows &&
          snapshot.engine.state.status === wantedStatus;
      } catch {
        return false;
      }
    },
    { key: ACTIVE_KEY, levelId, arrowsRemaining, status },
    { timeout: 5000 },
  );
}

async function scanAxe(page, label) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  assert.equal(
    result.violations.length,
    0,
    `${label} has axe violations: ${result.violations.map((item) => `${item.id}: ${item.help}`).join('; ')}`,
  );
  console.log(`PASS axe ${label}: no violations`);
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
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await context.addInitScript(({ prefix }) => {
    const initializedKey = `${prefix}resume-test-initialized`;
    if (localStorage.getItem(initializedKey) === '1') return;
    localStorage.setItem(`${prefix}onboarded`, JSON.stringify({ ok: true }));
    localStorage.setItem(`${prefix}progress`, JSON.stringify({ unlocked: 3, cleared: [] }));
    localStorage.setItem(`${prefix}settings`, JSON.stringify({ muted: true, adsRemoved: false }));
    localStorage.setItem(`${prefix}daily:2026-09-30`, JSON.stringify({ completed: false, levelId: 8 }));
    localStorage.setItem(initializedKey, '1');
  }, { prefix: PREFIX });

  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  const progressBefore = await page.evaluate((key) => localStorage.getItem(key), `${PREFIX}progress`);
  const settingsBefore = await page.evaluate((key) => localStorage.getItem(key), `${PREFIX}settings`);
  const dailyBefore = await page.evaluate((key) => localStorage.getItem(key), `${PREFIX}daily:2026-09-30`);

  await page.locator('#btn-levels').click();
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.locator('[data-screen="play"]:not([hidden])').waitFor();
  await page.locator('#board-access button[data-x="2"][data-y="1"]').click();
  await waitForState(page, { levelId: 2, arrowsRemaining: 1 });
  const levelTwoAfterMove = await readSnapshot(page);
  assert.equal(levelTwoAfterMove.engine.history.length, 1);
  console.log('PASS active move is versioned and stores undo history');

  await page.locator('#btn-menu').click();
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  assert.equal(await page.locator('#btn-play').textContent(), 'Resume');
  assert.deepEqual(await readSnapshot(page), levelTwoAfterMove);
  await page.locator('#btn-play').click();
  await page.locator('[data-screen="play"]:not([hidden])').waitFor();
  assert.deepEqual(await readSnapshot(page), levelTwoAfterMove);
  console.log('PASS Home then Play resumes the same unsolved board');

  await page.locator('#btn-play-levels').click();
  await page.getByRole('button', { name: '2', exact: true }).click();
  assert.deepEqual(await readSnapshot(page), levelTwoAfterMove, 'selecting the active level must not reset it');
  await page.locator('#btn-play-levels').click();
  await page.locator('#btn-levels-back').click();
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  await page.locator('#btn-play').click();
  assert.deepEqual(await readSnapshot(page), levelTwoAfterMove, 'Level Select Back and Home Play must preserve the same run');
  console.log('PASS same-level selection and Level Select Back/Home preserve the active run');

  await page.locator('#btn-play-levels').click();
  await page.getByRole('button', { name: '3', exact: true }).click();
  await page.locator('#overlay-puzzle-confirm:not([hidden])').waitFor();
  await scanAxe(page, 'level replacement confirmation');
  await page.locator('#btn-puzzle-cancel').click();
  await page.locator('#overlay-puzzle-confirm').waitFor({ state: 'hidden' });
  assert.deepEqual(await readSnapshot(page), levelTwoAfterMove, 'cancelling level replacement must keep the prior snapshot');
  assert.equal(await page.locator('[data-screen="levels"]:not([hidden])').count(), 1);
  await page.getByRole('button', { name: '3', exact: true }).click();
  await page.locator('#overlay-puzzle-confirm:not([hidden])').waitFor();
  await page.locator('#btn-puzzle-confirm').click();
  await page.locator('[data-screen="play"]:not([hidden])').waitFor();
  let current = await readSnapshot(page);
  assert.equal(current.levelId, 3);
  assert.equal(current.engine.state.arrowsRemaining, 3);
  assert.equal(current.engine.history.length, 0);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), `${PREFIX}progress`), progressBefore);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), `${PREFIX}settings`), settingsBefore);
  console.log('PASS replacement cancellation preserves the old run; confirmation starts a clean replacement without changing progress/settings');

  await page.locator('#board-access button[data-x="0"][data-y="0"]').click();
  await waitForState(page, { levelId: 3, arrowsRemaining: 2 });
  const levelThreeAfterMove = await readSnapshot(page);
  await page.locator('#btn-retry').click();
  await page.locator('#overlay-puzzle-confirm:not([hidden])').waitFor();
  await scanAxe(page, 'restart confirmation');
  await page.locator('#btn-puzzle-cancel').click();
  assert.deepEqual(await readSnapshot(page), levelThreeAfterMove, 'cancelling restart must preserve board and undo history');
  await page.locator('#btn-retry').click();
  await page.locator('#btn-puzzle-confirm').click();
  await waitForState(page, { levelId: 3, arrowsRemaining: 3 });
  current = await readSnapshot(page);
  assert.equal(current.engine.history.length, 0, 'confirmed restart must replace old undo history');
  assert.equal(current.engine.state.undosLeft, 3);
  console.log('PASS restart cancellation preserves the board; confirmation creates a fresh saved run');

  await page.locator('#board-access button[data-x="0"][data-y="0"]').click();
  await waitForState(page, { levelId: 3, arrowsRemaining: 2 });
  current = await readSnapshot(page);
  assert.equal(current.engine.history.length, 1);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-screen="play"]:not([hidden])').waitFor();
  assert.deepEqual(await readSnapshot(page), current, 'reload must restore the exact board and undo stack');
  await page.locator('#btn-undo').click();
  await waitForState(page, { levelId: 3, arrowsRemaining: 3 });
  current = await readSnapshot(page);
  assert.equal(current.engine.history.length, 0);
  assert.equal(current.engine.state.undosLeft, 2, 'undo after reload must consume exactly one free undo');
  console.log('PASS true reload restores the exact run and Undo remains functional');

  await page.locator('#btn-play-levels').click();
  await page.locator('#btn-levels-back').click();
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  await page.locator('#btn-play').click();
  assert.deepEqual(await readSnapshot(page), current, 'Back/Home/Play must retain the restored board after Undo');

  for (const point of [{ x: 0, y: 0 }, { x: 3, y: 1 }]) {
    await page.locator(`#board-access button[data-x="${point.x}"][data-y="${point.y}"]`).click();
    await waitForState(page, { levelId: 3, arrowsRemaining: point.x === 0 ? 2 : 1 });
  }
  await page.locator('#board-access button[data-x="1"][data-y="2"]').click();
  await page.locator('#overlay-win:not([hidden])').waitFor({ timeout: 10000 });
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), ACTIVE_KEY), null, 'solving must clear the active run');
  const completedProgress = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `${PREFIX}progress`);
  assert.equal(completedProgress.unlocked, 4);
  assert.deepEqual(completedProgress.cleared, [3]);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), `${PREFIX}settings`), settingsBefore);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), `${PREFIX}daily:2026-09-30`), dailyBefore);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), ACTIVE_KEY), null);
  console.log('PASS completion clears only the active run; progress advances normally and settings/daily records remain intact');

  await page.evaluate(({ key }) => localStorage.setItem(key, JSON.stringify({
    version: 99,
    levelId: 3,
    mode: 'campaign',
    dailyKey: null,
    engine: {},
  })), { key: ACTIVE_KEY });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), ACTIVE_KEY), null, 'unsupported versions must be discarded');

  await page.evaluate(({ key }) => localStorage.setItem(key, JSON.stringify({
    version: 1,
    levelId: 3,
    mode: 'campaign',
    dailyKey: null,
    engine: { state: { levelId: 3, w: 1, h: 1, cells: [{ kind: 'wall' }], status: 'playing', undosLeft: 3, arrowsRemaining: 1 }, history: [] },
  })), { key: ACTIVE_KEY });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), ACTIVE_KEY), null, 'invalid board states must be discarded');
  assert.deepEqual(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), `${PREFIX}progress`), completedProgress);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), `${PREFIX}settings`), settingsBefore);
  console.log('PASS stale-version and corrupt-board snapshots fall back to Home without touching saved progress/settings');
  console.log('All puzzle resume browser regressions passed.');
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
