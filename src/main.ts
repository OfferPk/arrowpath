import './style.css';
import { Engine, traceFire } from './game/engine';
import { loadLevels, getLevel, type LevelPack } from './game/levels';
import { dailyKeyKarachi, dailyLevelId } from './game/daily';
import {
  getProgress,
  markLevelCleared,
  getSettings,
  setSettings,
  isOnboarded,
  setOnboarded,
  getDailyRecord,
  saveDailyRecord,
} from './game/persist';
import {
  showInterstitial,
  showRewarded,
  isAdsRemoved,
  purchaseRemoveAds,
} from './ads/stubs';
import { completeLevelWithoutWaitingForAd } from './game/completion';
import { drawBoard, resizeCanvas } from './ui/canvas';
import { describeBoard, describeBoardCell } from './ui/accessibility';
import { manageDialogKeydown } from './ui/dialog';
import type { GameState, LevelDef } from './game/types';

type PlayMode = 'campaign' | 'daily';

let pack: LevelPack | null = null;
let engine: Engine | null = null;
let currentId = 1;
let playMode: PlayMode = 'campaign';
let dailyKey: string | null = null;
let cellSize = 40;
let hintCell: { x: number; y: number } | null = null;
let flashPath: { x: number; y: number }[] | null = null;
let activeCellIndex = 0;
let muted = getSettings().muted;
let rewardAction: 'hint' | 'undo' | null = null;
let dialogReturnFocus: HTMLElement | null = null;
let suspendedDialog: HTMLElement | null = null;
let suspendedDialogFocus: HTMLElement | null = null;
let rewardAttempt = 0;
let toastTimer = 0;

const board = document.getElementById('board') as HTMLCanvasElement;
const boardAccess = document.getElementById('board-access') as HTMLDivElement;
const boardAnnouncement = document.getElementById('board-announcement') as HTMLParagraphElement;
const failEl = document.getElementById('overlay-fail')!;
const winEl = document.getElementById('overlay-win')!;
const rewardEl = document.getElementById('overlay-reward')!;
const toastEl = document.getElementById('toast')!;

function showScreen(name: string): void {
  document.querySelectorAll<HTMLElement>('.screen').forEach((el) => {
    el.hidden = el.dataset.screen !== name;
  });
  const a2hs = document.getElementById('a2hs');
  if (a2hs) a2hs.hidden = name !== 'home' || sessionStorage.getItem('arrowpath:a2hs') === '1';
}

function state() {
  return engine!.getState();
}

function vibrate(ms: number): void {
  if (muted) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}

function showToast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 1800);
}

function updateHome(): void {
  const p = getProgress();
  const total = pack?.levels.length ?? 50;
  const cleared = p.cleared.length;
  document.getElementById('home-progress')!.textContent =
    `${cleared} cleared · unlocked ${p.unlocked}/${total}`;

  const playBtn = document.getElementById('btn-play')!;
  playBtn.textContent =
    p.unlocked > 1 || p.cleared.length > 0 ? 'Continue' : 'Play';

  const key = dailyKeyKarachi();
  const rec = getDailyRecord(key);
  const meta = document.getElementById('home-daily-meta')!;
  meta.textContent = rec?.completed
    ? `Daily ${key} ✓ completed`
    : `Daily ${key} ready`;
}

function updateSettingsUi(): void {
  const muteBtn = document.getElementById('btn-mute')!;
  muteBtn.textContent = muted ? '🔇 Sound off' : '🔊 Sound on';
  const ads = document.getElementById('ads-status')!;
  ads.textContent = isAdsRemoved()
    ? 'Ads: removed (local stub flag)'
    : 'Ads: enabled (placeholder — no real SDK)';
}

function updateHud(): void {
  if (!engine) return;
  const s = state();
  const label =
    playMode === 'daily' ? `D${s.levelId}` : String(s.levelId);
  document.getElementById('play-title')!.textContent =
    playMode === 'daily' ? `Daily challenge ${label}` : `Level ${label}`;
  document.getElementById('hud-level')!.textContent = label;
  document.getElementById('hud-left')!.textContent = String(s.arrowsRemaining);
  document.getElementById('hud-undos')!.textContent = String(s.undosLeft);
}

