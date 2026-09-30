import {
  DIR_DELTA,
  FREE_UNDOS,
  type BoardCell,
  type Dir,
  type GameState,
  type LevelDef,
} from './types';

export function idx(x: number, y: number, w: number): number {
  return y * w + x;
}

export function inBounds(x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}

export function levelToBoard(level: LevelDef): BoardCell[] {
  const cells: BoardCell[] = Array.from({ length: level.w * level.h }, () => ({
    kind: 'empty',
  }));
  for (const c of level.cells) {
    if (!inBounds(c.x, c.y, level.w, level.h)) continue;
    const i = idx(c.x, c.y, level.w);
    if (c.t === 'wall') {
      cells[i] = { kind: 'wall' };
    } else if (c.t === 'arrow' && c.d) {
      cells[i] = { kind: 'arrow', dir: c.d };
    }
  }
  return cells;
}

function countArrows(cells: BoardCell[]): number {
  return cells.reduce((n, c) => n + (c.kind === 'arrow' ? 1 : 0), 0);
}

export function createState(level: LevelDef, undosLeft = FREE_UNDOS): GameState {
  const cells = levelToBoard(level);
  return {
    levelId: level.id,
    w: level.w,
    h: level.h,
    cells,
    status: 'playing',
    undosLeft,
    arrowsRemaining: countArrows(cells),
  };
}

