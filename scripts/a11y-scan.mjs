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
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

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

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}/arrowpath/`;
const server = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});
let browser;
const failures = [];

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited with code ${server.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Wait for Vite to bind its port.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Timed out waiting for Vite to start');
}

async function scan(page, label) {
  const results = await new AxeBuilder({ page }).withTags(tags).analyze();
  if (!results.violations.length) {
    console.log(`PASS ${label}: no axe violations (${tags.join(', ')})`);
    return;
  }
  for (const violation of results.violations) {
    const entry = {
      view: label,
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    };
    failures.push(entry);
    console.error(`FAIL ${label}: ${violation.id} (${violation.impact ?? 'unknown'}) — ${violation.help}`);
    for (const node of entry.nodes) console.error(`  ${node.target.join(', ')}\n  ${node.summary}`);
  }
}

try {
  await waitForServer(baseUrl);
  const launchOptions = { headless: true, args: ['--no-sandbox'] };
  if (process.env.CHROMIUM_PATH || existsSync(chromiumPath)) launchOptions.executablePath = chromiumPath;
  browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  if (await page.locator('#btn-howto-ok').isVisible()) {
    await scan(page, 'how-to / onboarding');
    await page.locator('#btn-howto-ok').click();
  }
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  await scan(page, 'home');

  await page.locator('#btn-levels').click();
  await scan(page, 'level select');
  await page.locator('#btn-levels-back').click();
  await page.locator('#btn-settings').click();
  await scan(page, 'settings');
  await page.locator('#btn-settings-back').click();

  await page.locator('#btn-play').click();
  await page.locator('#board-access [role="gridcell"]').first().waitFor();
  await scan(page, 'active puzzle board (Level 1)');

  const startingCell = Number(await page.evaluate(() => document.activeElement?.getAttribute('data-cell-index')));
  assert.ok(Number.isInteger(startingCell) && startingCell >= 0, 'starting focus should land on a board cell');
  await page.keyboard.press('ArrowRight');
  assert.equal(
    Number(await page.evaluate(() => document.activeElement?.getAttribute('data-cell-index'))),
    startingCell + 1,
    'Right Arrow should move focus to the next board cell',
  );
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-undo', 'Tab should leave the grid at the first game control');
  await page.locator('#board-access [data-cell-index="4"]').focus();

  await page.locator('#btn-hint').click();
  await page.locator('#overlay-reward:not([hidden])').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-reward-ok', 'reward dialog should receive initial focus');
  await scan(page, 'reward dialog');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-reward-cancel', 'reverse Tab should wrap to the last dialog control');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-reward-ok', 'forward Tab should wrap to the first dialog control');
  await page.keyboard.press('Escape');
  await page.locator('#overlay-reward').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-hint', 'closing the dialog should restore focus to its opener');

  const safeCell = page.locator('#board-access [role="gridcell"][aria-disabled="false"][aria-label*="Path is clear to the board edge"]').first();
  assert.ok(await safeCell.count(), 'Level 1 should expose a safe arrow for the completion dialog scan');
  await safeCell.focus();
  await page.keyboard.press('Enter');
  await page.locator('#overlay-win:not([hidden])').waitFor({ timeout: 3000 });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-next', 'completion dialog should receive initial focus');
  await scan(page, 'completion dialog');
  await page.keyboard.press('Escape');
  await page.locator('#overlay-win').waitFor({ state: 'hidden' });
  assert.ok(await page.evaluate(() => document.activeElement?.closest('#board-access') !== null), 'closing completion dialog should restore focus to the board');

  await page.locator('#btn-menu').click();
  await page.locator('#btn-levels').click();
  const levelTwo = page.locator('#level-grid button').filter({ hasText: /^2$/ });
  await levelTwo.waitFor();
  assert.equal(await levelTwo.isEnabled(), true, 'clearing Level 1 should unlock Level 2');
  await levelTwo.click();
  await page.locator('#board-access [role="gridcell"]').first().waitFor();
  await scan(page, 'active puzzle board (Level 2)');

  const blockedCell = page.locator('#board-access [role="gridcell"][aria-disabled="false"][aria-label*="Path is blocked"]').first();
  assert.ok(await blockedCell.count(), 'Level 2 should expose a blocked arrow for the failure dialog scan');
  await blockedCell.click();
  await page.locator('#overlay-fail:not([hidden])').waitFor({ timeout: 3000 });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-fail-retry', 'failure dialog should receive initial focus');
  await scan(page, 'failure dialog');
  await page.keyboard.press('Escape');
  await page.locator('#overlay-fail').waitFor({ state: 'hidden' });
  assert.ok(await page.evaluate(() => document.activeElement?.closest('#board-access') !== null), 'closing failure dialog should restore focus to the board');

  await page.locator('#btn-retry').click();
  const safeAfterRetry = page.locator('#board-access [role="gridcell"][aria-disabled="false"][aria-label*="Path is clear to the board edge"]').first();
  assert.ok(await safeAfterRetry.count(), 'Level 2 should retain a safe arrow after retry');
  await safeAfterRetry.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  assert.match(await page.locator('#board-announcement').textContent() ?? '', /1 arrow remains\./, 'Space should fire the focused safe arrow');
  const lastArrow = page.locator('#board-access [role="gridcell"][aria-disabled="false"][aria-label*="Path is clear to the board edge"]').first();
  await lastArrow.focus();
  await page.keyboard.press('Enter');
  await page.locator('#overlay-win:not([hidden])').waitFor({ timeout: 3000 });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-next', 'Enter should activate the remaining arrow and show completion');

  if (failures.length) {
    console.error(`\n${failures.length} axe violation(s) across the scanned views.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll browser accessibility scans and keyboard-focus regressions passed.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