function layout(): void {
  if (!engine) return;
  const s = state();
  const wrap = board.parentElement!;
  const css = Math.max(
    0,
    Math.floor(Math.min(wrap.clientWidth, window.innerHeight * 0.55)),
  );
  const { cell } = resizeCanvas(board, css || 320, s.w, s.h);
  cellSize = cell;
  boardAccess.style.width = board.style.width;
  boardAccess.style.height = board.style.height;
  render();
}

function setActiveCell(index: number, focus = true): void {
  activeCellIndex = index;
  boardAccess.querySelectorAll<HTMLButtonElement>('.board-cell').forEach((button, i) => {
    const active = i === index;
    button.tabIndex = active ? 0 : -1;
    button.setAttribute('aria-selected', String(active));
  });
  if (focus) {
    boardAccess.querySelector<HTMLButtonElement>(`[data-cell-index="${index}"]`)
      ?.focus({ preventScroll: true });
  }
}

function renderAccessibleBoard(s: GameState): void {
  const restoreFocus = boardAccess.contains(document.activeElement);
  activeCellIndex = Math.max(0, Math.min(activeCellIndex, s.cells.length - 1));
  boardAccess.setAttribute('aria-label', describeBoard(s));
  boardAccess.style.setProperty('--board-cols', String(s.w));

  const fragment = document.createDocumentFragment();
  for (let y = 0; y < s.h; y++) {
    const row = document.createElement('div');
    row.className = 'board-row';
    row.setAttribute('role', 'row');
    for (let x = 0; x < s.w; x++) {
      const index = y * s.w + x;
      const cell = s.cells[index]!;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'board-cell';
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', describeBoardCell(s, x, y));
      button.setAttribute('aria-rowindex', String(y + 1));
      button.setAttribute('aria-colindex', String(x + 1));
      button.setAttribute('aria-selected', String(index === activeCellIndex));
      button.setAttribute(
        'aria-disabled',
        String(cell.kind !== 'arrow' || s.status !== 'playing'),
      );
      button.dataset.cellIndex = String(index);
      button.dataset.x = String(x);
      button.dataset.y = String(y);
      button.tabIndex = index === activeCellIndex ? 0 : -1;
      row.appendChild(button);
    }
    fragment.appendChild(row);
  }
  boardAccess.replaceChildren(fragment);
  if (restoreFocus) {
    boardAccess.querySelector<HTMLButtonElement>(`[data-cell-index="${activeCellIndex}"]`)
      ?.focus({ preventScroll: true });
  }
}

function announceBoard(message: string): void {
  boardAnnouncement.textContent = message;
}

function render(): void {
  if (!engine) return;
  const s = state();
  const ctx = board.getContext('2d')!;
  drawBoard(ctx, s, cellSize, {
    hint: hintCell,
    flashPath,
    failFlash: s.status === 'failed',
  });
  renderAccessibleBoard(s);
  updateHud();
}

function hideOverlays(): void {
  rewardAttempt += 1;
  rewardAction = null;
  failEl.hidden = true;
  winEl.hidden = true;
  rewardEl.hidden = true;
  dialogReturnFocus = null;
  suspendedDialog = null;
  suspendedDialogFocus = null;
}

function activeDialog(): HTMLElement | null {
  return [rewardEl, failEl, winEl].find((dialog) => !dialog.hidden) ?? null;
}

function overlayFocusTarget(): HTMLElement | null {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    active.isConnected &&
    !active.closest('[hidden]')
  ) {
    return active;
  }
  const playScreen = document.querySelector<HTMLElement>('[data-screen="play"]');
  if (playScreen && !playScreen.hidden) {
    return boardAccess.querySelector<HTMLButtonElement>(
      `[data-cell-index="${activeCellIndex}"]`,
    );
  }
  return document.getElementById('btn-play');
}