export interface EngineSnapshot {
  state: GameState;
  history: GameState[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStateForLevel(level: LevelDef, value: unknown): GameState | null {
  if (!isRecord(value)) return null;
  const candidate = value as unknown as GameState;
  if (
    candidate.levelId !== level.id ||
    candidate.w !== level.w ||
    candidate.h !== level.h ||
    !Number.isInteger(candidate.w) ||
    !Number.isInteger(candidate.h) ||
    candidate.w < 1 ||
    candidate.h < 1 ||
    !Array.isArray(candidate.cells) ||
    candidate.cells.length !== level.w * level.h ||
    (candidate.status !== 'playing' && candidate.status !== 'failed') ||
    !Number.isInteger(candidate.undosLeft) ||
    candidate.undosLeft < 0 ||
    candidate.undosLeft > FREE_UNDOS ||
    !Number.isInteger(candidate.arrowsRemaining)
  ) {
    return null;
  }
  if (
    (candidate.status === 'playing' && candidate.failReason !== undefined) ||
    (candidate.status === 'failed' &&
      candidate.failReason !== 'collision' &&
      candidate.failReason !== 'wall')
  ) {
    return null;
  }

  const initial = levelToBoard(level);
  const cells: BoardCell[] = [];
  for (let i = 0; i < candidate.cells.length; i++) {
    const cell = candidate.cells[i];
    const original = initial[i]!;
    if (!isRecord(cell)) return null;
    if (original.kind === 'empty') {
      if (cell.kind !== 'empty') return null;
      cells.push({ kind: 'empty' });
    } else if (original.kind === 'wall') {
      if (cell.kind !== 'wall') return null;
      cells.push({ kind: 'wall' });
    } else if (cell.kind === 'empty') {
      cells.push({ kind: 'empty' });
    } else if (cell.kind === 'arrow' && cell.dir === original.dir) {
      cells.push({ kind: 'arrow', dir: original.dir });
    } else {
      return null;
    }
  }

  const arrowsRemaining = countArrows(cells);
  if (candidate.arrowsRemaining !== arrowsRemaining || arrowsRemaining === 0) return null;
  const state: GameState = {
    levelId: level.id,
    w: level.w,
    h: level.h,
    cells,
    status: candidate.status,
    undosLeft: candidate.undosLeft,
    arrowsRemaining,
    ...(candidate.status === 'failed' ? { failReason: candidate.failReason } : {}),
  };
  if (
    state.status === 'failed' &&
    !cells.some(
      (cell, i) =>
        cell.kind === 'arrow' &&
        traceFire(state, i % level.w, Math.floor(i / level.w)).result === state.failReason,
    )
  ) {
    return null;
  }
  return state;
}

export function cloneState(s: GameState): GameState {
  return {
    ...s,
    cells: s.cells.map((c) => ({ ...c })),
  };
}

/**
 * Trace path from arrow at (x,y). Does not mutate.
 * Returns 'clear' if it exits the board without hitting arrow/wall,
 * 'collision' if next cell is an arrow, 'wall' if next cell is a wall,
 * 'invalid' if no arrow there.
 */
export function traceFire(
  state: GameState,
  x: number,
  y: number,
): { result: 'clear' | 'collision' | 'wall' | 'invalid'; path: { x: number; y: number }[] } {
  if (!inBounds(x, y, state.w, state.h)) {
    return { result: 'invalid', path: [] };
  }
  const start = state.cells[idx(x, y, state.w)]!;
  if (start.kind !== 'arrow') {
    return { result: 'invalid', path: [] };
  }
  const dir: Dir = start.dir;
  const { dx, dy } = DIR_DELTA[dir];
  const path: { x: number; y: number }[] = [{ x, y }];
  let cx = x + dx;
  let cy = y + dy;
  while (true) {
    if (!inBounds(cx, cy, state.w, state.h)) {
      return { result: 'clear', path };
    }
    path.push({ x: cx, y: cy });
    const cell = state.cells[idx(cx, cy, state.w)]!;
    if (cell.kind === 'arrow') {
      return { result: 'collision', path };
    }
    if (cell.kind === 'wall') {
      return { result: 'wall', path };
    }
    // empty — continue
    cx += dx;
    cy += dy;
  }
}

export type FireResult =
  | { ok: true; state: GameState; won: boolean }
  | { ok: false; state: GameState; reason: 'invalid' | 'collision' | 'wall' | 'not-playing' };

/**
 * Fire arrow at (x,y). On clear: remove it. On collision/wall: mark failed.
 * Empty cells are passable. Starting cell is only cleared on successful exit.
 */
export function fireArrow(state: GameState, x: number, y: number): FireResult {
  if (state.status !== 'playing') {
    return { ok: false, state, reason: 'not-playing' };
  }
  const traced = traceFire(state, x, y);
  if (traced.result === 'invalid') {
    return { ok: false, state, reason: 'invalid' };
  }
  if (traced.result === 'collision' || traced.result === 'wall') {
    const failed = cloneState(state);
    failed.status = 'failed';
    failed.failReason = traced.result;
    return { ok: false, state: failed, reason: traced.result };
  }
  // clear — remove arrow from start
  const next = cloneState(state);
  next.cells[idx(x, y, next.w)] = { kind: 'empty' };
  next.arrowsRemaining = countArrows(next.cells);
  if (next.arrowsRemaining === 0) {
    next.status = 'won';
    return { ok: true, state: next, won: true };
  }
  return { ok: true, state: next, won: false };
}

/** List arrows that currently have a clear exit path (safe one-step hint). */
export function findSafeHints(state: GameState): { x: number; y: number }[] {
  if (state.status !== 'playing') return [];
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) {
      const c = state.cells[idx(x, y, state.w)]!;
      if (c.kind !== 'arrow') continue;
      if (traceFire(state, x, y).result === 'clear') {
        out.push({ x, y });
      }
    }
  }
  return out;
}

/**
 * Backtracking solver — returns a sequence of {x,y} fires that clears the board, or null.
 * Suitable for small levels (≤ ~12 arrows).
 */
export function solve(state: GameState, maxDepth = 24): { x: number; y: number }[] | null {
  if (state.status === 'won' || state.arrowsRemaining === 0) return [];
  if (state.status !== 'playing') return null;

  function dfs(s: GameState, depth: number): { x: number; y: number }[] | null {
    if (s.arrowsRemaining === 0) return [];
    if (depth > maxDepth) return null;
    const candidates: { x: number; y: number }[] = [];
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        if (s.cells[idx(x, y, s.w)]!.kind === 'arrow') {
          candidates.push({ x, y });
        }
      }
    }
    // Prefer currently-safe exits first (heuristic)
    candidates.sort((a, b) => {
      const sa = traceFire(s, a.x, a.y).result === 'clear' ? 0 : 1;
      const sb = traceFire(s, b.x, b.y).result === 'clear' ? 0 : 1;
      return sa - sb;
    });
    for (const c of candidates) {
      const r = fireArrow(s, c.x, c.y);
      if (!r.ok) continue;
      const rest = dfs(r.state, depth + 1);
      if (rest) return [c, ...rest];
    }
    return null;
  }
  return dfs(state, 0);
}

