import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  Engine,
  createState,
  fireArrow,
  findSafeHints,
  solve,
  traceFire,
  levelToBoard,
} from '../src/game/engine';
import type { GameState, LevelDef } from '../src/game/types';
import { FREE_UNDOS } from '../src/game/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPack(): { levels: LevelDef[] } {
  const raw = readFileSync(join(__dirname, '../public/levels.json'), 'utf8');
  return JSON.parse(raw) as { levels: LevelDef[] };
}

function shortestSolutionDepth(level: LevelDef): number | null {
  const start = createState(level);
  const key = (state: GameState) =>
    state.cells.map((cell) => (cell.kind === 'arrow' ? '1' : '0')).join('');
  const queue: { state: GameState; depth: number }[] = [{ state: start, depth: 0 }];
  const seen = new Set([key(start)]);

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { state, depth } = queue[cursor]!;
    if (state.status === 'won') return depth;
    for (let i = 0; i < state.cells.length; i++) {
      if (state.cells[i]!.kind !== 'arrow') continue;
      const result = fireArrow(state, i % state.w, Math.floor(i / state.w));
      if (!result.ok) continue;
      const nextKey = key(result.state);
      if (seen.has(nextKey)) continue;
      seen.add(nextKey);
      queue.push({ state: result.state, depth: depth + 1 });
    }
  }
  return null;
}

/** Two east-facing arrows: the left one can slide up to the other. */
const FIXTURE: LevelDef = {
  id: 9001,
  w: 3,
  h: 1,
  cells: [
    { x: 0, y: 0, t: 'arrow', d: 'E' },
    { x: 2, y: 0, t: 'arrow', d: 'E' },
  ],
};

function cellIndex(state: GameState, x: number, y: number): number {
  return y * state.w + x;
}

describe('traceFire / fixed-direction slide rules', () => {
  it('traces a clear ray through empty cells and identifies the off-board exit', () => {
    const level: LevelDef = {
      id: 1,
      w: 4,
      h: 1,
      cells: [{ x: 1, y: 0, t: 'arrow', d: 'E' }],
    };
    const trace = traceFire(createState(level), 1, 0);
    expect(trace.result).toBe('clear');
    expect(trace.path).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
    expect(trace.exitCell).toEqual({ x: 4, y: 0 });
    expect(trace.blocker).toBeNull();
  });

  it('stops the traced path immediately before another arrow', () => {
    const trace = traceFire(createState(FIXTURE), 0, 0);
    expect(trace.result).toBe('collision');
    expect(trace.path).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    expect(trace.blocker).toEqual({ x: 2, y: 0 });
    expect(trace.exitCell).toBeNull();
  });

  it('stops before a permanent wall and never includes the wall in its path', () => {
    const level: LevelDef = {
      id: 2,
      w: 4,
      h: 1,
      cells: [
        { x: 0, y: 0, t: 'arrow', d: 'E' },
        { x: 2, y: 0, t: 'wall' },
      ],
    };
    const trace = traceFire(createState(level), 0, 0);
    expect(trace.result).toBe('wall');
    expect(trace.path).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    expect(trace.blocker).toEqual({ x: 2, y: 0 });
  });

  it('keeps each arrow facing the same direction and supports all four exits', () => {
    const level: LevelDef = {
      id: 3,
      w: 3,
      h: 3,
      cells: [
        { x: 1, y: 0, t: 'arrow', d: 'N' },
        { x: 2, y: 1, t: 'arrow', d: 'E' },
        { x: 1, y: 2, t: 'arrow', d: 'S' },
        { x: 0, y: 1, t: 'arrow', d: 'W' },
      ],
    };
    let state = createState(level);
    for (const point of [{ x: 1, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 1 }]) {
      const result = fireArrow(state, point.x, point.y);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.exited).toBe(true);
      expect(result.state.movesMade).toBe(state.movesMade + 1);
      expect(result.state.arrowsRemaining).toBe(state.arrowsRemaining - 1);
      state = result.state;
    }
    expect(state.status).toBe('won');
    expect(state.arrowsRemaining).toBe(0);
    expect(state.movesMade).toBe(4);
  });

  it('rejects a tap on an empty cell', () => {
    const result = fireArrow(createState(FIXTURE), 1, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });
});

