import {
  DIR_DELTA,
  FREE_UNDOS,
  type BoardCell,
  type Dir,
  type GameState,
  type LevelDef,
} from './types';

export interface BoardPosition {
  x: number;
  y: number;
}

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
    movesMade: 0,
  };
}

export interface EngineSnapshot {
  state: GameState;
  history: GameState[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function directionCounts(cells: BoardCell[]): Record<Dir, number> {
  const counts: Record<Dir, number> = { N: 0, E: 0, S: 0, W: 0 };
  for (const cell of cells) {
    if (cell.kind === 'arrow') counts[cell.dir] += 1;
  }
  return counts;
}

function normalizeStateForLevel(
  level: LevelDef,
  value: unknown,
  legacyMovesMade = 0,
): GameState | null {
  if (!isRecord(value)) return null;
  const candidate = value as unknown as GameState;
  const candidateMoves = (value as Record<string, unknown>).movesMade;
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
    !Number.isInteger(candidate.arrowsRemaining) ||
    (candidateMoves !== undefined &&
      (!Number.isInteger(candidateMoves) || (candidateMoves as number) < 0))
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
  const initialDirections = directionCounts(initial);
  const currentDirections: Record<Dir, number> = { N: 0, E: 0, S: 0, W: 0 };
  const cells: BoardCell[] = [];
  for (let i = 0; i < candidate.cells.length; i++) {
    const cell = candidate.cells[i];
    const original = initial[i]!;
    if (!isRecord(cell)) return null;
    if (original.kind === 'wall') {
      if (cell.kind !== 'wall') return null;
      cells.push({ kind: 'wall' });
    } else if (cell.kind === 'wall') {
      return null;
    } else if (cell.kind === 'empty') {
      cells.push({ kind: 'empty' });
    } else if (
      cell.kind === 'arrow' &&
      (cell.dir === 'N' || cell.dir === 'E' || cell.dir === 'S' || cell.dir === 'W')
    ) {
      currentDirections[cell.dir] += 1;
      if (currentDirections[cell.dir] > initialDirections[cell.dir]) return null;
      cells.push({ kind: 'arrow', dir: cell.dir });
    } else {
      return null;
    }
  }

  const arrowsRemaining = countArrows(cells);
  const initialArrowCount = countArrows(initial);
  if (
    candidate.arrowsRemaining !== arrowsRemaining ||
    arrowsRemaining === 0 ||
    arrowsRemaining > initialArrowCount
  ) {
    return null;
  }
  const movesMade = candidateMoves === undefined ? legacyMovesMade : (candidateMoves as number);
  const state: GameState = {
    levelId: level.id,
    w: level.w,
    h: level.h,
    cells,
    status: candidate.status,
    undosLeft: candidate.undosLeft,
    arrowsRemaining,
    movesMade,
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
 * Trace the arrow's fixed-direction path without changing state. The path
 * includes the source and only traversable in-bounds cells. When blocked,
 * `blocker` identifies the occupied cell and the path's last cell is the
 * arrow's legal stopping position. When clear, `exitCell` is the first
 * off-board cell the arrow travels through while leaving the board.
 */
export function traceFire(
  state: GameState,
  x: number,
  y: number,
): {
  result: 'clear' | 'collision' | 'wall' | 'invalid';
  path: BoardPosition[];
  blocker: BoardPosition | null;
  exitCell: BoardPosition | null;
} {
  if (!inBounds(x, y, state.w, state.h)) {
    return { result: 'invalid', path: [], blocker: null, exitCell: null };
  }
  const start = state.cells[idx(x, y, state.w)]!;
  if (start.kind !== 'arrow') {
    return { result: 'invalid', path: [], blocker: null, exitCell: null };
  }
  const { dx, dy } = DIR_DELTA[start.dir];
  const path: BoardPosition[] = [{ x, y }];
  let cx = x + dx;
  let cy = y + dy;
  while (true) {
    if (!inBounds(cx, cy, state.w, state.h)) {
      return {
        result: 'clear',
        path,
        blocker: null,
        exitCell: { x: cx, y: cy },
      };
    }
    const cell = state.cells[idx(cx, cy, state.w)]!;
    if (cell.kind === 'arrow') {
      return {
        result: 'collision',
        path,
        blocker: { x: cx, y: cy },
        exitCell: null,
      };
    }
    if (cell.kind === 'wall') {
      return {
        result: 'wall',
        path,
        blocker: { x: cx, y: cy },
        exitCell: null,
      };
    }
    path.push({ x: cx, y: cy });
    cx += dx;
    cy += dy;
  }
}

export type FireResult =
  | {
      ok: true;
      state: GameState;
      won: boolean;
      exited: boolean;
      blockedBy: 'collision' | 'wall' | null;
      trace: ReturnType<typeof traceFire>;
    }
  | {
      ok: false;
      state: GameState;
      reason: 'invalid' | 'collision' | 'wall' | 'not-playing';
      trace?: ReturnType<typeof traceFire>;
    };

/** Attempt to slide an arrow along its fixed ray, stopping before any blocker. */
export function fireArrow(state: GameState, x: number, y: number): FireResult {
  if (state.status !== 'playing') {
    return { ok: false, state, reason: 'not-playing' };
  }
  const traced = traceFire(state, x, y);
  if (traced.result === 'invalid') {
    return { ok: false, state, reason: 'invalid' };
  }

  const startIndex = idx(x, y, state.w);
  const start = state.cells[startIndex]!;
  if (start.kind !== 'arrow') {
    return { ok: false, state, reason: 'invalid' };
  }

  if (traced.result === 'collision' || traced.result === 'wall') {
    // The path has only the source when the obstacle is adjacent. No movement
    // means no history entry and no move-counter change.
    if (traced.path.length === 1) {
      return { ok: false, state, reason: traced.result, trace: traced };
    }
    const destination = traced.path[traced.path.length - 1]!;
    const next = cloneState(state);
    next.cells[startIndex] = { kind: 'empty' };
    next.cells[idx(destination.x, destination.y, next.w)] = {
      kind: 'arrow',
      dir: start.dir,
    };
    next.movesMade += 1;
    return {
      ok: true,
      state: next,
      won: false,
      exited: false,
      blockedBy: traced.result,
      trace: traced,
    };
  }

  const next = cloneState(state);
  next.cells[startIndex] = { kind: 'empty' };
  next.arrowsRemaining = countArrows(next.cells);
  next.movesMade += 1;
  if (next.arrowsRemaining === 0) {
    next.status = 'won';
    return {
      ok: true,
      state: next,
      won: true,
      exited: true,
      blockedBy: null,
      trace: traced,
    };
  }
  return {
    ok: true,
    state: next,
    won: false,
    exited: true,
    blockedBy: null,
    trace: traced,
  };
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
    const initialArrowCount = countArrows(levelToBoard(level));
    const maxHistory = initialArrowCount * (initialArrowCount + 1);
    const state = normalizeStateForLevel(level, value.state, value.history.length);
    if (
      !state ||
      value.history.length > maxHistory ||
      (state.status === 'failed' && value.history.length === 0)
    ) {
      return null;
    }
    const history: GameState[] = [];
    for (let i = 0; i < value.history.length; i++) {
      const previous = normalizeStateForLevel(level, value.history[i], i);
      if (!previous || previous.status !== 'playing') return null;
      history.push(previous);
    }
    const timeline = [...history, state];
    for (let i = 1; i < timeline.length; i++) {
      const previous = timeline[i - 1]!;
      const next = timeline[i]!;
      const undoDelta = previous.undosLeft - next.undosLeft;
      const clearedDelta = previous.arrowsRemaining - next.arrowsRemaining;
      const moveDelta = next.movesMade - previous.movesMade;
      const boardChanged = previous.cells.some(
        (cell, index) =>
          cell.kind !== next.cells[index]!.kind ||
          (cell.kind === 'arrow' &&
            next.cells[index]!.kind === 'arrow' &&
            cell.dir !== next.cells[index]!.dir),
      );
      if (
        undoDelta < 0 ||
        undoDelta > 1 ||
        (clearedDelta !== 1 && clearedDelta !== 0) ||
        moveDelta !== 1 ||
        (clearedDelta === 0 && next.status !== 'playing' && next.status !== 'failed') ||
        (clearedDelta === 0 && next.status === 'playing' && !boardChanged) ||
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
      this.state.movesMade === 0 &&
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
    if (result.ok) {
      this.history.push(before);
      this.state = result.state;
    }
    return result;
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  /**
   * Undo the last actual movement and restore the exact board and move count.
   * Consumes a free undo if available; callers may use forceExtra after reward.
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
