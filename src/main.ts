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
  clearActivePuzzle,
  clearPuzzleForMode,
  loadActivePuzzle,
  loadPuzzleForMode,
  saveActivePuzzle,
  type ActivePuzzleSnapshot,
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
import { describeRestoredRunStatus } from './ui/resume-status';
import { manageDialogKeydown } from './ui/dialog';
import { registerSW } from 'virtual:pwa-register';
import { getUpdateNoticePresentation } from './ui/pwa-update';
import {
  getCampaignLevelAccessibleLabel,
  getCampaignLevelGridTarget,
  getCampaignLevelToHighlight,
} from './ui/level-select';
import { getWinActionLabel } from './ui/win-action';
import type { Dir, GameState, LevelDef } from './game/types';

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
let dailyHomeRefreshTimer = 0;
let blockedFeedbackTimer = 0;
let moveAnimationFrame = 0;
let moveAnimation: {
  x: number;
  y: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  dir: Dir;
  trace: ReturnType<typeof traceFire>;
  startedAt: number;
  progress: number;
  exiting: boolean;
} | null = null;
let blockedCell: { x: number; y: number } | null = null;
let resumeNoticeVisible = false;
let hasUnfinishedPuzzle = false;
let pwaUpdateAvailable = false;
let pwaUpdateDismissed = false;
let pwaUpdateApplying = false;
let pwaUpdateActivated = false;
let updateServiceWorker: (reloadPage?: boolean) => Promise<void> = async () => {};
let foregroundUpdateCheckTimer = 0;
let foregroundUpdateCheck: Promise<void> | null = null;
type PendingPuzzleAction =
  | { kind: 'restart' }
  | { kind: 'replace'; levelId: number; mode: PlayMode; key: string | null };
type LevelSelectOrigin = 'home' | 'play' | 'win';
let pendingPuzzleAction: PendingPuzzleAction | null = null;
let levelSelectReturn: { origin: LevelSelectOrigin; trigger: HTMLElement } | null = null;
type DailyPointerClickGuard = { x: number; y: number; expiresAt: number };
let dailyPointerClickGuard: DailyPointerClickGuard | null = null;
let suppressedPointerSequence: { pointerId: number; x: number; y: number } | null = null;

const board = document.getElementById('board') as HTMLCanvasElement;
const boardAccess = document.getElementById('board-access') as HTMLDivElement;
const boardAnnouncement = document.getElementById('board-announcement') as HTMLParagraphElement;
const failEl = document.getElementById('overlay-fail')!;
const winEl = document.getElementById('overlay-win')!;
const rewardEl = document.getElementById('overlay-reward')!;
const updateConfirmEl = document.getElementById('overlay-update')!;
const puzzleConfirmEl = document.getElementById('overlay-puzzle-confirm')!;
const toastEl = document.getElementById('toast')!;
const updateNoticeEl = document.getElementById('pwa-update-notice')!;
const updateNoticeMessage = document.getElementById('pwa-update-message')!;
const updateNoticeButton = document.getElementById('btn-pwa-update') as HTMLButtonElement;

function cancelPendingFire(): void {
  if (blockedFeedbackTimer) {
    window.clearTimeout(blockedFeedbackTimer);
    blockedFeedbackTimer = 0;
  }
  if (moveAnimationFrame) {
    window.cancelAnimationFrame(moveAnimationFrame);
    moveAnimationFrame = 0;
  }
  moveAnimation = null;
  flashPath = null;
  blockedCell = null;
}

function showScreen(name: string): void {
  if (name !== 'play') {
    hideResumeNotice();
    cancelPendingFire();
  }
  document.querySelectorAll<HTMLElement>('.screen').forEach((el) => {
    el.hidden = el.dataset.screen !== name;
  });
  const a2hs = document.getElementById('a2hs');
  if (a2hs) a2hs.hidden = name !== 'home' || sessionStorage.getItem('arrowpath:a2hs') === '1';
  renderUpdateNotice();
}

function state() {
  return engine!.getState();
}

function persistActivePuzzle(): void {
  if (!engine || !hasUnfinishedPuzzle) {
    clearActivePuzzle();
    return;
  }
  const snapshot: ActivePuzzleSnapshot = {
    version: 1,
    levelId: currentId,
    mode: playMode,
    dailyKey: playMode === 'daily' ? dailyKey : null,
    engine: engine.getSnapshot(),
  };
  saveActivePuzzle(snapshot);
}

