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
const dailyKey = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
const priorDay = new Date(`${dailyKey}T00:00:00.000Z`);
priorDay.setUTCDate(priorDay.getUTCDate() - 1);
const priorDailyKey = `${prefix}daily:${priorDay.toISOString().slice(0, 10)}`;
const activeKey = `${prefix}active-puzzle`;
const dailyPuzzleKey = `${prefix}daily-puzzle`;
const currentDailyRecordKey = `${prefix}daily:${dailyKey}`;
const progressKey = `${prefix}progress`;
const settingsKey = `${prefix}settings`;

async function availablePort() {
  const probe = createServer();
  await new Promise((resolveListen, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolveListen);
  });
  const address = probe.address();
  assert(address && typeof address !== 'string');
  await new Promise((resolveClose, reject) => probe.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function waitForServer(url, server) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited with code ${server.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Wait for the local server to bind.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Timed out waiting for the local Vite server');
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
    colorScheme: 'dark',
    serviceWorkers: 'block',
  });
  await context.route('https://**/*', (route) => route.abort());
  await context.addInitScript(({ seed }) => {
    const audit = {
      armed: false,
      dailyCtaActivations: 0,
      retryActivations: 0,
      clickTargets: [],
      writes: [],
      removals: [],
      uniquePersistedEngines: 0,
      seenEngines: new WeakSet(),
      pageErrors: [],
    };
    window.__dailyPointerAudit = audit;

    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (window.__dailyPointerAudit?.armed && this === window.localStorage) {
        window.__dailyPointerAudit.writes.push({ key: String(key), value: String(value) });
      }
      return originalSetItem.call(this, key, value);
    };
    const originalRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      if (window.__dailyPointerAudit?.armed && this === window.localStorage) {
        window.__dailyPointerAudit.removals.push(String(key));
      }
      return originalRemoveItem.call(this, key);
    };
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (type === 'click' && this instanceof HTMLElement && ['btn-daily', 'btn-retry'].includes(this.id) && typeof listener === 'function') {
        const buttonId = this.id;
        const wrapped = function (event) {
          if (window.__dailyPointerAudit?.armed) {
            if (buttonId === 'btn-daily') window.__dailyPointerAudit.dailyCtaActivations += 1;
            if (buttonId === 'btn-retry') window.__dailyPointerAudit.retryActivations += 1;
          }
          return listener.call(this, event);
        };
        return originalAddEventListener.call(this, type, wrapped, options);
      }
      return originalAddEventListener.call(this, type, listener, options);
    };
    document.addEventListener('click', (event) => {
      if (!window.__dailyPointerAudit?.armed) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      window.__dailyPointerAudit.clickTargets.push(target?.closest('button')?.id ?? null);
    }, true);
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
  }, {
    seed: {
      [`${prefix}onboarded`]: JSON.stringify({ ok: true }),
      [progressKey]: JSON.stringify({ unlocked: 4, cleared: [1, 2, 3] }),
      [settingsKey]: JSON.stringify({ muted: true, adsRemoved: false }),
      [priorDailyKey]: JSON.stringify({ completed: true, levelId: 7, finishedAt: `${dailyKey}T08:00:00.000Z` }),
    },
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-screen="home"]:not([hidden])').waitFor({ timeout: 10000 });

  const progressBefore = await page.evaluate((key) => localStorage.getItem(key), progressKey);
  const settingsBefore = await page.evaluate((key) => localStorage.getItem(key), settingsKey);
  const priorDailyBefore = await page.evaluate((key) => localStorage.getItem(key), priorDailyKey);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), currentDailyRecordKey), null);

  await page.evaluate(async (url) => {
    const { Engine } = await import(url);
    const originalGetSnapshot = Engine.prototype.getSnapshot;
    Engine.prototype.getSnapshot = function (...args) {
      const audit = window.__dailyPointerAudit;
      if (audit?.armed && !audit.seenEngines.has(this)) {
        audit.seenEngines.add(this);
        audit.uniquePersistedEngines += 1;
      }
      return originalGetSnapshot.apply(this, args);
    };
  }, new URL('src/game/engine.ts', baseUrl).href);

  const dailyButton = page.locator('#btn-daily');
  const box = await dailyButton.boundingBox();
  assert(box, 'Home Daily CTA should have a visible hit target');
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.evaluate(() => { window.__dailyPointerAudit.armed = true; });

  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.locator('[data-screen="play"]:not([hidden])').waitFor({ timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('play-title')?.textContent?.startsWith('Daily challenge'));
  const firstFocus = await page.evaluate(() => ({
    className: document.activeElement instanceof HTMLElement ? document.activeElement.className : null,
    cellIndex: document.activeElement instanceof HTMLElement ? document.activeElement.dataset.cellIndex ?? null : null,
  }));
  assert.equal(firstFocus.className, 'board-cell', 'Daily entry should focus the first board cell');
  assert.equal(firstFocus.cellIndex, '0');

  const secondHit = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    return target instanceof HTMLElement ? target.closest('button')?.id ?? null : null;
  }, point);
  assert.equal(secondHit, 'btn-retry', 'the reproduction point should overlap Retry after the screen transition');
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(80);

  const result = await page.evaluate(({ activeKey, dailyPuzzleKey, recordKey, progressKey, settingsKey, priorDailyKey }) => {
    const audit = window.__dailyPointerAudit;
    return {
      dailyCtaActivations: audit.dailyCtaActivations,
      retryActivations: audit.retryActivations,
      clickTargets: audit.clickTargets,
      dailyRecordWrites: audit.writes.filter((entry) => entry.key === recordKey).map((entry) => JSON.parse(entry.value)),
      activePuzzleRemovals: audit.removals.filter((key) => key === activeKey),
      dailyPuzzleRemovals: audit.removals.filter((key) => key === dailyPuzzleKey),
      activePuzzle: JSON.parse(localStorage.getItem(activeKey)),
      dailyPuzzle: JSON.parse(localStorage.getItem(dailyPuzzleKey)),
      dailyRecord: JSON.parse(localStorage.getItem(recordKey)),
      progress: localStorage.getItem(progressKey),
      settings: localStorage.getItem(settingsKey),
      priorDailyRecord: localStorage.getItem(priorDailyKey),
      uniquePersistedEngines: audit.uniquePersistedEngines,
      focusAfterSecondTap: {
        className: document.activeElement instanceof HTMLElement ? document.activeElement.className : null,
        cellIndex: document.activeElement instanceof HTMLElement ? document.activeElement.dataset.cellIndex ?? null : null,
      },
    };
  }, { activeKey, dailyPuzzleKey, recordKey: currentDailyRecordKey, progressKey, settingsKey, priorDailyKey });

  assert.equal(result.dailyCtaActivations, 1, 'the Daily CTA handler should activate exactly once');
  assert.equal(result.retryActivations, 0, 'the second pointer tap must not activate Retry');
  assert.deepEqual(result.clickTargets[0], 'btn-daily', 'the first native click should target the Daily CTA');
  assert.equal(result.uniquePersistedEngines, 1, 'the pointer double-click should create exactly one Daily run');
  assert.equal(result.dailyRecordWrites.length, 1, 'the pointer double-click should write exactly one Daily record');
  assert.equal(result.dailyRecord.completed, false);
  assert.equal(result.activePuzzle.mode, 'daily');
  assert.equal(result.activePuzzle.engine.history.length, 0, 'the second tap must not reset or move the pristine Daily run');
  assert.deepEqual(result.activePuzzle, result.dailyPuzzle, 'active and parked Daily snapshots should remain identical');
  assert.deepEqual(result.activePuzzleRemovals, [], 'the suppressed tap must not clear the active run');
  assert.deepEqual(result.dailyPuzzleRemovals, [], 'the suppressed tap must not clear the parked Daily run');
  assert.deepEqual(result.focusAfterSecondTap, { className: 'board-cell', cellIndex: '0' });
  assert.equal(result.progress, progressBefore, 'campaign unlocks must remain unchanged');
  assert.equal(result.settings, settingsBefore, 'settings must remain unchanged');
  assert.equal(result.priorDailyRecord, priorDailyBefore, 'the earlier Daily record must remain unchanged');
  assert.deepEqual(pageErrors, [], 'the page must have no uncaught errors');

  console.log(`PASS rapid Daily pointer double-click: ${result.dailyCtaActivations} CTA activation, ${result.uniquePersistedEngines} Daily run, ${result.dailyRecordWrites.length} Daily-record write; Retry click-through suppressed; focus remains on board cell 0.`);
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server.exitCode === null) server.kill('SIGTERM');
}
