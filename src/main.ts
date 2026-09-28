import './style.css';
import { Engine, traceFire } from './game/engine';
import { loadLevels, getLevel, type LevelPack } from './game/levels';
import {
  getProgress,
  markLevelCleared,
  getSettings,
  setSettings,
  isOnboarded,
  setOnboarded,
} from './game/persist';
import {
  showInterstitial,
  showRewarded,
  isAdsRemoved,
  purchaseRemoveAds,
} from './ads/stubs';
import { drawBoard, hitCell, resizeCanvas } from './ui/canvas';
import type { GameState, LevelDef } from './game/types';

let pack: LevelPack | null = null;
let engine: Engine | null = null;
let currentId = 1;
let cellSize = 40;
let hintCell: { x: number; y: number } | null = null;
let flashPath: { x: number; y: number }[] | null = null;
let muted = getSettings().muted;
let rewardAction: 'hint' | 'undo' | null = null;

const board = document.getElementById('board') as HTMLCanvasElement;
const failEl = document.getElementById('overlay-fail')!;
const winEl = document.getElementById('overlay-win')!;
const rewardEl = document.getElementById('overlay-reward')!;

function showScreen(name: string): void {
  document.querySelectorAll<HTMLElement>('.screen').forEach((el) => {
    el.hidden = el.dataset.screen !== name;
  });
  const a2hs = document.getElementById('a2hs');
  if (a2hs) a2hs.hidden = name !== 'home' || sessionStorage.getItem('arrowpath:a2hs') === '1';
}

function state(): GameState {
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

function updateHome(): void {
  const p = getProgress();
  const total = pack?.levels.length ?? 50;
  const cleared = p.cleared.length;
  document.getElementById('home-progress')!.textContent = `${cleared} cleared · unlocked ${p.unlocked}/${total}`;
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
  document.getElementById('hud-level')!.textContent = String(s.levelId);
  document.getElementById('hud-left')!.textContent = String(s.arrowsRemaining);
  document.getElementById('hud-undos')!.textContent = String(s.undosLeft);
}

function layout(): void {
  if (!engine) return;
  const s = state();
  const wrap = board.parentElement!;
  const css = Math.max(0, Math.floor(Math.min(wrap.clientWidth, window.innerHeight * 0.55)));
  const { cell } = resizeCanvas(board, css || 320, s.w, s.h);
  cellSize = cell;
  render();
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
  updateHud();
}

function hideOverlays(): void {
  failEl.hidden = true;
  winEl.hidden = true;
  rewardEl.hidden = true;
}

async function startLevel(id: number): Promise<void> {
  if (!pack) return;
  const level = getLevel(pack, id);
  if (!level) return;
  const progress = getProgress();
  if (id > progress.unlocked) return;
  currentId = id;
  engine = new Engine(level);
  hintCell = null;
  flashPath = null;
  hideOverlays();
  showScreen('play');
  layout();
  render();
}

function onFail(reason: string): void {
  vibrate(40);
  const el = document.getElementById('fail-reason')!;
  el.textContent = reason === 'wall' ? 'Hit a wall.' : 'Hit another arrow.';
  failEl.hidden = false;
  void showInterstitial('fail');
}

async function onWin(): Promise<void> {
  vibrate(25);
  const total = pack!.levels.length;
  markLevelCleared(currentId, total);
  updateHome();
  winEl.hidden = false;
  await showInterstitial('level-complete');
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
        onFail(result.reason);
      }
      return;
    }
    if (result.won) {
      void onWin();
    } else {
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
  void showInterstitial('retry');
}

function tryUndo(fromFail = false): void {
  if (!engine) return;
  if (!engine.canUndo()) return;
  const s = state();
  if (s.undosLeft > 0) {
    engine.undo(false);
    hideOverlays();
    hintCell = null;
    render();
    return;
  }
  // need rewarded
  rewardAction = 'undo';
  document.getElementById('reward-title')!.textContent = 'Extra undo';
  document.getElementById('reward-body')!.textContent =
    'Free undos used. Watch a placeholder ad for one more undo.';
  if (fromFail) failEl.hidden = true;
  rewardEl.hidden = false;
}