function vibrate(ms: number): void {
  if (muted) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}

function hideResumeNotice(): void {
  if (!resumeNoticeVisible) return;
  window.clearTimeout(toastTimer);
  toastTimer = 0;
  toastEl.textContent = '';
  toastEl.hidden = true;
  resumeNoticeVisible = false;
}

function showToast(msg: string, durationMs = 1800, isResumeNotice = false): void {
  toastEl.hidden = false;
  toastEl.textContent = msg;
  window.clearTimeout(toastTimer);
  resumeNoticeVisible = isResumeNotice;
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
    toastEl.textContent = '';
    toastTimer = 0;
    resumeNoticeVisible = false;
  }, durationMs);
}

function currentScreen(): string {
  return document.querySelector<HTMLElement>('.screen:not([hidden])')?.dataset.screen ?? 'home';
}

function renderUpdateNotice(): void {
  const presentation = getUpdateNoticePresentation({
    available: pwaUpdateAvailable && !pwaUpdateDismissed,
    screen: currentScreen(),
    hasUnfinishedPuzzle,
  });
  updateNoticeEl.hidden = !presentation.visible;
  if (!presentation.visible) return;
  updateNoticeMessage.textContent = pwaUpdateApplying
    ? 'Installing the update…'
    : presentation.message;
  updateNoticeButton.textContent = pwaUpdateApplying
    ? 'Installing…'
    : presentation.actionLabel;
  updateNoticeButton.disabled = pwaUpdateApplying;
}

function onUpdateAvailable(): void {
  pwaUpdateAvailable = true;
  pwaUpdateDismissed = false;
  pwaUpdateApplying = false;
  pwaUpdateActivated = false;
  renderUpdateNotice();
}

function onUpdateActivated(): void {
  pwaUpdateActivated = true;
  pwaUpdateAvailable = true;
  pwaUpdateDismissed = false;
  if (pwaUpdateApplying) {
    window.location.reload();
    return;
  }
  renderUpdateNotice();
}

function applyUpdate(): void {
  if (!pwaUpdateAvailable || pwaUpdateApplying || moveAnimation) return;
  const presentation = getUpdateNoticePresentation({
    available: true,
    screen: currentScreen(),
    hasUnfinishedPuzzle,
  });
  if (presentation.requiresConfirmation) {
    const body = document.getElementById('update-confirm-body')!;
    body.textContent = hasUnfinishedPuzzle
      ? 'Your unfinished puzzle is saved on this device and will resume after reloading, including its undo history. Cleared progress and settings remain saved.'
      : 'Reloading closes the current game screen. Cleared progress and settings remain saved.';
    document.getElementById('btn-update-confirm')!.textContent = hasUnfinishedPuzzle
      ? 'Resume puzzle and update'
      : 'Reload to update';
    showDialog(updateConfirmEl, 'btn-update-confirm');
    return;
  }
  beginUpdateInstall();
}

function beginUpdateInstall(): void {
  if (!pwaUpdateAvailable || pwaUpdateApplying) return;
  pwaUpdateApplying = true;
  pwaUpdateDismissed = true;
  closeActiveDialog(false);
  renderUpdateNotice();
  if (pwaUpdateActivated) {
    window.location.reload();
    return;
  }
  void updateServiceWorker(true).catch(() => {
    pwaUpdateApplying = false;
    pwaUpdateDismissed = false;
    showToast('The update could not be applied. Please try again.');
    renderUpdateNotice();
  });
}

function scheduleForegroundUpdateCheck(): void {
  if (!('serviceWorker' in navigator) || document.visibilityState !== 'visible') return;
  window.clearTimeout(foregroundUpdateCheckTimer);
  foregroundUpdateCheckTimer = window.setTimeout(() => {
    foregroundUpdateCheckTimer = 0;
    if (document.visibilityState !== 'visible' || foregroundUpdateCheck) return;
    foregroundUpdateCheck = navigator.serviceWorker.ready
      .then((registration) => registration.update())
      .catch(() => {
        // Foreground checks are best-effort; offline use must remain uninterrupted.
      })
      .finally(() => {
        foregroundUpdateCheck = null;
      });
  }, 200);
}