describe('blocked movement', () => {
  it('slides to the last free cell before another arrow and retains the arrow direction', () => {
    const result = fireArrow(createState(FIXTURE), 0, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.exited).toBe(false);
    expect(result.blockedBy).toBe('collision');
    expect(result.state.status).toBe('playing');
    expect(result.state.arrowsRemaining).toBe(2);
    expect(result.state.movesMade).toBe(1);
    expect(result.state.cells[cellIndex(result.state, 0, 0)]).toEqual({ kind: 'empty' });
    expect(result.state.cells[cellIndex(result.state, 1, 0)]).toEqual({ kind: 'arrow', dir: 'E' });
    expect(result.state.cells[cellIndex(result.state, 2, 0)]).toEqual({ kind: 'arrow', dir: 'E' });
  });

  it('does not count or save history when a blocker is immediately adjacent', () => {
    const level: LevelDef = {
      id: 4,
      w: 2,
      h: 1,
      cells: [
        { x: 0, y: 0, t: 'arrow', d: 'E' },
        { x: 1, y: 0, t: 'arrow', d: 'E' },
      ],
    };
    const engine = new Engine(level);
    const before = engine.getState();
    const result = engine.fire(0, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('collision');
    expect(engine.getState()).toEqual(before);
    expect(engine.getState().movesMade).toBe(0);
    expect(engine.canUndo()).toBe(false);
  });

  it('slides up to a wall without entering it or failing the level', () => {
    const level: LevelDef = {
      id: 5,
      w: 4,
      h: 1,
      cells: [
        { x: 0, y: 0, t: 'arrow', d: 'E' },
        { x: 2, y: 0, t: 'wall' },
      ],
    };
    const result = fireArrow(createState(level), 0, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('playing');
    expect(result.state.movesMade).toBe(1);
    expect(result.state.cells[cellIndex(result.state, 1, 0)]).toEqual({ kind: 'arrow', dir: 'E' });
    expect(result.state.cells[cellIndex(result.state, 2, 0)]).toEqual({ kind: 'wall' });
  });

  it('can slide again after the arrow that blocked it leaves', () => {
    const engine = new Engine(FIXTURE);
    engine.fire(0, 0);
    expect(engine.getState().cells[cellIndex(engine.getState(), 1, 0)]).toEqual({ kind: 'arrow', dir: 'E' });
    engine.fire(2, 0);
    const result = engine.fire(1, 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exited).toBe(true);
      expect(result.state.status).toBe('won');
      expect(result.state.movesMade).toBe(3);
    }
  });
});

describe('solved fixture', () => {
  it('solves FIXTURE by exiting the right arrow then the left arrow', () => {
    let state = createState(FIXTURE);
    const first = fireArrow(state, 2, 0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;
    const second = fireArrow(state, 0, 0);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.won).toBe(true);
      expect(second.state.status).toBe('won');
    }
  });

  it('solver finds a solution for FIXTURE', () => {
    const solution = solve(createState(FIXTURE));
    expect(solution).not.toBeNull();
    expect(solution!.length).toBe(2);
    let state = createState(FIXTURE);
    for (const step of solution!) {
      const result = fireArrow(state, step.x, step.y);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      state = result.state;
    }
    expect(state.status).toBe('won');
  });
});

describe('undo and retry state', () => {
  it('undo restores the exact position, remaining count, move count, and consumes one undo', () => {
    const engine = new Engine(FIXTURE);
    expect(engine.getState().undosLeft).toBe(FREE_UNDOS);
    engine.fire(0, 0);
    expect(engine.getState().movesMade).toBe(1);
    expect(engine.getState().arrowsRemaining).toBe(2);
    expect(engine.getState().cells[cellIndex(engine.getState(), 1, 0)]).toEqual({ kind: 'arrow', dir: 'E' });
    expect(engine.canUndo()).toBe(true);
    expect(engine.undo(false)).toBe(true);
    expect(engine.getState().arrowsRemaining).toBe(2);
    expect(engine.getState().movesMade).toBe(0);
    expect(engine.getState().status).toBe('playing');
    expect(engine.getState().cells[cellIndex(engine.getState(), 0, 0)]).toEqual({ kind: 'arrow', dir: 'E' });
    expect(engine.getState().undosLeft).toBe(FREE_UNDOS - 1);
  });

  it('supports multiple undos and blocks extra undo unless forceExtra is granted', () => {
    const engine = new Engine(FIXTURE);
    engine.fire(0, 0);
    engine.fire(2, 0);
    for (let i = 0; i < FREE_UNDOS; i++) {
      expect(engine.undo(false)).toBe(true);
      engine.fire(2, 0);
    }
    expect(engine.getState().undosLeft).toBe(0);
    expect(engine.undo(false)).toBe(false);
    expect(engine.undo(true)).toBe(true);
  });

  it('retry restores the exact level starting layout, counters, and obstacles', () => {
    const level: LevelDef = {
      id: 6,
      w: 4,
      h: 1,
      cells: [
        { x: 0, y: 0, t: 'arrow', d: 'E' },
        { x: 2, y: 0, t: 'wall' },
      ],
    };
    const engine = new Engine(level);
    engine.fire(0, 0);
    engine.restart();
    expect(engine.getState()).toEqual(createState(level));
    expect(engine.canUndo()).toBe(false);
  });
});