function tryHint(): void {
  if (!engine) return;
  if (state().status !== 'playing') return;
  rewardAction = 'hint';
  document.getElementById('reward-title')!.textContent = 'Hint';
  document.getElementById('reward-body')!.textContent =
    'Watch a placeholder rewarded ad to highlight a safe arrow.';
  rewardEl.hidden = false;
}

async function confirmReward(): Promise<void> {
  const action = rewardAction;
  rewardEl.hidden = false;
  const ok = await showRewarded(action ?? 'hint');
  rewardEl.hidden = true;
  rewardAction = null;
  if (!ok || !engine) return;
  if (action === 'hint') {
    hintCell = engine.hint();
    render();
  } else if (action === 'undo') {
    engine.undo(true);
    hideOverlays();
    hintCell = null;
    render();
  }
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
    if (level.id === currentId) btn.classList.add('current');
    btn.disabled = locked;
    btn.addEventListener('click', () => {
      void startLevel(level.id);
    });
    grid.appendChild(btn);
  }
}

function wire(): void {
  document.getElementById('btn-play')!.addEventListener('click', () => {
    const p = getProgress();
    void startLevel(Math.min(p.unlocked, pack!.levels.length));
  });
  document.getElementById('btn-levels')!.addEventListener('click', () => {
    buildLevelSelect();
    showScreen('levels');
  });
  document.getElementById('btn-howto')!.addEventListener('click', () => showScreen('howto'));
  document.getElementById('btn-howto-ok')!.addEventListener('click', () => {
    setOnboarded();
    showScreen('home');
  });
  document.getElementById('btn-settings')!.addEventListener('click', () => {
    updateSettingsUi();
    showScreen('settings');
  });
  document.getElementById('btn-settings-back')!.addEventListener('click', () => showScreen('home'));
  document.getElementById('btn-levels-back')!.addEventListener('click', () => showScreen('home'));
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
  });
  document.getElementById('btn-hint')!.addEventListener('click', () => tryHint());
  document.getElementById('btn-undo')!.addEventListener('click', () => tryUndo(false));
  document.getElementById('btn-retry')!.addEventListener('click', () => doRetry());
  document.getElementById('btn-play-levels')!.addEventListener('click', () => {
    hideOverlays();
    buildLevelSelect();
    showScreen('levels');
  });

  document.getElementById('btn-fail-retry')!.addEventListener('click', () => doRetry());
  document.getElementById('btn-fail-undo')!.addEventListener('click', () => tryUndo(true));
  document.getElementById('btn-fail-home')!.addEventListener('click', () => {
    hideOverlays();
    updateHome();
    showScreen('home');
  });

  document.getElementById('btn-next')!.addEventListener('click', () => {
    const next = currentId + 1;
    if (pack && next <= pack.levels.length) {
      void startLevel(next);
    } else {
      hideOverlays();
      updateHome();
      showScreen('home');
    }
  });
  document.getElementById('btn-win-levels')!.addEventListener('click', () => {
    hideOverlays();
    buildLevelSelect();
    showScreen('levels');
  });
  document.getElementById('btn-win-home')!.addEventListener('click', () => {
    hideOverlays();
    updateHome();
    showScreen('home');
  });

  document.getElementById('btn-reward-ok')!.addEventListener('click', () => {
    void confirmReward();
  });
  document.getElementById('btn-reward-cancel')!.addEventListener('click', () => {
    rewardEl.hidden = true;
    rewardAction = null;
  });

  board.addEventListener('pointerdown', (ev) => {
    if (!engine || state().status !== 'playing') return;
    const cell = hitCell(board, ev.clientX, ev.clientY, state());
    if (cell) tryFire(cell.x, cell.y);
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

// export for debugging / future
export type { LevelDef };