function restoreDialogFocus(target: HTMLElement | null): void {
  if (target?.isConnected && !target.closest('[hidden]')) {
    target.focus({ preventScroll: true });
    return;
  }
  const playScreen = document.querySelector<HTMLElement>('[data-screen="play"]');
  if (playScreen && !playScreen.hidden) {
    boardAccess.querySelector<HTMLButtonElement>(
      `[data-cell-index="${activeCellIndex}"]`,
    )?.focus({ preventScroll: true });
    return;
  }
  document.getElementById('btn-play')?.focus({ preventScroll: true });
}

function showDialog(dialog: HTMLElement, initialFocusId: string): void {
  const previous = activeDialog();
  const returnFocus = overlayFocusTarget();
  if (previous && previous !== dialog) {
    suspendedDialog = previous;
    suspendedDialogFocus = returnFocus;
    previous.hidden = true;
  } else {
    suspendedDialog = null;
    suspendedDialogFocus = null;
  }
  dialogReturnFocus = returnFocus;
  dialog.hidden = false;
  const initialFocus = document.getElementById(initialFocusId);
  if (initialFocus instanceof HTMLElement) {
    initialFocus.focus({ preventScroll: true });
  } else {
    dialog.focus({ preventScroll: true });
  }
}

function closeActiveDialog(restoreFocus = true): void {
  const dialog = activeDialog();
  if (!dialog) return;
  dialog.hidden = true;

  if (dialog === rewardEl && suspendedDialog) {
    const parent = suspendedDialog;
    const parentFocus = suspendedDialogFocus;
    suspendedDialog = null;
    suspendedDialogFocus = null;
    dialogReturnFocus = null;
    parent.hidden = false;
    if (restoreFocus) restoreDialogFocus(parentFocus);
    return;
  }

  const returnFocus = dialogReturnFocus;
  dialogReturnFocus = null;
  suspendedDialog = null;
  suspendedDialogFocus = null;
  if (restoreFocus) restoreDialogFocus(returnFocus);
}

function focusFirstLevel(): void {
  document.querySelector<HTMLButtonElement>('#level-grid button:not(:disabled)')
    ?.focus({ preventScroll: true });
}

function configureWinOverlay(): void {
  const nextBtn = document.getElementById('btn-next') as HTMLButtonElement;
  const winMeta = document.getElementById('win-meta')!;
  if (playMode === 'daily') {
    nextBtn.textContent = 'Continue campaign';
    winMeta.textContent = dailyKey
      ? `Daily ${dailyKey} cleared. Nice neon run.`
      : 'Daily cleared. Nice neon run.';
  } else {
    nextBtn.textContent = 'Next level';
    winMeta.textContent = 'Neon line clear. Next station?';
  }
}

async function startLevel(
  id: number,
  mode: PlayMode = 'campaign',
  key: string | null = null,
): Promise<void> {
  if (!pack) return;
  const level = getLevel(pack, id);
  if (!level) return;
  if (mode === 'campaign') {
    const progress = getProgress();
    if (id > progress.unlocked) return;
  }
  playMode = mode;
  dailyKey = mode === 'daily' ? key : null;
  currentId = id;
  engine = new Engine(level);
  activeCellIndex = Math.max(
    0,
    engine.getState().cells.findIndex((cell) => cell.kind === 'arrow'),
  );
  hintCell = null;
  flashPath = null;
  hideOverlays();
  showScreen('play');
  layout();
  render();
  announceBoard('');
  boardAccess.querySelector<HTMLButtonElement>(`[data-cell-index="${activeCellIndex}"]`)
    ?.focus({ preventScroll: true });
}

function startDaily(): void {
  if (!pack) return;
  const key = dailyKeyKarachi();
  const total = pack.levels.length;
  const levelId = dailyLevelId(key, total);
  const rec = getDailyRecord(key);
  if (rec?.completed) {
    updateHome();
    showToast('Daily already done — Continue campaign');
    return;
  }
  // Persist chosen levelId early so re-entry is stable even mid-attempt
  saveDailyRecord(key, { completed: false, levelId });
  void startLevel(levelId, 'daily', key);
}

function onFail(reason: string): void {
  vibrate(40);
  const el = document.getElementById('fail-reason')!;
  el.textContent = reason === 'wall' ? 'Hit a wall.' : 'Hit another arrow.';
  showDialog(failEl, 'btn-fail-retry');
  void showInterstitial('fail');
}

