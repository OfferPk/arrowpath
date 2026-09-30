import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = resolve(root, 'dist');
const serviceWorkerPath = resolve(dist, 'sw.js');
const viteEntry = resolve(root, 'node_modules/vite/bin/vite.js');
const chromiumPath = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
const originalServiceWorker = readFileSync(serviceWorkerPath);

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

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}/arrowpath/`;
const server = spawn(
  process.execPath,
  [viteEntry, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: root, stdio: 'ignore' },
);
let browser;

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite preview exited with code ${server.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Wait for Vite preview to bind its port.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Timed out waiting for Vite preview to start');
}

async function scanAxe(page, label) {
  const results = await new AxeBuilder({ page }).withTags(tags).analyze();
  assert.equal(
    results.violations.length,
    0,
    `${label} has axe violations: ${results.violations.map((v) => `${v.id}: ${v.help}`).join('; ')}`,
  );
  console.log(`PASS axe ${label}: no violations`);
}

async function ensureControlledPage(page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  try {
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 4000 });
  } catch {
    // Some browsers do not claim the first page until its next navigation.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 15000 });
  }
  // Workbox must observe an existing controller to classify the next install as an update.
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-screen="home"]:not([hidden]), [data-screen="play"]:not([hidden])').waitFor();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 15000 });
}

async function requestServiceWorkerUpdate(page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });
  await page.locator('#pwa-update-notice:not([hidden])').waitFor({ timeout: 20000 });
}

async function setVisibilityState(page, visibilityState) {
  await page.evaluate((nextState) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: nextState,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visibilityState);
}

async function instrumentServiceWorkerUpdates(page) {
  await page.evaluate(() => {
    const prototype = ServiceWorkerRegistration.prototype;
    const originalUpdate = prototype.update;
    const stats = { attempts: 0, failures: 0 };
    Object.defineProperty(window, '__arrowPathUpdateStats', {
      configurable: true,
      value: stats,
    });
    Object.defineProperty(prototype, 'update', {
      configurable: true,
      writable: true,
      value: function (...args) {
        stats.attempts += 1;
        // Chromium can serve the worker script from cache while offline, so
        // force a deterministic update-fetch rejection in this browser test.
        if (!navigator.onLine) {
          stats.failures += 1;
          return Promise.reject(new TypeError('Service-worker update request failed while offline'));
        }
        return originalUpdate.apply(this, args).catch((error) => {
          stats.failures += 1;
          throw error;
        });
      },
    });
  });
}

async function triggerForegroundUpdateCheck(page, previousAttempts) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(
    (attempts) => window.__arrowPathUpdateStats?.attempts > attempts,
    previousAttempts,
    { timeout: 10000 },
  );
}

async function waitForForegroundUpdateFailure(page, previousFailures) {
  await page.waitForFunction(
    (failures) => window.__arrowPathUpdateStats?.failures > failures,
    previousFailures,
    { timeout: 10000 },
  );
}

async function expectReload(page, previousTimeOrigin) {
  await page.waitForFunction(
    (oldTimeOrigin) => performance.timeOrigin !== oldTimeOrigin,
    previousTimeOrigin,
    { timeout: 15000 },
  );
}

try {
  assert.ok(existsSync(serviceWorkerPath), 'build the app before running the PWA update browser test');
  await waitForServer(baseUrl);
  const launchOptions = { headless: true, args: ['--no-sandbox'] };
  if (process.env.CHROMIUM_PATH || existsSync(chromiumPath)) launchOptions.executablePath = chromiumPath;
  browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  if (await page.locator('#btn-howto-ok').isVisible()) await page.locator('#btn-howto-ok').click();
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  await ensureControlledPage(page);

  // Keep the already-active worker unchanged until the browser has installed it.
  writeFileSync(serviceWorkerPath, Buffer.concat([originalServiceWorker, Buffer.from('\n/* update-handoff-test-1 */\n')]));
  await requestServiceWorkerUpdate(page);
  assert.equal(await page.locator('#btn-pwa-update').textContent(), 'Reload to update');
  await scanAxe(page, 'update notice');
  const safePageTime = await page.evaluate(() => performance.timeOrigin);
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => performance.timeOrigin), safePageTime, 'a detected update must not reload automatically');
  assert.equal(await page.locator('#overlay-update:not([hidden])').count(), 0, 'safe home update must not open a puzzle-loss confirmation');
  await page.locator('#btn-pwa-update').click();
  await expectReload(page, safePageTime);
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  console.log('PASS safe update handoff: waiting worker installs only after the user selects Reload to update');

  // A failed offline foreground check must leave an update-free active game
  // alone, and must not interfere with its ordinary controls.
  await instrumentServiceWorkerUpdates(page);
  await page.locator('#btn-play').click();
  await page.locator('#board-access [role="gridcell"]').first().waitFor();
  const playTime = await page.evaluate(() => performance.timeOrigin);
  const leftBefore = await page.locator('#hud-left').textContent();
  const noUpdateStats = await page.evaluate(() => window.__arrowPathUpdateStats);
  await context.setOffline(true);
  await page.waitForFunction(() => navigator.onLine === false);
  await triggerForegroundUpdateCheck(page, noUpdateStats.attempts);
  await waitForForegroundUpdateFailure(page, noUpdateStats.failures);
  assert.equal(await page.locator('#pwa-update-notice:not([hidden])').count(), 0, 'a failed offline check must not invent an update notice');
  assert.equal(await page.evaluate(() => performance.timeOrigin), playTime, 'a failed offline check must not reload the active game');
  assert.equal(await page.locator('[data-screen="play"]:not([hidden])').count(), 1, 'the active puzzle must remain open after a failed check');
  assert.equal(await page.locator('#hud-left').textContent(), leftBefore, 'a failed check must preserve the unfinished puzzle state');
  await page.locator('#btn-hint').click();
  await page.locator('#overlay-reward:not([hidden])').waitFor();
  await page.locator('#btn-reward-cancel').click();
  await page.locator('#overlay-reward').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#hud-left').textContent(), leftBefore, 'game controls must remain usable without changing the puzzle');
  await context.setOffline(false);
  await page.waitForFunction(() => navigator.onLine === true);
  assert.equal(await page.locator('#pwa-update-notice:not([hidden])').count(), 0, 'reconnecting after a failed check must not show a false update');
  assert.equal(await page.evaluate(() => performance.timeOrigin), playTime, 'reconnecting must preserve the active game');
  console.log('PASS offline check failure: no false notice or reload; the active puzzle and game controls remain usable');

  // Open two active puzzle tabs before a second worker update to verify cross-tab safety.
  const secondPage = await context.newPage();
  await secondPage.goto(baseUrl, { waitUntil: 'networkidle' });
  await secondPage.locator('[data-screen="home"]:not([hidden]), [data-screen="play"]:not([hidden])').waitFor();
  await ensureControlledPage(secondPage);
  await secondPage.locator('[data-screen="play"]:not([hidden])').waitFor();
  await secondPage.locator('#board-access [role="gridcell"]').first().waitFor();
  const secondPageTime = await secondPage.evaluate(() => performance.timeOrigin);
  const secondLeftBefore = await secondPage.locator('#hud-left').textContent();

  // Hide the first game tab while the worker changes; returning to it must
  // trigger a prompt check without reloading either active puzzle. Headless
  // Chromium keeps all tabs visible, so emulate the browser visibility event.
  await page.bringToFront();
  await setVisibilityState(page, 'visible');
  await secondPage.bringToFront();
  await setVisibilityState(page, 'hidden');
  const workerAfterFirstUpdate = readFileSync(serviceWorkerPath);
  writeFileSync(serviceWorkerPath, Buffer.concat([workerAfterFirstUpdate, Buffer.from('\n/* update-handoff-test-2 */\n')]));
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#pwa-update-notice:not([hidden])').count(), 0, 'a background tab should wait until it returns to the foreground');
  await page.bringToFront();
  await setVisibilityState(page, 'visible');
  await page.locator('#pwa-update-notice:not([hidden])').waitFor({ timeout: 20000 });
  await secondPage.locator('#pwa-update-notice:not([hidden])').waitFor({ timeout: 20000 });
  assert.equal(await page.locator('#btn-pwa-update').textContent(), 'Review update');
  assert.equal(await secondPage.locator('#btn-pwa-update').textContent(), 'Review update');
  // An update that was already waiting remains visible through a failed offline
  // check and is still available to the user after connectivity returns.
  const waitingUpdateStats = await page.evaluate(() => window.__arrowPathUpdateStats);
  await context.setOffline(true);
  await page.waitForFunction(() => navigator.onLine === false);
  await triggerForegroundUpdateCheck(page, waitingUpdateStats.attempts);
  await waitForForegroundUpdateFailure(page, waitingUpdateStats.failures);
  assert.equal(await page.locator('#pwa-update-notice:not([hidden])').count(), 1, 'a failed check must not hide an already waiting update');
  assert.equal(await page.locator('#btn-pwa-update').textContent(), 'Review update', 'the waiting update action must remain available offline');
  assert.equal(await page.locator('#btn-pwa-update').isDisabled(), false, 'the waiting update action must remain enabled');
  assert.equal(await page.evaluate(() => performance.timeOrigin), playTime, 'an offline check must not interrupt a puzzle with a waiting update');
  assert.equal(await page.locator('#hud-left').textContent(), leftBefore, 'an offline check must preserve the waiting-update puzzle state');
  await context.setOffline(false);
  await page.waitForFunction(() => navigator.onLine === true);
  await page.locator('#pwa-update-notice:not([hidden])').waitFor();
  assert.equal(await page.locator('#btn-pwa-update').isDisabled(), false, 'the waiting update must remain actionable after reconnecting');
  console.log('PASS waiting update survives offline check: action remains available after reconnecting');
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => performance.timeOrigin), playTime, 'a waiting update must not interrupt active gameplay');
  assert.equal(await secondPage.evaluate(() => performance.timeOrigin), secondPageTime, 'a waiting update must not interrupt another active tab');

  await secondPage.bringToFront();
  await secondPage.locator('#btn-pwa-update-later').click();
  await secondPage.locator('#pwa-update-notice').waitFor({ state: 'hidden' });
  await secondPage.waitForTimeout(500);
  assert.equal(await secondPage.evaluate(() => performance.timeOrigin), secondPageTime, 'deferring an update must keep the second game open');
  assert.equal(await secondPage.locator('#hud-left').textContent(), secondLeftBefore, 'deferring an update must preserve the second puzzle');
  assert.equal(await page.evaluate(() => performance.timeOrigin), playTime, 'deferring an update in another tab must not reload the first game');
  console.log('PASS foreground discovery and deferral: returning tab finds the waiting worker; Not now preserves its active puzzle');

  await page.bringToFront();
  await page.waitForFunction(() => document.visibilityState === 'visible');
  await page.locator('#pwa-update-notice:not([hidden])').waitFor();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => performance.timeOrigin), playTime, 'foregrounding with a waiting update must not reload without consent');

  await page.locator('#btn-pwa-update').click();
  await page.locator('#overlay-update:not([hidden])').waitFor();
  assert.match(await page.locator('#update-confirm-body').textContent() ?? '', /saved.*resume/i);
  await scanAxe(page, 'update confirmation');
  assert.equal(await page.evaluate(() => performance.timeOrigin), playTime, 'opening update confirmation must not reload');
  await page.locator('#btn-update-cancel').click();
  await page.locator('#overlay-update').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => performance.timeOrigin), playTime, 'cancelling must keep the same game page');
  assert.equal(await page.locator('#hud-left').textContent(), leftBefore, 'cancelling must preserve the current puzzle state');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-pwa-update', 'cancelling restores focus to the update action');
  console.log('PASS safe handoff cancellation: active puzzle and focus are preserved');

  await page.locator('#btn-pwa-update').click();
  await page.locator('#overlay-update:not([hidden])').waitFor();
  const confirmedPageTime = await page.evaluate(() => performance.timeOrigin);
  await page.locator('#btn-update-confirm').click();
  await expectReload(page, confirmedPageTime);
  await page.locator('[data-screen="play"]:not([hidden])').waitFor();
  assert.equal(await page.locator('#hud-left').textContent(), leftBefore, 'a confirmed update reload must restore the saved puzzle');
  await secondPage.locator('#pwa-update-notice:not([hidden])').waitFor({ timeout: 15000 });
  assert.equal(await secondPage.evaluate(() => performance.timeOrigin), secondPageTime, 'another tab must stay open when this tab accepts the update');
  assert.equal(await secondPage.locator('#hud-left').textContent(), secondLeftBefore, 'another tab keeps its unfinished puzzle after worker activation');
  assert.equal(await secondPage.locator('#btn-pwa-update').textContent(), 'Review update');
  await scanAxe(secondPage, 'cross-tab update notice');
  console.log('PASS cross-tab handoff: update activation does not silently reload a second puzzle');

  await secondPage.locator('#btn-pwa-update').click();
  await secondPage.locator('#overlay-update:not([hidden])').waitFor();
  const secondConfirmedTime = await secondPage.evaluate(() => performance.timeOrigin);
  await secondPage.locator('#btn-update-confirm').click();
  await expectReload(secondPage, secondConfirmedTime);
  await secondPage.locator('[data-screen="play"]:not([hidden])').waitFor();
  assert.equal(await secondPage.locator('#hud-left').textContent(), secondLeftBefore, 'the second confirmed update reload must restore its saved puzzle');
  console.log('PASS explicit consent: each active puzzle reloads only after its own user confirms, then resumes');
  await context.close();
  console.log('All PWA update browser regressions passed.');
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  writeFileSync(serviceWorkerPath, originalServiceWorker);
  server.kill('SIGTERM');
}