export class Engine {
  private state: GameState;
  private history: GameState[] = [];
  private readonly level: LevelDef;

  static fromSnapshot(level: LevelDef, value: unknown): Engine | null {
    if (!isRecord(value) || !Array.isArray(value.history)) return null;
    const state = normalizeStateForLevel(level, value.state);
    const initialArrowCount = countArrows(levelToBoard(level));
    if (
      !state ||
      value.history.length > initialArrowCount ||
      (state.status === 'failed' && value.history.length === 0)
    ) {
      return null;
    }
    const history: GameState[] = [];
    for (const item of value.history) {
      const previous = normalizeStateForLevel(level, item);
      if (!previous || previous.status !== 'playing') return null;
      history.push(previous);
    }
    const timeline = [...history, state];
    for (let i = 1; i < timeline.length; i++) {
      const previous = timeline[i - 1]!;
      const next = timeline[i]!;
      const undoDelta = previous.undosLeft - next.undosLeft;
      const clearedDelta = previous.arrowsRemaining - next.arrowsRemaining;
      if (
        undoDelta < 0 ||
        undoDelta > 1 ||
        (clearedDelta !== 1 && clearedDelta !== 0) ||
        (clearedDelta === 0 && next.status !== 'failed') ||
        (clearedDelta === 1 && next.status !== 'playing')
      ) {
        return null;
      }
    }
    const engine = new Engine(level);
    engine.state = state;
    engine.history = history;
    return engine;
  }

  constructor(level: LevelDef) {
    this.level = level;
    this.state = createState(level);
  }

  getState(): GameState {
    return this.state;
  }

  getLevel(): LevelDef {
    return this.level;
  }

  getSnapshot(): EngineSnapshot {
    return {
      state: cloneState(this.state),
      history: this.history.map(cloneState),
    };
  }

  isPristine(): boolean {
    const initial = createState(this.level);
    return (
      this.history.length === 0 &&
      this.state.status === 'playing' &&
      this.state.undosLeft === FREE_UNDOS &&
      this.state.cells.every((cell, index) => {
        const original = initial.cells[index]!;
        return cell.kind === original.kind &&
          (cell.kind !== 'arrow' || (original.kind === 'arrow' && cell.dir === original.dir));
      })
    );
  }

  restart(): void {
    this.state = createState(this.level);
    this.history = [];
  }

  fire(x: number, y: number): FireResult {
    const before = cloneState(this.state);
    const result = fireArrow(this.state, x, y);
    if (result.ok || (result.reason !== 'invalid' && result.reason !== 'not-playing')) {
      // Push history for successful clear OR fail (so undo can recover from fail)
      if (before.status === 'playing') {
        this.history.push(before);
        this.state = result.state;
      }
    }
    return result;
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  /**
   * Undo last fire. Consumes a free undo if undosLeft > 0.
   * If undosLeft === 0, caller should offer rewarded ad then call undo(true).
   */
  undo(forceExtra = false): boolean {
    if (this.history.length === 0) return false;
    if (this.state.undosLeft <= 0 && !forceExtra) return false;
    const prev = this.history.pop()!;
    const undosLeft =
      forceExtra && this.state.undosLeft <= 0
        ? this.state.undosLeft
        : Math.max(0, this.state.undosLeft - 1);
    this.state = { ...prev, undosLeft };
    return true;
  }

  hint(): { x: number; y: number } | null {
    const safe = findSafeHints(this.state);
    return safe[0] ?? null;
  }
}