function onWin(): void {
  vibrate(25);
  if (playMode === 'daily' && dailyKey) {
    saveDailyRecord(dailyKey, {
      completed: true,
      levelId: currentId,
      finishedAt: new Date().toISOString(),
    });
  } else {
    const total = pack!.levels.length;
    markLevelCleared(currentId, total);
  }
  updateHome();
  configureWinOverlay();
  completeLevelWithoutWaitingForAd(
    () => {
      showDialog(winEl, 'btn-next');
    },
    showInterstitial,
    playMode === 'daily' ? 'daily-complete' : 'level-complete',
  );
}

function shareWin(): void {
  const text =
    playMode === 'daily' && dailyKey
      ? `ArrowPath — cleared Daily ${dailyKey} level ${currentId} (neon metro)`
      : `ArrowPath — cleared level ${currentId} (neon metro)`;
  if (navigator.share) {
    void navigator.share({ title: 'ArrowPath', text }).catch(() => {
      copyShare(text);
    });
    return;
  }
  copyShare(text);
}

function copyShare(text: string): void {
  const done = () => showToast('Copied share text');
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).then(done).catch(() => {
      legacyCopy(text);
      done();
    });
    return;
  }
  legacyCopy(text);
  done();
}

function legacyCopy(text: string): void {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch {
    /* ignore */
  }
}

function tryFire(x: number, y: number): void {
  if (!engine) return;
  const s = state();
  if (s.status !== 'playing') return;
  const cell = s.cells[y * s.w + x];
  if (!cell || cell.kind !== 'arrow') return;

  const traced = traceFire(s, x, y);
  flashPath = traced.path;
  render();
  window.setTimeout(() => {
    flashPath = null;
    const result = engine!.fire(x, y);
    hintCell = null;
    render();
    if (!result.ok) {
      if (result.reason === 'collision' || result.reason === 'wall') {
        const blocker = result.reason === 'wall' ? 'a wall' : 'another arrow';
        announceBoard(`Arrow at row ${y + 1}, column ${x + 1} failed: its path hit ${blocker}.`);
        onFail(result.reason);
      }
      return;
    }
    if (result.won) {
      announceBoard('Board cleared. All arrows have left the board.');
      void onWin();
    } else {
      const remaining = result.state.arrowsRemaining;
      const arrowWord = remaining === 1 ? 'arrow' : 'arrows';
      const remainVerb = remaining === 1 ? 'remains' : 'remain';
      announceBoard(`Arrow at row ${y + 1}, column ${x + 1} cleared. ${remaining} ${arrowWord} ${remainVerb}.`);
      vibrate(12);
    }
  }, 90);
}

function doRetry(): void {
  if (!engine) return;
  hideOverlays();
  engine.restart();
  hintCell = null;
  flashPath = null;
  render();
  boardAccess.querySelector<HTMLButtonElement>(`[data-cell-index="${activeCellIndex}"]`)
    ?.focus({ preventScroll: true });
  announceBoard(describeBoard(state()));
  void showInterstitial('retry');
}

function tryUndo(): void {
  if (!engine) return;
  if (!engine.canUndo()) return;
  const s = state();
  if (s.undosLeft > 0) {
    engine.undo(false);
    hideOverlays();
    hintCell = null;
    render();
    boardAccess.querySelector<HTMLButtonElement>(`[data-cell-index="${activeCellIndex}"]`)
      ?.focus({ preventScroll: true });
    announceBoard(describeBoard(state()));
    return;
  }
  rewardAction = 'undo';
  document.getElementById('reward-title')!.textContent = 'Extra undo';
  document.getElementById('reward-body')!.textContent =
    'Free undos used. Watch a placeholder ad for one more undo.';
  showDialog(rewardEl, 'btn-reward-ok');
}

function tryHint(): void {
  if (!engine) return;
  if (state().status !== 'playing') return;
  rewardAction = 'hint';
  document.getElementById('reward-title')!.textContent = 'Hint';
  document.getElementById('reward-body')!.textContent =
    'Watch a placeholder rewarded ad to highlight a safe arrow.';
  showDialog(rewardEl, 'btn-reward-ok');
}