describe('engine snapshots', () => {
  it('restores a partial slide and its undo history exactly', () => {
    const original = new Engine(FIXTURE);
    original.fire(0, 0);
    const saved = original.getSnapshot();
    const restored = Engine.fromSnapshot(FIXTURE, saved);

    expect(restored).not.toBeNull();
    expect(restored!.getState()).toEqual(original.getState());
    expect(restored!.canUndo()).toBe(true);
    expect(restored!.undo(false)).toBe(true);
    expect(restored!.getState().cells[cellIndex(restored!.getState(), 0, 0)]).toEqual({ kind: 'arrow', dir: 'E' });
    expect(restored!.getState().arrowsRemaining).toBe(2);
    expect(restored!.getState().movesMade).toBe(0);
    expect(restored!.getState().undosLeft).toBe(FREE_UNDOS - 1);
    expect(original.getState().arrowsRemaining).toBe(2);
  });

  it('accepts older version-one snapshots that predate movesMade', () => {
    const original = new Engine(FIXTURE);
    original.fire(0, 0);
    const legacy = structuredClone(original.getSnapshot()) as {
      state: Record<string, unknown>;
      history: Record<string, unknown>[];
    };
    delete legacy.state.movesMade;
    for (const previous of legacy.history) delete previous.movesMade;
    const restored = Engine.fromSnapshot(FIXTURE, legacy);
    expect(restored?.getState().movesMade).toBe(1);
    expect(restored?.undo(false)).toBe(true);
    expect(restored?.getState().movesMade).toBe(0);
  });

  it('rejects mismatched, corrupt, and impossible history snapshots', () => {
    const original = new Engine(FIXTURE);
    original.fire(0, 0);
    const saved = original.getSnapshot();
    const corruptBoard = structuredClone(saved);
    corruptBoard.state.cells[0] = { kind: 'wall' };
    const badCounter = structuredClone(saved);
    badCounter.state.arrowsRemaining = 9;
    const badMoves = structuredClone(saved);
    badMoves.state.movesMade = -1;
    const impossibleHistory = structuredClone(saved);
    impossibleHistory.history[0]!.cells[0] = { kind: 'empty' };
    const solved = structuredClone(saved);
    solved.state.arrowsRemaining = 0;
    solved.state.cells[0] = { kind: 'empty' };
    solved.state.cells[1] = { kind: 'empty' };

    expect(Engine.fromSnapshot({ ...FIXTURE, id: FIXTURE.id + 1 }, saved)).toBeNull();
    expect(Engine.fromSnapshot(FIXTURE, corruptBoard)).toBeNull();
    expect(Engine.fromSnapshot(FIXTURE, badCounter)).toBeNull();
    expect(Engine.fromSnapshot(FIXTURE, badMoves)).toBeNull();
    expect(Engine.fromSnapshot(FIXTURE, impossibleHistory)).toBeNull();
    expect(Engine.fromSnapshot(FIXTURE, solved)).toBeNull();
  });

  it('detects a pristine state separately from a board returned by undo', () => {
    const engine = new Engine(FIXTURE);
    expect(engine.isPristine()).toBe(true);
    engine.fire(0, 0);
    engine.undo(false);
    expect(engine.isPristine()).toBe(false);
  });
});

describe('hint safety', () => {
  it('lists only arrows with a clear exit path', () => {
    const hints = findSafeHints(createState(FIXTURE));
    expect(hints).toEqual([{ x: 2, y: 0 }]);
  });
});

describe('level pack load', () => {
  it('has exactly 50 levels', () => {
    const pack = loadPack();
    expect(pack.levels.length).toBe(50);
    expect(pack.levels[0]!.id).toBe(1);
    expect(pack.levels[49]!.id).toBe(50);
  });

  it('first 10 levels are solvable', () => {
    const pack = loadPack();
    for (const level of pack.levels.slice(0, 10)) {
      const solution = solve(createState(level), 32);
      expect(solution, `level ${level.id} unsolvable`).not.toBeNull();
      let state = createState(level);
      for (const step of solution!) {
        const result = fireArrow(state, step.x, step.y);
        expect(result.ok, `level ${level.id} move failed at ${step.x},${step.y}`).toBe(true);
        if (!result.ok) return;
        state = result.state;
      }
      expect(state.status).toBe('won');
    }
  });

  it('keeps every level solvable at exact minimum depth and preserves the tutorial ramp', () => {
    const depths = loadPack().levels.map((level) => {
      const depth = shortestSolutionDepth(level);
      expect(depth, `level ${level.id} unsolvable`).not.toBeNull();
      expect(depth, `level ${level.id} must clear one arrow per move`).toBe(
        level.cells.filter((cell) => cell.t === 'arrow').length,
      );
      return depth;
    });
    expect(depths.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('levelToBoard places walls and arrows', () => {
    const level = loadPack().levels.find((item) => item.id === 6)!;
    const board = levelToBoard(level);
    expect(board.some((cell) => cell.kind === 'wall')).toBe(true);
    expect(board.some((cell) => cell.kind === 'arrow')).toBe(true);
  });
});
