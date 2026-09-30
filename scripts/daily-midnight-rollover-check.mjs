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
const oldKey = '2026-10-01';
const newKey = '2026-10-02';
const activeKey = `${prefix}active-puzzle`;
const campaignKey = `${prefix}campaign-puzzle`;
const dailyPuzzleKey = `${prefix}daily-puzzle`;

function dailyLevelId(key, levelCount = 50) {
  let h = 2166136261 >>> 0;
  const input = `arrowpath-daily|${key}`;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) % Math.max(1, levelCount | 0) + 1;
}

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

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}/arrowpath/`;
const origin = new URL(baseUrl).origin;
const server = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});
let browser;
let context;
const pageErrors = [];
try {
  await waitForServer(baseUrl, server);
  const launchOptions = { headless: true, args: ['--no-sandbox'] };
  if (process.env.CHROMIUM_PATH || existsSync(chromiumPath)) launchOptions.executablePath = chromiumPath;
  browser = await chromium.launch(launchOptions);
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: 'Asia/Karachi',
    serviceWorkers: 'block',
  });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-10-01T18:59:50.000Z') });
  await context.addInitScript(({ keyPrefix, priorKey }) => {
    localStorage.setItem(`${keyPrefix}onboarded`, JSON.stringify({ ok: true }));
    localStorage.setItem(`${keyPrefix}progress`, JSON.stringify({ unlocked: 4, cleared: [1, 2, 3] }));
    localStorage.setItem(`${keyPrefix}settings`, JSON.stringify({ muted: true, adsRemoved: false }));
    localStorage.setItem(`${keyPrefix}daily:${priorKey}`, JSON.stringify({
      completed: true,
      levelId: 17,
      finishedAt: '2026-10-01T10:00:00.000Z',
    }));
    localStorage.setItem(`${keyPrefix}daily-puzzle`, JSON.stringify({
      version: 1,
      levelId: 17,
      mode: 'daily',
      dailyKey: priorKey,
      engine: { marker: 'synthetic-yesterday-only' },
    }));
  }, { keyPrefix: prefix, priorKey: oldKey });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(document.getElementById('home-daily-meta')));
  const documentId = await page.evaluate(() => (window.__dailyRolloverDocumentId ??= crypto.randomUUID()));
  const beforeHome = await page.evaluate(() => ({
    now: new Date().toISOString(),
    dailyMeta: document.getElementById('home-daily-meta')?.textContent,
    dailyDisabled: document.getElementById('btn-daily')?.disabled,
    dailyText: document.getElementById('btn-daily')?.textContent,
    progress: localStorage.getItem('arrowpath:v1:progress'),
    settings: localStorage.getItem('arrowpath:v1:settings'),
  }));
  assert.match(beforeHome.now, /^2026-10-01T18:59:5/);
  assert.equal(beforeHome.dailyMeta, 'Daily 2026-10-01 ✓ completed');
  assert.equal(beforeHome.dailyDisabled, true, 'yesterday completion should initially disable the CTA');

  await page.locator('#btn-play').click();
  await page.waitForFunction(() => document.querySelector('[data-screen="play"]')?.hidden === false);
  assert.equal(await page.locator('#play-title').textContent(), 'Level 4');
  await page.locator('.board-cell[data-cell-index="0"]').click();
  await page.waitForFunction((key) => {
    try {
      const snapshot = JSON.parse(localStorage.getItem(key) ?? 'null');
      return snapshot?.mode === 'campaign' && snapshot.engine?.history?.length === 1;
    } catch {
      return false;
    }
  }, activeKey);
  const campaignBefore = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), activeKey);
  assert.equal(campaignBefore.levelId, 4);
  assert.equal(campaignBefore.engine.state.movesMade, 1);
  assert.equal(campaignBefore.engine.history.length, 1, 'Campaign should have an available Undo before parking');
  assert.equal(await page.locator('#btn-undo').isEnabled(), true);

  await page.locator('#btn-menu').click();
  await page.waitForFunction(() => document.querySelector('[data-screen="home"]')?.hidden === false);
  const parkedCampaign = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), campaignKey);
  assert.deepEqual(parkedCampaign, campaignBefore, 'menu should park the Campaign run without changing its Undo history');

  await page.clock.fastForward(20_000);
  await page.waitForFunction(() => {
    const button = document.getElementById('btn-daily');
    return document.getElementById('home-daily-meta')?.textContent === 'Daily 2026-10-02 ready' && button && !button.disabled;
  }, null, { timeout: 3000 });
  const afterMidnight = await page.evaluate(() => ({
    now: new Date().toISOString(),
    dailyMeta: document.getElementById('home-daily-meta')?.textContent,
    dailyDisabled: document.getElementById('btn-daily')?.disabled,
    dailyText: document.getElementById('btn-daily')?.textContent,
    documentId: window.__dailyRolloverDocumentId,
    progress: localStorage.getItem('arrowpath:v1:progress'),
    settings: localStorage.getItem('arrowpath:v1:settings'),
    campaign: localStorage.getItem('arrowpath:v1:campaign-puzzle'),
  }));
  const newPktKey = new Date(Date.parse(afterMidnight.now) + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  assert.equal(newPktKey, newKey);
  assert.equal(afterMidnight.documentId, documentId, 'the tab should not reload across rollover');
  assert.equal(afterMidnight.dailyDisabled, false);
  assert.equal(afterMidnight.dailyText, 'Daily Challenge');
  assert.equal(afterMidnight.progress, beforeHome.progress);
  assert.equal(afterMidnight.settings, beforeHome.settings);
  assert.equal(afterMidnight.campaign, JSON.stringify(campaignBefore));

  await page.locator('#btn-daily').click();
  await page.waitForFunction(() => document.querySelector('[data-screen="play"]')?.hidden === false && document.getElementById('play-title')?.textContent?.startsWith('Daily challenge'));
  const expectedDailyLevel = dailyLevelId(newKey);
  const dailyState = await page.evaluate(({ activeKey: activeStorageKey, campaignKey: campaignStorageKey, dailyPuzzleKey: dailyStorageKey, oldKey: priorKey, newKey: currentKey }) => ({
    title: document.getElementById('play-title')?.textContent,
    active: JSON.parse(localStorage.getItem(activeStorageKey)),
    dailySnapshot: JSON.parse(localStorage.getItem(dailyStorageKey)),
    campaignSnapshot: JSON.parse(localStorage.getItem(campaignStorageKey)),
    currentRecord: JSON.parse(localStorage.getItem(`arrowpath:v1:daily:${currentKey}`)),
    oldRecord: JSON.parse(localStorage.getItem(`arrowpath:v1:daily:${priorKey}`)),
    progress: localStorage.getItem('arrowpath:v1:progress'),
    settings: localStorage.getItem('arrowpath:v1:settings'),
  }), { activeKey, campaignKey, dailyPuzzleKey, oldKey, newKey });
  assert.equal(dailyState.title, `Daily challenge D${expectedDailyLevel}`);
  assert.equal(dailyState.active.mode, 'daily');
  assert.equal(dailyState.active.dailyKey, newKey);
  assert.equal(dailyState.active.levelId, expectedDailyLevel);
  assert.equal(dailyState.dailySnapshot.dailyKey, newKey, 'yesterday Daily snapshot must not carry into today');
  assert.equal(dailyState.dailySnapshot.levelId, expectedDailyLevel);
  assert.equal(dailyState.active.engine.state.movesMade, 0);
  assert.equal(dailyState.active.engine.history.length, 0, 'new Daily should not inherit yesterday move history');
  assert.equal(dailyState.currentRecord.completed, false, 'the new PKT day should start incomplete');
  assert.equal(dailyState.oldRecord.completed, true, 'yesterday completion should remain date-scoped');
  assert.deepEqual(dailyState.campaignSnapshot, campaignBefore, 'Campaign and its Undo history should remain parked exactly');
  assert.equal(dailyState.progress, beforeHome.progress, 'Campaign unlocks should not change');
  assert.equal(dailyState.settings, beforeHome.settings, 'settings should not change');

  await page.locator('#btn-menu').click();
  await page.waitForFunction(() => document.querySelector('[data-screen="home"]')?.hidden === false);
  await page.locator('#btn-settings').click();
  await page.waitForFunction(() => document.querySelector('[data-screen="settings"]')?.hidden === false);
  assert.equal(await page.locator('#btn-mute').textContent(), 'Vibration off');
  assert.match(await page.locator('#ads-status').textContent(), /Ads: enabled/);
  await page.locator('#btn-settings-back').click();
  await page.locator('#btn-levels').click();
  await page.locator('#level-grid button[data-level-id="4"]').click();
  await page.waitForFunction(() => document.querySelector('[data-screen="play"]')?.hidden === false && document.getElementById('play-title')?.textContent === 'Level 4');
  const restoredCampaign = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), activeKey);
  assert.deepEqual(restoredCampaign, campaignBefore, 'Campaign should restore with its exact pre-midnight state and history');
  assert.equal(await page.locator('#btn-undo').isEnabled(), true, 'restored Campaign should still offer Undo');
  await page.locator('#btn-undo').click();
  await page.waitForFunction((key) => {
    try {
      const snapshot = JSON.parse(localStorage.getItem(key) ?? 'null');
      return snapshot?.mode === 'campaign' && snapshot.engine?.history?.length === 0 && snapshot.engine?.state?.undosLeft === 2;
    } catch {
      return false;
    }
  }, activeKey);
  const afterUndo = await page.evaluate(({ activeKey: activeStorageKey, dailyPuzzleKey: dailyStorageKey, currentKey }) => ({
    campaign: JSON.parse(localStorage.getItem(activeStorageKey)),
    daily: JSON.parse(localStorage.getItem(dailyStorageKey)),
    dailyRecord: JSON.parse(localStorage.getItem(`arrowpath:v1:daily:${currentKey}`)),
    progress: localStorage.getItem('arrowpath:v1:progress'),
    settings: localStorage.getItem('arrowpath:v1:settings'),
  }), { activeKey, dailyPuzzleKey, currentKey: newKey });
  assert.equal(afterUndo.campaign.engine.state.movesMade, 0);
  assert.equal(afterUndo.campaign.engine.state.undosLeft, 2);
  assert.equal(afterUndo.campaign.engine.history.length, 0);
  assert.equal(afterUndo.daily.dailyKey, newKey, 'today Daily snapshot should remain parked during Campaign Undo');
  assert.equal(afterUndo.dailyRecord.completed, false);
  assert.equal(afterUndo.progress, beforeHome.progress);
  assert.equal(afterUndo.settings, beforeHome.settings);
  assert.deepEqual(pageErrors, [], 'the rollover flow should not produce console or page errors');
  console.log(`PASS same-tab PKT rollover ${oldKey} → ${newKey}: Home refreshes without reload; Daily selects level ${expectedDailyLevel} with no prior-day completion/snapshot bleed; Campaign, Undo, settings and unlocks stay intact.`);
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolveExit) => {
      if (server.exitCode !== null) resolveExit();
      else server.once('exit', resolveExit);
    });
  }
}