async function confirmReward(): Promise<void> {
  const action = rewardAction;
  if (!action) return;
  const attempt = ++rewardAttempt;
  const ok = await showRewarded(action);
  if (attempt !== rewardAttempt || rewardAction !== action) return;
  rewardAction = null;
  if (!ok || !engine) {
    closeActiveDialog();
    showToast('Reward was not available.');
    return;
  }
  if (action === 'hint') {
    closeActiveDialog();
    hintCell = engine.hint();
    render();
    announceBoard(
      hintCell
        ? `Hint: ${describeBoardCell(state(), hintCell.x, hintCell.y)}`
        : 'No safe arrow is available for a hint.',
    );
  } else if (action === 'undo') {
    engine.undo(true);
    hideOverlays();
    hintCell = null;
    render();
    announceBoard(describeBoard(state()));
  }
}

function cancelReward(): void {
  rewardAttempt += 1;
  rewardAction = null;
  closeActiveDialog();
}

function buildLevelSelect(): void {
  if (!pack) return;
  const grid = document.getElementById('level-grid')!;
  grid.innerHTML = '';
  const progress = getProgress();
  for (const level of pack.levels) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'level-btn';
    btn.textContent = String(level.id);
    const locked = level.id > progress.unlocked;
    if (locked) btn.classList.add('locked');
    if (progress.cleared.includes(level.id)) btn.classList.add('cleared');
    if (level.id === currentId && playMode === 'campaign') {
      btn.classList.add('current');
    }
    btn.disabled = locked;
    btn.addEventListener('click', () => {
      void startLevel(level.id, 'campaign');
    });
    grid.appendChild(btn);
  }
}

