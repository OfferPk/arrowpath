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
let dailyContext;
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
  const resumeStatus = page.locator('#toast');
  assert.equal(await resumeStatus.isVisible(), false, 'a fresh visit must not announce a restored run');
  await scanAxe(page, 'fresh Home screen');
  const progressBefore = await page.evaluate((key) => localStorage.getItem(key), `${PREFIX}progress`);
  const settingsBefore = await page.evaluate((key) => localStorage.getItem(key), `${PREFIX}settings`);
  const dailyBefore = await page.evaluate((key) => localStorage.getItem(key), `${PREFIX}daily:2026-09-30`);

  await page.locator('#btn-levels').click();
  assert.equal(
    await page.locator('#level-grid .current').textContent(),
    '3',
    'without an active run, Level Select should highlight the next unlocked campaign level',
  );
  await page.locator('#btn-levels-back').click();
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();

  await page.locator('#btn-levels').click();
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.locator('[data-screen="play"]:not([hidden])').waitFor();
  assert.equal(await resumeStatus.isVisible(), false, 'starting a fresh puzzle must not announce a restore');
  await scanAxe(page, 'fresh puzzle');
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
  assert.equal(await resumeStatus.isVisible(), false, 'same-page Home/Play must not announce a restore');
  console.log('PASS Home then Play resumes the same unsolved board');

  await page.locator('#btn-play-levels').click();
  await page.getByRole('button', { name: '2', exact: true }).click();
  assert.deepEqual(await readSnapshot(page), levelTwoAfterMove, 'selecting the active level must not reset it');
  await page.locator('#btn-play-levels').click();
  await page.locator('#btn-levels-back').click();
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  await page.locator('#btn-play').click();
  assert.deepEqual(await readSnapshot(page), levelTwoAfterMove, 'Level Select Back and Home Play must preserve the same run');
  assert.equal(await resumeStatus.isVisible(), false, 'same-page Level Select navigation must stay silent');
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
  await resumeStatus.waitFor({ state: 'visible' });
  assert.equal(await resumeStatus.textContent(), 'Resumed Level 3. 1 pour completed.');
  assert.equal(await resumeStatus.getAttribute('role'), 'status');
  assert.equal(await resumeStatus.getAttribute('aria-live'), 'polite');
  assert.equal(await resumeStatus.getAttribute('aria-atomic'), 'true');
  assert.ok(
    await page.evaluate(() => document.activeElement?.closest('#board-access') !== null),
    'the restore notice must not steal focus from the board',
  );
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), `${PREFIX}progress`), progressBefore);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), `${PREFIX}settings`), settingsBefore);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), `${PREFIX}daily:2026-09-30`), dailyBefore);
  await scanAxe(page, 'restored puzzle with status');
  await page.locator('#btn-undo').click();
  await waitForState(page, { levelId: 3, arrowsRemaining: 3 });
  current = await readSnapshot(page);
  assert.equal(current.engine.history.length, 0);
  assert.equal(current.engine.state.undosLeft, 2, 'undo after reload must consume exactly one free undo');
  console.log('PASS true reload restores the exact run and Undo remains functional');

  await page.locator('#btn-play-levels').click();
  assert.equal(await resumeStatus.isVisible(), false, 'leaving the restored run must dismiss its one-time status');
  await page.locator('#btn-levels-back').click();
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  await page.locator('#btn-play').click();
  assert.deepEqual(await readSnapshot(page), current, 'Back/Home/Play must retain the restored board after Undo');
  assert.equal(await resumeStatus.isVisible(), false, 'same-page return to a restored run must not announce it again');

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

  const dailyContextStart = new Date('2026-09-30T18:59:59.000Z');
  dailyContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const dailyPage = await dailyContext.newPage();
  await dailyPage.clock.install({ time: dailyContextStart });
  const dailyProgressBefore = JSON.stringify({ unlocked: 6, cleared: [1, 3] });
  const dailySettingsBefore = JSON.stringify({ muted: true, adsRemoved: false });
  const previousDailyRecord = JSON.stringify({
    completed: true,
    levelId: 4,
    finishedAt: '2026-09-29T12:00:00.000Z',
  });
  await dailyPage.addInitScript(({ prefix, progress, settings, previousRecord }) => {
    const initializedKey = `${prefix}daily-expiry-test-initialized`;
    if (localStorage.getItem(initializedKey) === '1') return;
    localStorage.setItem(`${prefix}onboarded`, JSON.stringify({ ok: true }));
    localStorage.setItem(`${prefix}progress`, progress);
    localStorage.setItem(`${prefix}settings`, settings);
    localStorage.setItem(`${prefix}daily:2026-09-29`, previousRecord);
    localStorage.setItem(initializedKey, '1');
  }, {
    prefix: PREFIX,
    progress: dailyProgressBefore,
    settings: dailySettingsBefore,
    previousRecord: previousDailyRecord,
  });

  await dailyPage.goto(baseUrl, { waitUntil: 'networkidle' });
  await dailyPage.locator('[data-screen="home"]:not([hidden])').waitFor();
  assert.equal(await dailyPage.locator('#home-daily-meta').textContent(), 'Daily 2026-09-30 ready');
  await dailyPage.locator('#btn-daily').click();
  await dailyPage.locator('[data-screen="play"]:not([hidden])').waitFor();
  const dailyRunBeforeReload = await readSnapshot(dailyPage);
  assert.equal(dailyRunBeforeReload.mode, 'daily');
  assert.equal(dailyRunBeforeReload.dailyKey, '2026-09-30');
  const currentDailyRecord = await dailyPage.evaluate(
    (key) => localStorage.getItem(key),
    `${PREFIX}daily:2026-09-30`,
  );
  assert.ok(currentDailyRecord, 'starting the daily run should save its isolated daily record');

  await dailyPage.reload({ waitUntil: 'networkidle' });
  await dailyPage.locator('[data-screen="play"]:not([hidden])').waitFor();
  assert.deepEqual(
    await readSnapshot(dailyPage),
    dailyRunBeforeReload,
    'a same-day reload must preserve the active daily run',
  );
  const dailyRestoreStatus = dailyPage.locator('#toast');
  await dailyRestoreStatus.waitFor({ state: 'visible' });
  assert.equal(
    await dailyRestoreStatus.textContent(),
    `Resumed Daily challenge ${dailyRunBeforeReload.levelId}. 0 pours completed.`,
  );
  console.log('PASS same-day reload restores the exact Daily challenge run');

  await dailyPage.clock.setFixedTime(new Date('2026-09-30T19:00:00.000Z'));
  await dailyPage.reload({ waitUntil: 'networkidle' });
  await dailyPage.locator('[data-screen="home"]:not([hidden])').waitFor();
  assert.equal(
    await dailyPage.locator('#home-daily-meta').textContent(),
    'Daily 2026-10-01 ready',
    'the challenge label must advance at midnight in Karachi',
  );
  assert.equal(await dailyPage.evaluate((key) => localStorage.getItem(key), ACTIVE_KEY), null);
  assert.equal(await dailyRestoreStatus.isVisible(), false, 'an expired daily run must not be announced as restored');
  assert.equal(
    await dailyPage.evaluate((key) => localStorage.getItem(key), `${PREFIX}progress`),
    dailyProgressBefore,
    'expiring a daily run must not change cleared levels or campaign unlocks',
  );
  assert.equal(
    await dailyPage.evaluate((key) => localStorage.getItem(key), `${PREFIX}settings`),
    dailySettingsBefore,
    'expiring a daily run must not change settings',
  );
  assert.equal(
    await dailyPage.evaluate((key) => localStorage.getItem(key), `${PREFIX}daily:2026-09-30`),
    currentDailyRecord,
    'expiring a daily run must not alter its existing daily record',
  );
  assert.equal(
    await dailyPage.evaluate((key) => localStorage.getItem(key), `${PREFIX}daily:2026-09-29`),
    previousDailyRecord,
    'expiring a daily run must not alter other daily records',
  );
  assert.equal(
    await dailyPage.evaluate((key) => localStorage.getItem(key), `${PREFIX}daily:2026-10-01`),
    null,
    'the previous day’s run must not create a record for today’s challenge',
  );
  console.log('PASS Karachi day-boundary expiry clears only the old active run and preserves saved progress/settings/daily records');

  console.log('All puzzle resume browser regressions passed.');
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  if (dailyContext) await dailyContext.close();
  if (context) await context.close();
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
