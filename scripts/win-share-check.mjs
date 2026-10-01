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
const basePath = '/arrowpath/';
const storagePrefix = 'arrowpath:v1:';
const expectedText = 'ArrowPath — cleared level 1 (neon metro)';
const scenarios = [
  'native-success',
  'user-cancellation',
  'clipboard-fallback',
  'non-cancellation-error',
];

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
      // Wait for the loopback-only server to bind.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Timed out waiting for local Vite');
}

async function runCase(browser, baseUrl, scenario) {
  const baseOrigin = new URL(baseUrl).origin;
  const externalRequests = [];
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
    serviceWorkers: 'block',
  });
  try {
    await context.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      if (new URL(requestUrl).origin === baseOrigin) {
        await route.continue();
      } else {
        externalRequests.push(requestUrl);
        await route.abort();
      }
    });
    await context.addInitScript(({ prefix, scenarioName }) => {
      localStorage.setItem(`${prefix}onboarded`, JSON.stringify({ ok: true }));
      localStorage.setItem(`${prefix}progress`, JSON.stringify({ unlocked: 1, cleared: [] }));
      localStorage.setItem(`${prefix}settings`, JSON.stringify({ muted: true, adsRemoved: false }));
      window.__shareAudit = {
        shareCalls: [],
        shareSettled: false,
        clipboardWrites: [],
        clipboardSettled: false,
      };
      const audit = window.__shareAudit;
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: scenarioName === 'clipboard-fallback' ? undefined : async (payload) => {
          audit.shareCalls.push({ title: payload.title, text: payload.text });
          const errorName = scenarioName === 'user-cancellation'
            ? 'AbortError'
            : scenarioName === 'non-cancellation-error'
              ? 'NotAllowedError'
              : null;
          audit.shareSettled = true;
          if (errorName) {
            throw new DOMException('Synthetic mocked share rejection.', errorName);
          }
        },
      });
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text) => {
            audit.clipboardWrites.push(text);
            audit.clipboardSettled = true;
          },
        },
      });
    }, { prefix: storagePrefix, scenarioName: scenario });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-screen="home"]:not([hidden])').waitFor({ timeout: 5000 });
    await page.locator('#btn-play').click();
    await page.locator('[data-screen="play"]:not([hidden])').waitFor({ timeout: 5000 });
    await page.locator('#board-access button[data-x="1"][data-y="1"]').click();
    await page.locator('#overlay-win:not([hidden])').waitFor({ timeout: 5000 });

    const campaignProgress = await page.evaluate((key) =>
      JSON.parse(localStorage.getItem(key) ?? 'null'), `${storagePrefix}progress`);
    assert.deepEqual(campaignProgress.cleared, [1], 'synthetic completion must be Campaign level 1');

    await page.locator('#btn-share').click();
    await page.waitForFunction((scenarioName) => {
      const audit = window.__shareAudit;
      if (scenarioName === 'native-success' || scenarioName === 'user-cancellation') {
        return audit.shareSettled;
      }
      if (scenarioName === 'non-cancellation-error') {
        return audit.shareSettled && audit.clipboardSettled;
      }
      return audit.clipboardSettled;
    }, scenario, { timeout: 3000 });
    // Let promise rejection handlers and toast updates settle before observing the UI.
    await page.waitForTimeout(80);

    const observed = await page.evaluate(() => ({
      shareCalls: window.__shareAudit.shareCalls,
      clipboardWrites: window.__shareAudit.clipboardWrites,
      toastText: document.querySelector('#toast')?.textContent?.trim() ?? '',
      toastVisible: document.querySelector('#toast')?.hidden === false,
      winVisible: document.querySelector('#overlay-win')?.hidden === false,
    }));
    assert.deepEqual(pageErrors, [], `unexpected page errors: ${pageErrors.join('; ')}`);
    assert.deepEqual(externalRequests, [], `external requests were attempted: ${externalRequests.join(', ')}`);
    assert.equal(observed.winVisible, true, 'share/copy action must leave the Win overlay open');
    assert.deepEqual(
      observed.shareCalls,
      scenario === 'clipboard-fallback' ? [] : [{ title: 'ArrowPath', text: expectedText }],
    );

    if (scenario === 'native-success') {
      assert.deepEqual(observed.clipboardWrites, []);
      assert.equal(observed.toastVisible, false);
      console.log('PASS native share success: correct payload; no clipboard write or copied toast.');
    } else if (scenario === 'user-cancellation') {
      assert.deepEqual(observed.clipboardWrites, [], 'AbortError must not trigger clipboard fallback');
      assert.equal(observed.toastVisible, false, 'AbortError must not show a copied toast');
      console.log('PASS user cancellation: AbortError caused no clipboard write or copied toast.');
    } else {
      assert.deepEqual(observed.clipboardWrites, [expectedText]);
      assert.equal(observed.toastText, 'Copied share text');
      assert.equal(observed.toastVisible, true);
      console.log(scenario === 'clipboard-fallback'
        ? 'PASS unsupported native share: copied the exact text and showed the copied toast.'
        : 'PASS non-cancellation share error: copied the exact text and showed the copied toast.');
    }
    return externalRequests.length;
  } finally {
    await context.close();
  }
}

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}${basePath}`;
const server = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});
let browser;
try {
  await waitForServer(baseUrl, server);
  const launchOptions = { headless: true, args: ['--no-sandbox'] };
  if (process.env.CHROMIUM_PATH || existsSync(chromiumPath)) launchOptions.executablePath = chromiumPath;
  browser = await chromium.launch(launchOptions);

  let externalRequestCount = 0;
  for (const scenario of scenarios) {
    externalRequestCount += await runCase(browser, baseUrl, scenario);
  }
  assert.equal(externalRequestCount, 0, 'the browser audit must not attempt external requests');
  console.log('All mocked Win share/copy browser regressions passed; external requests attempted: 0.');
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  await new Promise((resolveExit) => {
    if (server.exitCode !== null) return resolveExit();
    server.once('exit', resolveExit);
    setTimeout(resolveExit, 1000).unref();
  });
}