function setupPwaUpdates(): void {
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh: onUpdateAvailable,
    onNeedReload: onUpdateActivated,
  });
  window.addEventListener('focus', scheduleForegroundUpdateCheck);
  document.addEventListener('visibilitychange', scheduleForegroundUpdateCheck);
}

function scheduleDailyHomeRefresh(): void {
  if (dailyHomeRefreshTimer) window.clearTimeout(dailyHomeRefreshTimer);
  const now = new Date();
  const [year, month, day] = dailyKeyKarachi(now).split('-').map(Number);
  const nextMidnightUtc = Date.UTC(year, month - 1, day + 1) - 5 * 60 * 60 * 1000;
  const delay = Math.max(1, nextMidnightUtc - now.getTime());
  dailyHomeRefreshTimer = window.setTimeout(() => {
    dailyHomeRefreshTimer = 0;
    const home = document.querySelector<HTMLElement>('.screen[data-screen="home"]');
    if (home && !home.hidden) {
      updateHome();
    } else {
      scheduleDailyHomeRefresh();
    }
  }, delay);
}

function updateHome(): void {
  const p = getProgress();
  const total = pack?.levels.length ?? 50;
  const cleared = p.cleared.length;
  document.getElementById('home-progress')!.textContent =
    `${cleared} cleared · unlocked ${p.unlocked}/${total}`;

  const playBtn = document.getElementById('btn-play')!;
  playBtn.textContent = hasUnfinishedPuzzle
    ? 'Resume'
    : p.unlocked > 1 || p.cleared.length > 0
      ? 'Continue'
      : 'Play';

  const key = dailyKeyKarachi();
  const rec = getDailyRecord(key);
  const meta = document.getElementById('home-daily-meta')!;
  meta.textContent = rec?.completed
    ? `Daily ${key} ✓ completed`
    : `Daily ${key} ready`;
  const dailyButton = document.getElementById('btn-daily') as HTMLButtonElement;
  dailyButton.disabled = Boolean(rec?.completed);
  dailyButton.textContent = rec?.completed ? 'Daily complete' : 'Daily Challenge';
  scheduleDailyHomeRefresh();
}