function wire(): void {
  document.getElementById('btn-play')!.addEventListener('click', () => {
    const p = getProgress();
    void startLevel(Math.min(p.unlocked, pack!.levels.length), 'campaign');
  });
  document.getElementById('btn-daily')!.addEventListener('click', () => {
    startDaily();
  });
  document.getElementById('btn-levels')!.addEventListener('click', () => {
    buildLevelSelect();
    showScreen('levels');
  });
  document.getElementById('btn-howto')!.addEventListener('click', () =>
    showScreen('howto'),
  );
  document.getElementById('btn-howto-ok')!.addEventListener('click', () => {
    setOnboarded();
    updateHome();
    showScreen('home');
  });
  document.getElementById('btn-settings')!.addEventListener('click', () => {
    updateSettingsUi();
    showScreen('settings');
  });
  document
    .getElementById('btn-settings-back')!
    .addEventListener('click', () => {
      updateHome();
      showScreen('home');
    });
  document
    .getElementById('btn-levels-back')!
    .addEventListener('click', () => {
      updateHome();
      showScreen('home');
    });
  document.getElementById('btn-mute')!.addEventListener('click', () => {
    muted = !muted;
    setSettings({ muted });
    updateSettingsUi();
  });
  document.getElementById('btn-remove-ads')!.addEventListener('click', async () => {
    await purchaseRemoveAds();
    updateSettingsUi();
  });

  document.getElementById('btn-menu')!.addEventListener('click', () => {
    hideOverlays();
    updateHome();
    showScreen('home');
    document.getElementById('btn-play')?.focus({ preventScroll: true });
  });
  document.getElementById('btn-hint')!.addEventListener('click', () => tryHint());
  document.getElementById('btn-undo')!.addEventListener('click', () => tryUndo());
  document.getElementById('btn-retry')!.addEventListener('click', () => doRetry());
  document.getElementById('btn-play-levels')!.addEventListener('click', () => {
    hideOverlays();
    buildLevelSelect();
    showScreen('levels');
    focusFirstLevel();
  });

  document.getElementById('btn-fail-retry')!.addEventListener('click', () => doRetry());
  document.getElementById('btn-fail-undo')!.addEventListener('click', () => tryUndo());
  document.getElementById('btn-fail-home')!.addEventListener('click', () => {
    hideOverlays();
    updateHome();
    showScreen('home');
    document.getElementById('btn-play')?.focus({ preventScroll: true });
  });

  document.getElementById('btn-next')!.addEventListener('click', () => {
    if (playMode === 'daily') {
      hideOverlays();
      updateHome();
      const p = getProgress();
      void startLevel(Math.min(p.unlocked, pack!.levels.length), 'campaign');
      return;
    }
    const next = currentId + 1;
    if (pack && next <= pack.levels.length) {
      void startLevel(next, 'campaign');
    } else {
      hideOverlays();
      updateHome();
      showScreen('home');
      document.getElementById('btn-play')?.focus({ preventScroll: true });
    }
  });
  document.getElementById('btn-share')!.addEventListener('click', () => shareWin());
  document.getElementById('btn-win-levels')!.addEventListener('click', () => {
    hideOverlays();
    buildLevelSelect();
    showScreen('levels');
    focusFirstLevel();
  });
  document.getElementById('btn-win-home')!.addEventListener('click', () => {
    hideOverlays();
    updateHome();
    showScreen('home');
    document.getElementById('btn-play')?.focus({ preventScroll: true });
  });

  document.getElementById('btn-reward-ok')!.addEventListener('click', () => {
    void confirmReward();
  });
  document.getElementById('btn-reward-cancel')!.addEventListener('click', () => {
    cancelReward();
  });

  document.addEventListener('keydown', (event) => {
    const dialog = activeDialog();
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.closest('[hidden]'));
    const result = manageDialogKeydown(
      event,
      focusable,
      document.activeElement instanceof HTMLElement ? document.activeElement : null,
    );
    if (result === 'dismiss') {
      if (dialog === rewardEl) {
        rewardAttempt += 1;
        rewardAction = null;
      }
      closeActiveDialog();
    } else if (result === 'trapped' && focusable.length === 0) {
      dialog.focus({ preventScroll: true });
    }
  });

  boardAccess.addEventListener('click', (ev) => {
    const button = (ev.target as HTMLElement).closest<HTMLButtonElement>('.board-cell');
    if (!button || button.getAttribute('aria-disabled') === 'true') return;
    tryFire(Number(button.dataset.x), Number(button.dataset.y));
  });
  boardAccess.addEventListener('focusin', (ev) => {
    const button = (ev.target as HTMLElement).closest<HTMLButtonElement>('.board-cell');
    if (button) setActiveCell(Number(button.dataset.cellIndex), false);
  });
  boardAccess.addEventListener('keydown', (ev) => {
    const button = (ev.target as HTMLElement).closest<HTMLButtonElement>('.board-cell');
    if (!button || !engine) return;
    const s = state();
    const x = Number(button.dataset.x);
    const y = Number(button.dataset.y);
    let nextX = x;
    let nextY = y;
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Home') {
      nextX = 0;
      nextY = 0;
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'End') {
      nextX = s.w - 1;
      nextY = s.h - 1;
    } else if (ev.key === 'ArrowLeft') {
      nextX = Math.max(0, x - 1);
    } else if (ev.key === 'ArrowRight') {
      nextX = Math.min(s.w - 1, x + 1);
    } else if (ev.key === 'ArrowUp') {
      nextY = Math.max(0, y - 1);
    } else if (ev.key === 'ArrowDown') {
      nextY = Math.min(s.h - 1, y + 1);
    } else if (ev.key === 'Home') {
      nextX = 0;
    } else if (ev.key === 'End') {
      nextX = s.w - 1;
    } else {
      return;
    }
    ev.preventDefault();
    setActiveCell(nextY * s.w + nextX);
  });

  window.addEventListener('resize', () => layout());

  document.getElementById('a2hs-ok')?.addEventListener('click', () => {
    sessionStorage.setItem('arrowpath:a2hs', '1');
    document.getElementById('a2hs')!.hidden = true;
  });
}

async function boot(): Promise<void> {
  pack = await loadLevels();
  wire();
  updateHome();
  updateSettingsUi();
  if (!isOnboarded()) {
    showScreen('howto');
  } else {
    showScreen('home');
  }
}

void boot();

export type { LevelDef };
