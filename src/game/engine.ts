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