function updateSettingsUi(): void {
  const muteBtn = document.getElementById('btn-mute')!;
  muteBtn.textContent = muted ? 'Vibration off' : 'Vibration on';
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
  const playScreen = document.querySelector<HTMLElement>('.screen[data-screen="play"]')!;
  const compactLandscape = window.matchMedia(
    '(orientation: landscape) and (max-height: 360px)',
  ).matches;
  const shortLandscapeStack = compactLandscape && playScreen.clientHeight < 243;
  playScreen.classList.toggle('short-landscape-layout', shortLandscapeStack);
  const appStyle = getComputedStyle(document.getElementById('app')!);
  const appTopPadding = Number.parseFloat(appStyle.paddingTop);
  const appBottomPadding = Number.parseFloat(appStyle.paddingBottom);
  // A 308px board makes 44px cells on Level 50. Reuse the normal 12px bottom
  // gutter only when it is not reserving extra safe-area space.
  const heightLimit = compactLandscape && !shortLandscapeStack
    ? playScreen.clientHeight + (appBottomPadding <= 12 ? 12 : 0)
    : shortLandscapeStack
      ? Math.max(
          0,
          Math.min(
            window.innerHeight * 0.7 - 1,
            window.innerHeight -
              appTopPadding -
              appBottomPadding -
              playScreen.querySelector<HTMLElement>('.hud')!.getBoundingClientRect().height -
              Number.parseFloat(getComputedStyle(playScreen).rowGap) -
              1,
          ),
        )
      : window.innerHeight * 0.55;
  const css = Math.max(
    0,
    Math.floor(Math.min(wrap.clientWidth, heightLimit)),
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
        String(cell.kind !== 'arrow' || s.status !== 'playing' || moveAnimation !== null),
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
    blockedCell,
    movingArrow: moveAnimation
      ? {
          from: moveAnimation.from,
          to: moveAnimation.to,
          dir: moveAnimation.dir,
          progress: moveAnimation.progress,
          exiting: moveAnimation.exiting,
        }
      : null,
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
  updateConfirmEl.hidden = true;
  puzzleConfirmEl.hidden = true;
  pendingPuzzleAction = null;
  dialogReturnFocus = null;
  suspendedDialog = null;
  suspendedDialogFocus = null;
}

function activeDialog(): HTMLElement | null {
  return [rewardEl, failEl, winEl, updateConfirmEl, puzzleConfirmEl].find((dialog) => !dialog.hidden) ?? null;
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
  if (dialog === puzzleConfirmEl) pendingPuzzleAction = null;

  if (suspendedDialog) {
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

function focusCurrentLevel(): void {
  const current = document.querySelector<HTMLButtonElement>(
    '#level-grid button.current:not(:disabled)',
  );
  const firstAvailable = document.querySelector<HTMLButtonElement>(
    '#level-grid button:not(:disabled)',
  );
  (current ?? firstAvailable)?.focus();
}

function openLevelSelect(origin: LevelSelectOrigin, trigger: HTMLElement): void {
  levelSelectReturn = { origin, trigger };
  if (origin !== 'home') hideOverlays();
  buildLevelSelect();
  showScreen('levels');
  focusCurrentLevel();
}

function closeLevelSelect(): void {
  const returnTo = levelSelectReturn;
  levelSelectReturn = null;
  if (!returnTo) {
    showScreen('home');
    document.getElementById('btn-levels')?.focus({ preventScroll: true });
    return;
  }

  if (returnTo.origin === 'home') {
    showScreen('home');
  } else {
    showScreen('play');
    layout();
    render();
    if (returnTo.origin === 'win') {
      showDialog(winEl, 'btn-win-levels');
      dialogReturnFocus = returnTo.trigger;
    }
  }

  if (returnTo.trigger.isConnected && !returnTo.trigger.closest('[hidden]')) {
    returnTo.trigger.focus({ preventScroll: true });
  }
}

function closeHowTo(): void {
  setOnboarded();
  updateHome();
  showScreen('home');
  document.getElementById('btn-howto')?.focus({ preventScroll: true });
}

function closeSettings(): void {
  updateHome();
  showScreen('home');
  document.getElementById('btn-settings')?.focus({ preventScroll: true });
}

function configureWinOverlay(): void {
  const nextBtn = document.getElementById('btn-next') as HTMLButtonElement;
  const winMeta = document.getElementById('win-meta')!;
  nextBtn.textContent = getWinActionLabel(
    playMode,
    currentId,
    pack?.levels.length ?? currentId,
  );
  if (playMode === 'daily') {
    winMeta.textContent = dailyKey
      ? `Daily ${dailyKey} cleared. Nice neon run.`
      : 'Daily cleared. Nice neon run.';
  } else {
    winMeta.textContent = 'Neon line clear. Next station?';
  }
}

function showPuzzleConfirmation(action: PendingPuzzleAction): void {
  pendingPuzzleAction = action;
  const saved = action.kind === 'replace'
    ? loadPuzzleForMode(action.mode, action.key)
    : null;
  const title = document.getElementById('puzzle-confirm-title')!;
  const body = document.getElementById('puzzle-confirm-body')!;
  const confirm = document.getElementById('btn-puzzle-confirm')!;
  if (action.kind === 'restart') {
    title.textContent = 'Restart this puzzle?';
    body.textContent = 'Your current board and undo history will be replaced with a fresh puzzle.';
    confirm.textContent = 'Restart puzzle';
  } else if ((!hasUnfinishedPuzzle || playMode !== action.mode) && saved) {
    const savedLabel = saved.mode === 'daily'
      ? `Daily ${saved.dailyKey}`
      : `campaign level ${saved.levelId}`;
    title.textContent = 'Replace saved puzzle?';
    body.textContent = `Your saved ${savedLabel} board and undo history will be discarded. Start level ${action.levelId} instead?`;
    confirm.textContent = `Start level ${action.levelId}`;
  } else {
    title.textContent = 'Change level?';
    body.textContent = `Your level ${currentId} board and undo history will be discarded. Start level ${action.levelId} instead?`;
    confirm.textContent = `Start level ${action.levelId}`;
  }
  showDialog(puzzleConfirmEl, 'btn-puzzle-confirm');
}

function presentActivePuzzle(): void {
  if (!engine) return;
  hideOverlays();
  showScreen('play');
  layout();
  render();
  announceBoard(describeBoard(state()));
  if (state().status === 'failed') {
    const reason = state().failReason === 'wall' ? 'Hit a wall.' : 'Hit another arrow.';
    document.getElementById('fail-reason')!.textContent = reason;
    showDialog(failEl, 'btn-fail-retry');
  } else {
    boardAccess.querySelector<HTMLButtonElement>(`[data-cell-index="${activeCellIndex}"]`)
      ?.focus({ preventScroll: true });
  }
}

function confirmPuzzleAction(): void {
  const action = pendingPuzzleAction;
  if (!action) return;
  pendingPuzzleAction = null;
  closeActiveDialog(false);
  if (action.kind === 'restart') {
    restartPuzzle();
  } else {
    void startLevel(action.levelId, action.mode, action.key, true);
  }
}

async function startLevel(
  id: number,
  mode: PlayMode = 'campaign',
  key: string | null = null,
  replacementConfirmed = false,
): Promise<void> {
  if (!pack || moveAnimation) return;
  const level = getLevel(pack, id);
  if (!level) return;
  if (mode === 'campaign') {
    const progress = getProgress();
    if (id > progress.unlocked) return;
  }
  const sameActiveRun =
    hasUnfinishedPuzzle &&
    engine !== null &&
    currentId === id &&
    playMode === mode &&
    dailyKey === (mode === 'daily' ? key : null);
  if (sameActiveRun) {
    levelSelectReturn = null;
    presentActivePuzzle();
    return;
  }
  const saved = loadPuzzleForMode(mode, mode === 'daily' ? key : null);
  const savedEngine = saved?.levelId === id
    ? Engine.fromSnapshot(level, saved.engine)
    : null;
  if (saved && saved.levelId === id && !savedEngine) {
    clearPuzzleForMode(mode);
  }
  if (saved && saved.levelId !== id && !replacementConfirmed) {
    showPuzzleConfirmation({ kind: 'replace', levelId: id, mode, key });
    return;
  }
  if (
    hasUnfinishedPuzzle && engine && playMode === mode &&
    !replacementConfirmed
  ) {
    showPuzzleConfirmation({ kind: 'replace', levelId: id, mode, key });
    return;
  }
  levelSelectReturn = null;
  if (savedEngine && !(hasUnfinishedPuzzle && engine && playMode === mode)) {
    engine = savedEngine;
    currentId = id;
    playMode = mode;
    dailyKey = mode === 'daily' ? key : null;
    hasUnfinishedPuzzle = true;
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
    persistActivePuzzle();
    announceBoard(describeBoard(state()));
    boardAccess.querySelector<HTMLButtonElement>(`[data-cell-index="${activeCellIndex}"]`)
      ?.focus({ preventScroll: true });
    return;
  }
  if (replacementConfirmed) {
    if (hasUnfinishedPuzzle && engine && playMode === mode) {
      clearActivePuzzle();
    } else {
      clearPuzzleForMode(mode);
    }
  }
  hasUnfinishedPuzzle = true;
  playMode = mode;
  dailyKey = mode === 'daily' ? key : null;
  currentId = id;
  engine = new Engine(level);
  if (mode === 'daily' && dailyKey) {
    saveDailyRecord(dailyKey, { completed: false, levelId: id });
  }
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
  persistActivePuzzle();
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
  void startLevel(levelId, 'daily', key);
}

function onWin(): void {
  vibrate(25);
  hasUnfinishedPuzzle = false;
  clearActivePuzzle();
  renderUpdateNotice();
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
    void navigator.share({ title: 'ArrowPath', text }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
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

function showBlockedFeedback(
  x: number,
  y: number,
  trace: ReturnType<typeof traceFire>,
  moved: boolean,
): void {
  if (blockedFeedbackTimer) window.clearTimeout(blockedFeedbackTimer);
  const blocker = trace.blocker;
  if (!blocker || (trace.result !== 'collision' && trace.result !== 'wall')) return;
  const blockerName = trace.result === 'wall' ? 'wall' : 'another arrow';
  const destination = trace.path[trace.path.length - 1]!;
  flashPath = trace.path;
  blockedCell = blocker;
  render();
  if (moved) {
    announceBoard(
      `Arrow from row ${y + 1}, column ${x + 1} stopped at row ${destination.y + 1}, column ${destination.x + 1} before ${blockerName} at row ${blocker.y + 1}, column ${blocker.x + 1}. Move ${state().movesMade}.`,
    );
    showToast(`Path blocked by ${blockerName}; arrow stopped just before it.`);
  } else {
    announceBoard(
      `Arrow at row ${y + 1}, column ${x + 1} could not move: ${blockerName} is immediately ahead at row ${blocker.y + 1}, column ${blocker.x + 1}. No move recorded.`,
    );
    showToast(`Path blocked by ${blockerName}. No movement.`);
  }
  blockedFeedbackTimer = window.setTimeout(() => {
    blockedFeedbackTimer = 0;
    flashPath = null;
    blockedCell = null;
    render();
  }, 900);
}

function tryFire(x: number, y: number): void {
  if (!engine || moveAnimation) return;
  const s = state();
  if (s.status !== 'playing') return;
  const cell = s.cells[y * s.w + x];
  if (!cell || cell.kind !== 'arrow') return;

  const traced = traceFire(s, x, y);
  if (traced.result === 'invalid') return;
  if (blockedFeedbackTimer) {
    window.clearTimeout(blockedFeedbackTimer);
    blockedFeedbackTimer = 0;
  }
  flashPath = null;
  blockedCell = null;
  if (traced.result !== 'clear' && traced.path.length === 1) {
    showBlockedFeedback(x, y, traced, false);
    return;
  }

  const destination = traced.result === 'clear'
    ? traced.exitCell
    : traced.path[traced.path.length - 1];
  if (!destination) return;
  hintCell = null;
  moveAnimation = {
    x,
    y,
    from: { x, y },
    to: destination,
    dir: cell.dir,
    trace: traced,
    startedAt: 0,
    progress: 0,
    exiting: traced.result === 'clear',
  };
  flashPath = traced.path;

  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;

  const animate = (now: number): void => {
    if (!moveAnimation) return;
    if (moveAnimation.startedAt === 0) moveAnimation.startedAt = now;
    moveAnimation.progress = prefersReducedMotion
      ? 1
      : Math.min(1, (now - moveAnimation.startedAt) / 270);
    render();
    if (moveAnimation.progress < 1) {
      moveAnimationFrame = window.requestAnimationFrame(animate);
      return;
    }

    moveAnimationFrame = 0;
    const completedMove = moveAnimation;
    moveAnimation = null;
    flashPath = null;
    blockedCell = null;
    const result = engine!.fire(completedMove.x, completedMove.y);
    if (!result.ok) {
      render();
      return;
    }

    if (!result.exited) {
      const stop = result.trace.path[result.trace.path.length - 1]!;
      activeCellIndex = stop.y * result.state.w + stop.x;
      blockedCell = result.trace.blocker;
      render();
      persistActivePuzzle();
      showBlockedFeedback(completedMove.x, completedMove.y, result.trace, true);
      vibrate(12);
      return;
    }

    activeCellIndex = completedMove.y * result.state.w + completedMove.x;
    render();
    if (result.won) {
      clearActivePuzzle();
      announceBoard('Board cleared. All arrows have left the board.');
      void onWin();
    } else {
      persistActivePuzzle();
      const remaining = result.state.arrowsRemaining;
      const arrowWord = remaining === 1 ? 'arrow' : 'arrows';
      const remainVerb = remaining === 1 ? 'remains' : 'remain';
      announceBoard(
        `Arrow at row ${y + 1}, column ${x + 1} cleared. Move ${result.state.movesMade}. ${remaining} ${arrowWord} ${remainVerb}.`,
      );
      vibrate(12);
    }
  };
  if (prefersReducedMotion) {
    animate(window.performance.now());
    return;
  }
  moveAnimationFrame = window.requestAnimationFrame(animate);
}

function doRetry(): void {
  if (!engine) return;
  if (!engine.isPristine()) {
    showPuzzleConfirmation({ kind: 'restart' });
    return;
  }
  restartPuzzle();
}

function restartPuzzle(): void {
  if (!engine) return;
  cancelPendingFire();
  clearActivePuzzle();
  hasUnfinishedPuzzle = true;
  hideOverlays();
  engine.restart();
  hintCell = null;
  flashPath = null;
  render();
  persistActivePuzzle();
  boardAccess.querySelector<HTMLButtonElement>(`[data-cell-index="${activeCellIndex}"]`)
    ?.focus({ preventScroll: true });
  announceBoard(describeBoard(state()));
  void showInterstitial('retry');
}

function tryUndo(): void {
  if (!engine || moveAnimation) return;
  if (!engine.canUndo()) return;
  const s = state();
  if (s.undosLeft > 0) {
    engine.undo(false);
    hideOverlays();
    hintCell = null;
    render();
    persistActivePuzzle();
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
  if (!engine || moveAnimation) return;
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
    persistActivePuzzle();
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
  const savedCampaign = hasUnfinishedPuzzle && playMode === 'campaign'
    ? null
    : loadPuzzleForMode('campaign');
  const campaignLevelToHighlight = getCampaignLevelToHighlight({
    activeCampaignLevelId:
      hasUnfinishedPuzzle && playMode === 'campaign'
        ? currentId
        : savedCampaign?.levelId ?? null,
    unlockedLevel: progress.unlocked,
    totalLevels: pack.levels.length,
  });
  for (const level of pack.levels) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'level-btn';
    btn.textContent = String(level.id);
    const locked = level.id > progress.unlocked;
    const cleared = progress.cleared.includes(level.id);
    const current = level.id === campaignLevelToHighlight;
    btn.setAttribute(
      'aria-label',
      getCampaignLevelAccessibleLabel({
        levelId: level.id,
        unlocked: !locked,
        cleared,
        current,
      }),
    );
    if (locked) btn.classList.add('locked');
    if (cleared) btn.classList.add('cleared');
    if (current) btn.classList.add('current');
    btn.dataset.levelId = String(level.id);
    btn.disabled = locked;
    btn.tabIndex = !locked && level.id === campaignLevelToHighlight ? 0 : -1;
    btn.addEventListener('click', () => {
      void startLevel(level.id, 'campaign');
    });
    grid.appendChild(btn);
  }
}

function resumeSavedPuzzle(): boolean {
  const saved = loadActivePuzzle();
  if (!saved || !pack) return false;
  const level = getLevel(pack, saved.levelId);
  if (!level) {
    clearActivePuzzle();
    return false;
  }
  if (saved.mode === 'campaign') {
    if (saved.levelId > getProgress().unlocked) {
      clearActivePuzzle();
      return false;
    }
  } else {
    const key = saved.dailyKey;
    if (
      !key ||
      key !== dailyKeyKarachi() ||
      saved.levelId !== dailyLevelId(key, pack.levels.length) ||
      getDailyRecord(key)?.completed
    ) {
      clearActivePuzzle();
      return false;
    }
  }
  const restored = Engine.fromSnapshot(level, saved.engine);
  if (!restored) {
    clearActivePuzzle();
    return false;
  }

  engine = restored;
  currentId = saved.levelId;
  playMode = saved.mode;
  dailyKey = saved.mode === 'daily' ? saved.dailyKey : null;
  hasUnfinishedPuzzle = true;
  // Older builds kept only the active pointer; mirror it into the mode slot so
  // an in-progress run survives its first campaign/Daily switch after upgrade.
  persistActivePuzzle();
  activeCellIndex = Math.max(
    0,
    state().cells.findIndex((cell) => cell.kind === 'arrow'),
  );
  hintCell = null;
  flashPath = null;
  updateHome();
  presentActivePuzzle();
  return true;
}

function wire(): void {
  updateNoticeButton.addEventListener('click', applyUpdate);
  document.getElementById('btn-pwa-update-later')!.addEventListener('click', () => {
    pwaUpdateDismissed = true;
    renderUpdateNotice();
  });
  document.getElementById('btn-update-confirm')!.addEventListener('click', beginUpdateInstall);
  document.getElementById('btn-update-cancel')!.addEventListener('click', () => closeActiveDialog());
  document.getElementById('btn-puzzle-confirm')!.addEventListener('click', confirmPuzzleAction);
  document.getElementById('btn-puzzle-cancel')!.addEventListener('click', () => closeActiveDialog());

  document.addEventListener('pointerdown', (event) => {
    const guard = dailyPointerClickGuard;
    if (!guard) return;
    dailyPointerClickGuard = null;
    if (
      performance.now() > guard.expiresAt ||
      Math.abs(event.clientX - guard.x) > 8 ||
      Math.abs(event.clientY - guard.y) > 8
    ) return;
    suppressedPointerSequence = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener('pointerup', (event) => {
    if (suppressedPointerSequence?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const pointerId = event.pointerId;
    window.setTimeout(() => {
      if (suppressedPointerSequence?.pointerId === pointerId) {
        suppressedPointerSequence = null;
      }
    }, 500);
  }, true);
  document.addEventListener('pointercancel', (event) => {
    if (suppressedPointerSequence?.pointerId === event.pointerId) {
      suppressedPointerSequence = null;
    }
  }, true);
  document.addEventListener('click', (event) => {
    const suppressed = suppressedPointerSequence;
    if (!suppressed) return;
    const pointerId = event instanceof PointerEvent ? event.pointerId : null;
    const sameCoordinates =
      Math.abs(event.clientX - suppressed.x) <= 8 &&
      Math.abs(event.clientY - suppressed.y) <= 8;
    if (pointerId === suppressed.pointerId || (pointerId === null && event.detail > 0 && sameCoordinates)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressedPointerSequence = null;
    }
  }, true);

  document.getElementById('btn-play')!.addEventListener('click', () => {
    if (engine && hasUnfinishedPuzzle) {
      presentActivePuzzle();
      return;
    }
    const p = getProgress();
    void startLevel(Math.min(p.unlocked, pack!.levels.length), 'campaign');
  });
  document.getElementById('btn-daily')!.addEventListener('click', (event) => {
    if (event.detail > 0) {
      dailyPointerClickGuard = {
        x: event.clientX,
        y: event.clientY,
        expiresAt: performance.now() + 500,
      };
    }
    startDaily();
  });
  document.getElementById('btn-levels')!.addEventListener('click', () => {
    openLevelSelect('home', document.getElementById('btn-levels')!);
  });
  document.getElementById('btn-howto')!.addEventListener('click', () => {
    showScreen('howto');
    document.getElementById('howto-title')?.focus({ preventScroll: true });
  });
  document.getElementById('btn-howto-ok')!.addEventListener('click', () => {
    closeHowTo();
  });
  document.getElementById('btn-settings')!.addEventListener('click', () => {
    updateSettingsUi();
    showScreen('settings');
    document.getElementById('settings-title')?.focus({ preventScroll: true });
  });
  document
    .getElementById('btn-settings-back')!
    .addEventListener('click', () => {
      closeSettings();
    });
  document
    .getElementById('btn-levels-back')!
    .addEventListener('click', closeLevelSelect);
  const levelGrid = document.getElementById('level-grid')!;
  levelGrid.addEventListener('focusin', (event) => {
    const focused = (event.target as HTMLElement).closest<HTMLButtonElement>('.level-btn');
    if (!focused || focused.disabled || !levelGrid.contains(focused)) return;
    levelGrid.querySelectorAll<HTMLButtonElement>('.level-btn').forEach((button) => {
      button.tabIndex = button === focused ? 0 : -1;
    });
  });
  levelGrid.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const focused = (event.target as HTMLElement).closest<HTMLButtonElement>('.level-btn');
    if (!focused || focused.disabled || !levelGrid.contains(focused)) return;
    event.preventDefault();
    const targetLevelId = getCampaignLevelGridTarget({
      currentLevelId: Number(focused.dataset.levelId),
      key: event.key,
      unlockedLevel: getProgress().unlocked,
      totalLevels: pack?.levels.length ?? 0,
      columns: 5,
    });
    if (targetLevelId === null) return;
    levelGrid
      .querySelector<HTMLButtonElement>(`[data-level-id="${targetLevelId}"]`)
      ?.focus({ preventScroll: true });
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
    openLevelSelect('play', document.getElementById('btn-play-levels')!);
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
    openLevelSelect('win', document.getElementById('btn-win-levels')!);
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
    if (!dialog) {
      if (event.key === 'Escape') {
        const screen = currentScreen();
        if (screen === 'levels') {
          event.preventDefault();
          closeLevelSelect();
        } else if (screen === 'howto') {
          event.preventDefault();
          closeHowTo();
        } else if (screen === 'settings') {
          event.preventDefault();
          closeSettings();
        }
      }
      return;
    }
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
    document.getElementById('howto-title')?.focus({ preventScroll: true });
  } else {
    showScreen('home');
  }
  if (resumeSavedPuzzle() && engine) {
    const poursCompleted =
      engine.getLevel().cells.filter((cell) => cell.t === 'arrow').length -
      state().arrowsRemaining;
    showToast(
      describeRestoredRunStatus({
        levelId: currentId,
        mode: playMode,
        poursCompleted,
      }),
      5000,
      true,
    );
  }
  setupPwaUpdates();
}

void boot();

export type { LevelDef };
