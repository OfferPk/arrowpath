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
    await page.locator('[data-screen="home"]:not([hidden])').waitFor();
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      'btn-howto',
      'finishing How-to should return keyboard focus to its Home trigger',
    );
  }
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  await scan(page, 'home');

  await page.locator('#btn-levels').click();
  assert.equal(
    await page.evaluate(() => document.activeElement === document.querySelector('#level-grid .current')),
    true,
    'Home → Level Select should move keyboard focus into the highlighted level',
  );
  await scan(page, 'level select');
  await page.locator('#btn-levels-back').click();
  await page.locator('#btn-settings').click();
  await scan(page, 'settings');
  await page.locator('#btn-settings-back').click();
  await page.locator('[data-screen="home"]:not([hidden])').waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'btn-settings',
    'Settings Back should return keyboard focus to its Home trigger',
  );

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
  const progressAfterWin = await page.evaluate((key) => localStorage.getItem(key), 'arrowpath:v1:progress');
  const settingsAfterWin = await page.evaluate((key) => localStorage.getItem(key), 'arrowpath:v1:settings');
  await page.locator('#btn-win-levels').click();
  await page.locator('[data-screen="levels"]:not([hidden])').waitFor();
  assert.equal(await page.locator('#level-grid .current').textContent(), '2', 'the win picker should highlight the next unlocked level');
  assert.equal(
    await page.evaluate(() => document.activeElement === document.querySelector('#level-grid .current')),
    true,
    'Win → Level Select should focus the highlighted next level',
  );
  await page.keyboard.press('Escape');
  await page.locator('[data-screen="play"]:not([hidden])').waitFor();
  await page.locator('#overlay-win:not([hidden])').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-win-levels', 'Escape should restore the win dialog and return focus to its picker trigger');
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), 'arrowpath:v1:progress'), progressAfterWin, 'opening and closing the picker must not alter cleared progress');
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), 'arrowpath:v1:settings'), settingsAfterWin, 'opening and closing the picker must not alter settings');
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
  await page.locator('#overlay-puzzle-confirm:not([hidden])').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-puzzle-confirm', 'restart confirmation should receive initial focus');
  await scan(page, 'restart confirmation');
  await page.locator('#btn-puzzle-confirm').click();
  await page.locator('#overlay-puzzle-confirm').waitFor({ state: 'hidden' });
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

  const touchContext = await browser.newContext({
    viewport: { width: 568, height: 320 },
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  });
  const touchPage = await touchContext.newPage();
  await touchPage.addInitScript(() => {
    localStorage.setItem('arrowpath:v1:progress', JSON.stringify({ unlocked: 50, cleared: [] }));
    localStorage.setItem('arrowpath:v1:onboarded', JSON.stringify({ ok: true }));
  });
  await touchPage.goto(baseUrl, { waitUntil: 'networkidle' });
  await touchPage.locator('#btn-levels').tap();
  const focusedMobileLevel = await touchPage.evaluate(() => {
    const current = document.querySelector('#level-grid .current');
    const grid = document.querySelector('#level-grid');
    const target = current?.getBoundingClientRect();
    const viewport = grid?.getBoundingClientRect();
    return {
      focused: document.activeElement === current,
      level: current?.textContent,
      gridScrollTop: grid?.scrollTop,
      visible: Boolean(target && viewport && target.top >= viewport.top && target.bottom <= viewport.bottom),
    };
  });
  assert.equal(focusedMobileLevel.level, '50', 'the mobile picker should target its highlighted campaign level');
  assert.equal(focusedMobileLevel.focused, true, 'mobile Home → Level Select should focus the highlighted level');
  assert.equal(focusedMobileLevel.visible, true, 'the focused high-numbered level should scroll into the picker viewport');
  assert.ok((focusedMobileLevel.gridScrollTop ?? 0) > 0, 'the mobile picker should scroll to the focused high-numbered level');
  await touchPage.locator('#btn-levels-back').tap();
  assert.equal(await touchPage.evaluate(() => document.activeElement?.id), 'btn-levels', 'mobile Back should restore focus to the Home picker trigger');
  await touchPage.locator('#btn-levels').tap();
  assert.equal(
    await touchPage.evaluate(() => document.activeElement === document.querySelector('#level-grid .current')),
    true,
    'reopening the mobile picker should focus the highlighted level',
  );
  await touchPage.locator('#level-grid button').filter({ hasText: /^50$/ }).tap();
  await touchPage.locator('#board-access [role="gridcell"]').first().waitFor();
  await scan(touchPage, 'compact landscape (Level 50 touch board)');

  const mobileLayout = await touchPage.evaluate(() => {
    const rect = (element) => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, bottom: bounds.bottom };
    };
    const cells = Array.from(document.querySelectorAll('#board-access [role="gridcell"]'), rect);
    const controls = ['#btn-menu', '#btn-hint', '#btn-undo', '#btn-retry', '#btn-play-levels'].map((id) =>
      rect(document.querySelector(id)),
    );
    return {
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      cellWidth: Math.min(...cells.map((cell) => cell.width)),
      cellHeight: Math.min(...cells.map((cell) => cell.height)),
      cells,
      board: rect(document.querySelector('#board')),
      hud: rect(document.querySelector('.hud')),
      controls,
    };
  });
  const overlaps = (a, b) =>
    a.x < b.x + b.width - 0.01 &&
    a.x + a.width > b.x + 0.01 &&
    a.y < b.y + b.height - 0.01 &&
    a.y + a.height > b.y + 0.01;
  assert.equal(mobileLayout.cells.length, 49, 'Level 50 should expose all 49 touch targets');
  assert.ok(mobileLayout.cellWidth >= 44 && mobileLayout.cellHeight >= 44, '568×320 compact landscape should provide 44px square cells');
  assert.ok(mobileLayout.controls.every((control) => control.width >= 44 && control.height >= 44), 'all compact-landscape icon and action controls should be at least 44px');
  assert.ok(
    mobileLayout.cells.every((cell) =>
      Math.abs(cell.width - mobileLayout.board.width / 7) < 0.1 &&
      Math.abs(cell.height - mobileLayout.board.height / 7) < 0.1,
    ),
    'each hit target should map to exactly one visible board cell',
  );
  for (let i = 0; i < mobileLayout.cells.length; i += 1) {
    for (let j = i + 1; j < mobileLayout.cells.length; j += 1) {
      assert.ok(!overlaps(mobileLayout.cells[i], mobileLayout.cells[j]), `board hit targets ${i} and ${j} should not overlap`);
    }
  }
  assert.ok(mobileLayout.scrollWidth <= mobileLayout.width, 'compact landscape layout should not scroll horizontally');
  assert.ok(mobileLayout.scrollHeight <= mobileLayout.height, 'board and controls should fit without vertical scrolling');
  assert.ok(mobileLayout.board.x >= 0 && mobileLayout.board.x + mobileLayout.board.width <= mobileLayout.width, 'the board should remain inside the horizontal viewport bounds');
  assert.ok(mobileLayout.board.bottom <= mobileLayout.height, 'board should remain inside the viewport');
  assert.ok(mobileLayout.hud.bottom <= mobileLayout.height, 'HUD should remain inside the viewport');
  assert.ok(mobileLayout.controls.every((control) => control.x >= 0 && control.x + control.width <= mobileLayout.width && control.y >= 0 && control.bottom <= mobileLayout.height), 'all game controls should remain visible inside the viewport');
  for (let i = 0; i < mobileLayout.controls.length; i += 1) {
    for (let j = i + 1; j < mobileLayout.controls.length; j += 1) {
      assert.ok(!overlaps(mobileLayout.controls[i], mobileLayout.controls[j]), `interactive controls ${i} and ${j} should not overlap`);
    }
  }
  assert.ok(mobileLayout.cells.every((cell) => mobileLayout.controls.every((control) => !overlaps(cell, control))), 'no touch target should overlap a game or HUD control');
  assert.ok(!overlaps(mobileLayout.board, mobileLayout.hud), 'the board should not overlap the HUD side rail');

  const adjacentPassivePair = await touchPage.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('#board-access [role="gridcell"]'));
    const passive = (cell) => cell.getAttribute('aria-disabled') === 'true';
    for (let index = 0; index < cells.length; index += 1) {
      const x = Number(cells[index].dataset.x);
      const y = Number(cells[index].dataset.y);
      const right = x < 6 ? index + 1 : -1;
      const below = y < 6 ? index + 7 : -1;
      if (right >= 0 && passive(cells[index]) && passive(cells[right])) {
        return { first: index, second: right, direction: 'horizontal' };
      }
      if (below >= 0 && passive(cells[index]) && passive(cells[below])) {
        return { first: index, second: below, direction: 'vertical' };
      }
    }
    return null;
  });
  assert.ok(adjacentPassivePair, 'Level 50 should provide adjacent empty/wall targets for a non-mutating accuracy test');
  const firstTarget = mobileLayout.cells[adjacentPassivePair.first];
  const secondTarget = mobileLayout.cells[adjacentPassivePair.second];
  const adjacentTapPoints = adjacentPassivePair.direction === 'horizontal'
    ? [
        { x: firstTarget.x + firstTarget.width - 2, y: firstTarget.y + firstTarget.height / 2 },
        { x: secondTarget.x + 2, y: secondTarget.y + secondTarget.height / 2 },
      ]
    : [
        { x: firstTarget.x + firstTarget.width / 2, y: firstTarget.y + firstTarget.height - 2 },
        { x: secondTarget.x + secondTarget.width / 2, y: secondTarget.y + 2 },
      ];
  for (const [offset, point] of adjacentTapPoints.entries()) {
    await touchPage.touchscreen.tap(point.x, point.y);
    assert.equal(
      Number(await touchPage.evaluate(() => document.activeElement?.getAttribute('data-cell-index'))),
      offset === 0 ? adjacentPassivePair.first : adjacentPassivePair.second,
      'a tap just inside either side of an adjacent-cell seam should select that exact cell',
    );
  }

  const beforeKeyboard = await touchPage.evaluate(() => {
    const active = document.activeElement;
    return { x: Number(active.dataset.x), y: Number(active.dataset.y) };
  });
  await touchPage.keyboard.press('ArrowRight');
  const afterKeyboard = await touchPage.evaluate(() => {
    const active = document.activeElement;
    return { x: Number(active.dataset.x), y: Number(active.dataset.y) };
  });
  assert.deepEqual(
    afterKeyboard,
    { x: Math.min(beforeKeyboard.x + 1, 6), y: beforeKeyboard.y },
    'compact-landscape keyboard navigation should remain unchanged',
  );
  await touchPage.keyboard.press('Home');
  assert.equal(Number(await touchPage.evaluate(() => document.activeElement?.getAttribute('data-x'))), 0, 'Home should select the first cell in the current row');
  await touchPage.keyboard.press('End');
  assert.equal(Number(await touchPage.evaluate(() => document.activeElement?.getAttribute('data-x'))), 6, 'End should select the last cell in the current row');
  await touchPage.keyboard.press('Control+Home');
  assert.deepEqual(
    await touchPage.evaluate(() => ({ x: Number(document.activeElement?.getAttribute('data-x')), y: Number(document.activeElement?.getAttribute('data-y')) })),
    { x: 0, y: 0 },
    'Ctrl+Home should select the first board cell',
  );
  await touchPage.keyboard.press('Control+End');
  assert.deepEqual(
    await touchPage.evaluate(() => ({ x: Number(document.activeElement?.getAttribute('data-x')), y: Number(document.activeElement?.getAttribute('data-y')) })),
    { x: 6, y: 6 },
    'Ctrl+End should select the last board cell',
  );
  await touchPage.keyboard.press('Tab');
  assert.equal(await touchPage.evaluate(() => document.activeElement?.id), 'btn-undo', 'Tab should leave the grid at the first 44px game control');

  const safeTouch = touchPage.locator('#board-access [role="gridcell"][aria-disabled="false"][aria-label*="Path is clear to the board edge"]').first();
  assert.ok(await safeTouch.count(), 'Level 50 should expose a safe arrow for touch');
  const arrowsBeforeTouch = Number(await touchPage.locator('#hud-left').textContent());
  await safeTouch.tap();
  await touchPage.waitForTimeout(120);
  const arrowsAfterTouch = Number(await touchPage.locator('#hud-left').textContent());
  assert.ok(arrowsAfterTouch < arrowsBeforeTouch, 'tapping a safe arrow should still fire it');
  for (const viewport of [
    { width: 390, height: 320 },
    { width: 568, height: 260 },
    { width: 568, height: 240 },
  ]) {
    await touchPage.setViewportSize(viewport);
    await touchPage.waitForTimeout(80);
    const constrainedLayout = await touchPage.evaluate(() => {
      const rect = (element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, bottom: bounds.bottom };
      };
      const cells = Array.from(document.querySelectorAll('#board-access [role="gridcell"]'), rect);
      const controls = ['#btn-menu', '#btn-hint', '#btn-undo', '#btn-retry', '#btn-play-levels'].map((id) =>
        rect(document.querySelector(id)),
      );
      return {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        cells,
        board: rect(document.querySelector('#board')),
        hud: rect(document.querySelector('.hud')),
        controls,
      };
    });
    assert.ok(constrainedLayout.cells.every((cell) => cell.width > 0 && cell.height > 0), 'constrained boards should keep usable cell targets');
    assert.ok(Math.min(...constrainedLayout.cells.map((cell) => cell.width)) < 44, 'narrow or short compact landscape should scale cells instead of forcing an overflow');
    assert.ok(constrainedLayout.controls.every((control) => control.width >= 44 && control.height >= 44), 'the side-rail controls should stay at least 44px in constrained layouts');
    assert.ok(
      constrainedLayout.scrollWidth <= viewport.width && constrainedLayout.scrollHeight <= viewport.height,
      `constrained compact landscape ${viewport.width}×${viewport.height} should not scroll (document ${constrainedLayout.scrollWidth}×${constrainedLayout.scrollHeight})`,
    );
    assert.ok(constrainedLayout.board.x >= 0 && constrainedLayout.board.x + constrainedLayout.board.width <= viewport.width && constrainedLayout.board.bottom <= viewport.height, 'the scaled board should remain within the viewport');
    assert.ok(constrainedLayout.controls.every((control) => control.x >= 0 && control.x + control.width <= viewport.width && control.y >= 0 && control.bottom <= viewport.height), 'constrained-layout controls should remain inside the viewport');
    for (let i = 0; i < constrainedLayout.controls.length; i += 1) {
      for (let j = i + 1; j < constrainedLayout.controls.length; j += 1) {
        assert.ok(!overlaps(constrainedLayout.controls[i], constrainedLayout.controls[j]), 'constrained-layout controls should not overlap');
      }
    }
    assert.ok(!overlaps(constrainedLayout.board, constrainedLayout.hud), 'the scaled board should remain separate from the HUD');
    assert.ok(constrainedLayout.cells.every((cell) => constrainedLayout.controls.every((control) => !overlaps(cell, control))), 'scaled cell targets should not overlap controls');
    for (let i = 0; i < constrainedLayout.cells.length; i += 1) {
      for (let j = i + 1; j < constrainedLayout.cells.length; j += 1) {
        assert.ok(!overlaps(constrainedLayout.cells[i], constrainedLayout.cells[j]), 'scaled neighboring cells should remain non-overlapping');
      }
    }
  }
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 640 },
  ]) {
    await touchPage.setViewportSize(viewport);
    await touchPage.waitForTimeout(80);
    await touchPage.locator('#btn-retry').tap();
    if (await touchPage.locator('#overlay-puzzle-confirm').isVisible()) {
      await touchPage.locator('#btn-puzzle-confirm').tap();
      await touchPage.locator('#overlay-puzzle-confirm').waitFor({ state: 'hidden' });
    }
    await touchPage.waitForTimeout(80);
    await scan(touchPage, `portrait ${viewport.width}×${viewport.height} (Level 50 touch board)`);

    const portraitLayout = await touchPage.evaluate(() => {
      const rect = (element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, bottom: bounds.bottom };
      };
      const cells = Array.from(document.querySelectorAll('#board-access [role="gridcell"]'), rect);
      const controls = ['#btn-menu', '#btn-hint', '#btn-undo', '#btn-retry', '#btn-play-levels'].map((id) =>
        rect(document.querySelector(id)),
      );
      return {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        cellWidth: Math.min(...cells.map((cell) => cell.width)),
        cellHeight: Math.min(...cells.map((cell) => cell.height)),
        cells,
        board: rect(document.querySelector('#board')),
        hud: rect(document.querySelector('.hud')),
        controls,
      };
    });
    assert.equal(portraitLayout.cells.length, 49, 'portrait Level 50 should expose all 49 touch targets');
    assert.ok(
      portraitLayout.cellWidth >= 44 && portraitLayout.cellHeight >= 44,
      `${viewport.width}×${viewport.height} portrait should provide at least 44px square Level 50 cells`,
    );
    assert.ok(
      portraitLayout.controls.every((control) => control.width >= 44 && control.height >= 44),
      `${viewport.width}×${viewport.height} portrait game controls should be at least 44px`,
    );
    assert.ok(
      portraitLayout.cells.every((cell) =>
        Math.abs(cell.width - portraitLayout.board.width / 7) < 0.1 &&
        Math.abs(cell.height - portraitLayout.board.height / 7) < 0.1,
      ),
      'each portrait hit target should map to exactly one visible board cell',
    );
    assert.ok(
      portraitLayout.scrollWidth <= viewport.width && portraitLayout.scrollHeight <= viewport.height,
      `${viewport.width}×${viewport.height} portrait should not scroll`,
    );
    assert.ok(
      portraitLayout.board.x >= 0 && portraitLayout.board.x + portraitLayout.board.width <= viewport.width && portraitLayout.board.bottom <= viewport.height,
      'portrait board should remain inside the viewport',
    );
    assert.ok(portraitLayout.hud.bottom <= viewport.height, 'portrait HUD should remain inside the viewport');
    assert.ok(
      portraitLayout.controls.every((control) =>
        control.x >= 0 && control.x + control.width <= viewport.width && control.y >= 0 && control.bottom <= viewport.height,
      ),
      'portrait controls should remain inside the viewport',
    );
    for (let i = 0; i < portraitLayout.cells.length; i += 1) {
      for (let j = i + 1; j < portraitLayout.cells.length; j += 1) {
        assert.ok(!overlaps(portraitLayout.cells[i], portraitLayout.cells[j]), 'portrait neighboring cells should not overlap');
      }
      for (const control of portraitLayout.controls) {
        assert.ok(!overlaps(portraitLayout.cells[i], control), 'portrait cell targets should not overlap game controls');
      }
    }
    for (let i = 0; i < portraitLayout.controls.length; i += 1) {
      for (let j = i + 1; j < portraitLayout.controls.length; j += 1) {
        assert.ok(!overlaps(portraitLayout.controls[i], portraitLayout.controls[j]), 'portrait interactive controls should not overlap');
      }
    }
    assert.ok(!overlaps(portraitLayout.board, portraitLayout.hud), 'portrait board should not overlap the HUD');

    const adjacentPortraitPair = await touchPage.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('#board-access [role="gridcell"]'));
      const passive = (cell) => cell.getAttribute('aria-disabled') === 'true';
      for (let index = 0; index < cells.length; index += 1) {
        const x = Number(cells[index].dataset.x);
        const y = Number(cells[index].dataset.y);
        const right = x < 6 ? index + 1 : -1;
        const below = y < 6 ? index + 7 : -1;
        if (right >= 0 && passive(cells[index]) && passive(cells[right])) {
          return { first: index, second: right, direction: 'horizontal' };
        }
        if (below >= 0 && passive(cells[index]) && passive(cells[below])) {
          return { first: index, second: below, direction: 'vertical' };
        }
      }
      return null;
    });
    assert.ok(adjacentPortraitPair, 'portrait Level 50 should provide adjacent empty/wall targets for an accuracy check');
    const firstPortraitTarget = portraitLayout.cells[adjacentPortraitPair.first];
    const secondPortraitTarget = portraitLayout.cells[adjacentPortraitPair.second];
    const portraitTapPoints = adjacentPortraitPair.direction === 'horizontal'
      ? [
          { x: firstPortraitTarget.x + firstPortraitTarget.width - 2, y: firstPortraitTarget.y + firstPortraitTarget.height / 2 },
          { x: secondPortraitTarget.x + 2, y: secondPortraitTarget.y + secondPortraitTarget.height / 2 },
        ]
      : [
          { x: firstPortraitTarget.x + firstPortraitTarget.width / 2, y: firstPortraitTarget.y + firstPortraitTarget.height - 2 },
          { x: secondPortraitTarget.x + secondPortraitTarget.width / 2, y: secondPortraitTarget.y + 2 },
        ];
    for (const [offset, point] of portraitTapPoints.entries()) {
      await touchPage.touchscreen.tap(point.x, point.y);
      assert.equal(
        Number(await touchPage.evaluate(() => document.activeElement?.getAttribute('data-cell-index'))),
        offset === 0 ? adjacentPortraitPair.first : adjacentPortraitPair.second,
        'portrait seam taps should select the exact adjacent cell',
      );
    }

    const beforePortraitKeyboard = await touchPage.evaluate(() => ({
      x: Number(document.activeElement.dataset.x),
      y: Number(document.activeElement.dataset.y),
    }));
    await touchPage.keyboard.press('ArrowRight');
    assert.deepEqual(
      await touchPage.evaluate(() => ({ x: Number(document.activeElement.dataset.x), y: Number(document.activeElement.dataset.y) })),
      { x: Math.min(beforePortraitKeyboard.x + 1, 6), y: beforePortraitKeyboard.y },
      'portrait arrow-key navigation should match cell selection',
    );
    await touchPage.keyboard.press('Home');
    assert.equal(Number(await touchPage.evaluate(() => document.activeElement?.getAttribute('data-x'))), 0);
    await touchPage.keyboard.press('End');
    assert.equal(Number(await touchPage.evaluate(() => document.activeElement?.getAttribute('data-x'))), 6);
    await touchPage.keyboard.press('Control+Home');
    assert.deepEqual(
      await touchPage.evaluate(() => ({ x: Number(document.activeElement?.getAttribute('data-x')), y: Number(document.activeElement?.getAttribute('data-y')) })),
      { x: 0, y: 0 },
    );
    await touchPage.keyboard.press('Control+End');
    assert.deepEqual(
      await touchPage.evaluate(() => ({ x: Number(document.activeElement?.getAttribute('data-x')), y: Number(document.activeElement?.getAttribute('data-y')) })),
      { x: 6, y: 6 },
    );
    await touchPage.keyboard.press('Tab');
    assert.equal(await touchPage.evaluate(() => document.activeElement?.id), 'btn-undo', 'portrait Tab should reach the first game control');

    const safePortraitArrow = touchPage.locator('#board-access [role="gridcell"][aria-disabled="false"][aria-label*="Path is clear to the board edge"]').first();
    assert.ok(await safePortraitArrow.count(), 'portrait Level 50 should retain a safe arrow for keyboard firing');
    const arrowsBeforePortraitFire = Number(await touchPage.locator('#hud-left').textContent());
    await safePortraitArrow.focus();
    await touchPage.keyboard.press(viewport.width === 320 ? 'Enter' : 'Space');
    await touchPage.waitForTimeout(120);
    const arrowsAfterPortraitFire = Number(await touchPage.locator('#hud-left').textContent());
    assert.ok(arrowsAfterPortraitFire < arrowsBeforePortraitFire, 'portrait Enter/Space should fire the selected safe arrow');
    console.log(
      `PASS portrait ${viewport.width}×${viewport.height}: ${portraitLayout.cellWidth.toFixed(1)}px cells; 44px controls, adjacent-cell accuracy, no overlap/scroll, keyboard parity`,
    );
  }
  console.log(`PASS compact landscape touch flow: ${mobileLayout.cellWidth.toFixed(1)}px cells; 44px controls, adjacent-cell accuracy, responsive no-overlap/scroll, touch, and keyboard fit`);
  await touchContext.close();

  const finalCampaignContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  });
  const finalCampaignPage = await finalCampaignContext.newPage();
  const finalDailyKey = '2030-01-01';
  const originalFinalSettings = { muted: true, adsRemoved: false };
  const originalFinalDailyRecord = {
    completed: true,
    levelId: 12,
    finishedAt: '2030-01-01T08:00:00.000Z',
  };
  await finalCampaignPage.addInitScript(({ settings, dailyKey, dailyRecord }) => {
    localStorage.setItem(
      'arrowpath:v1:progress',
      JSON.stringify({ unlocked: 50, cleared: Array.from({ length: 49 }, (_, i) => i + 1) }),
    );
    localStorage.setItem('arrowpath:v1:onboarded', JSON.stringify({ ok: true }));
    localStorage.setItem('arrowpath:v1:settings', JSON.stringify(settings));
    localStorage.setItem(`arrowpath:v1:daily:${dailyKey}`, JSON.stringify(dailyRecord));
  }, {
    settings: originalFinalSettings,
    dailyKey: finalDailyKey,
    dailyRecord: originalFinalDailyRecord,
  });
  await finalCampaignPage.goto(baseUrl, { waitUntil: 'networkidle' });
  await finalCampaignPage.locator('#btn-play').tap();
  await finalCampaignPage.locator('#hud-level').waitFor();
  assert.equal(await finalCampaignPage.locator('#hud-level').textContent(), '50');

  let finalLevelArrowsFired = 0;
  for (; finalLevelArrowsFired < 49; finalLevelArrowsFired += 1) {
    if (await finalCampaignPage.locator('#overlay-win').isVisible()) break;
    const safeFinalArrow = finalCampaignPage.locator(
      '#board-access [role="gridcell"][aria-disabled="false"][aria-label*="Path is clear to the board edge"]',
    ).first();
    await safeFinalArrow.waitFor({ timeout: 5000 });
    await safeFinalArrow.tap();
    await finalCampaignPage.waitForTimeout(120);
  }
  await finalCampaignPage.locator('#overlay-win:not([hidden])').waitFor({ timeout: 5000 });
  assert.ok(finalLevelArrowsFired > 0, 'the final campaign level should be completed through safe player moves');
  assert.equal(await finalCampaignPage.locator('#btn-next').textContent(), 'Back to home');
  assert.equal(await finalCampaignPage.evaluate(() => document.activeElement?.id), 'btn-next');
  await scan(finalCampaignPage, 'final campaign completion dialog');

  const stateAfterFinalClear = await finalCampaignPage.evaluate((dailyKey) => ({
    progress: JSON.parse(localStorage.getItem('arrowpath:v1:progress')),
    settings: JSON.parse(localStorage.getItem('arrowpath:v1:settings')),
    dailyRecord: JSON.parse(localStorage.getItem(`arrowpath:v1:daily:${dailyKey}`)),
    activePuzzle: localStorage.getItem('arrowpath:v1:active-puzzle'),
  }), finalDailyKey);
  assert.deepEqual(stateAfterFinalClear.progress, {
    unlocked: 50,
    cleared: Array.from({ length: 50 }, (_, i) => i + 1),
  }, 'finishing the final level should record the clear without changing the unlock ceiling');
  assert.deepEqual(stateAfterFinalClear.settings, originalFinalSettings);
  assert.deepEqual(stateAfterFinalClear.dailyRecord, originalFinalDailyRecord);
  assert.equal(stateAfterFinalClear.activePuzzle, null, 'a won puzzle should no longer remain an active run');

  await finalCampaignPage.locator('#btn-next').tap();
  await finalCampaignPage.locator('[data-screen="home"]:not([hidden])').waitFor();
  assert.equal(await finalCampaignPage.evaluate(() => document.activeElement?.id), 'btn-play');
  const stateAfterHomeReturn = await finalCampaignPage.evaluate((dailyKey) => ({
    progress: JSON.parse(localStorage.getItem('arrowpath:v1:progress')),
    settings: JSON.parse(localStorage.getItem('arrowpath:v1:settings')),
    dailyRecord: JSON.parse(localStorage.getItem(`arrowpath:v1:daily:${dailyKey}`)),
    activePuzzle: localStorage.getItem('arrowpath:v1:active-puzzle'),
  }), finalDailyKey);
  assert.deepEqual(stateAfterHomeReturn, stateAfterFinalClear, 'the Home action should not alter the newly saved campaign state');
  console.log('PASS final campaign completion: Back to home, return focus, and progress/settings/daily state preserved');
  await finalCampaignContext.close();

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
