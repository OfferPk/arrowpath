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
import type { LevelDef } from '../src/game/types';
import { FREE_UNDOS } from '../src/game/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPack(): { levels: LevelDef[] } {
  const raw = readFileSync(join(__dirname, '../public/levels.json'), 'utf8');
  return JSON.parse(raw) as { levels: LevelDef[] };
}

/** Tiny hand fixture: two arrows; east must clear first. */
const FIXTURE: LevelDef = {
  id: 9001,
  w: 3,
  h: 1,
  cells: [
    { x: 0, y: 0, t: 'arrow', d: 'E' },
    { x: 2, y: 0, t: 'arrow', d: 'E' },
  ],
};

describe('traceFire / move rules', () => {
  it('clears when path exits board through empty cells', () => {
    const level: LevelDef = {
      id: 1,
      w: 3,
      h: 3,
      cells: [{ x: 1, y: 1, t: 'arrow', d: 'E' }],
    };
    const state = createState(level);
    const t = traceFire(state, 1, 1);
    expect(t.result).toBe('clear');
    const r = fireArrow(state, 1, 1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.won).toBe(true);
      expect(r.state.arrowsRemaining).toBe(0);
      expect(r.state.status).toBe('won');
    }
  });

  it('collision when next cell has another arrow', () => {
    const state = createState(FIXTURE);
    // left arrow faces E — next empty then hits right arrow? path: (0,0)->(1,0) empty ->(2,0) arrow
    const t = traceFire(state, 0, 0);
    expect(t.result).toBe('collision');
    const r = fireArrow(state, 0, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('collision');
      expect(r.state.status).toBe('failed');
    }
  });

  it('right arrow in fixture clears off-board', () => {
    const state = createState(FIXTURE);
    const t = traceFire(state, 2, 0);
    expect(t.result).toBe('clear');
    const r = fireArrow(state, 2, 0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.won).toBe(false);
      expect(r.state.arrowsRemaining).toBe(1);
    }
  });

  it('wall blocks path → fail', () => {
    const level: LevelDef = {
      id: 2,
      w: 4,
      h: 1,
      cells: [
        { x: 0, y: 0, t: 'arrow', d: 'E' },
        { x: 2, y: 0, t: 'wall' },
      ],
    };
    const state = createState(level);
    expect(traceFire(state, 0, 0).result).toBe('wall');
    const r = fireArrow(state, 0, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wall');
  });

  it('empty cells are passable', () => {
    const level: LevelDef = {
      id: 3,
      w: 5,
      h: 1,
      cells: [{ x: 0, y: 0, t: 'arrow', d: 'E' }],
    };
    expect(traceFire(createState(level), 0, 0).result).toBe('clear');
  });

  it('invalid tap on empty cell', () => {
    const state = createState(FIXTURE);
    const r = fireArrow(state, 1, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid');
  });
});

describe('solved fixture', () => {
  it('solves FIXTURE by firing right then left', () => {
    let state = createState(FIXTURE);
    const a = fireArrow(state, 2, 0);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    state = a.state;
    const b = fireArrow(state, 0, 0);
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.won).toBe(true);
      expect(b.state.status).toBe('won');
    }
  });

  it('solver finds a solution for FIXTURE', () => {
    const sol = solve(createState(FIXTURE));
    expect(sol).not.toBeNull();
    expect(sol!.length).toBe(2);
    let s = createState(FIXTURE);
    for (const step of sol!) {
      const r = fireArrow(s, step.x, step.y);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.state;
    }
    expect(s.status).toBe('won');
  });
});

describe('undo', () => {
  it('restores previous board and consumes free undo', () => {
    const eng = new Engine(FIXTURE);
    expect(eng.getState().undosLeft).toBe(FREE_UNDOS);
    eng.fire(2, 0);
    expect(eng.getState().arrowsRemaining).toBe(1);
    expect(eng.canUndo()).toBe(true);
    const ok = eng.undo(false);
    expect(ok).toBe(true);
    expect(eng.getState().arrowsRemaining).toBe(2);
    expect(eng.getState().status).toBe('playing');
    expect(eng.getState().undosLeft).toBe(FREE_UNDOS - 1);
  });

  it('blocks undo when free undos exhausted unless forceExtra', () => {
    const eng = new Engine(FIXTURE);
    eng.fire(2, 0);
    // burn undos artificially
    for (let i = 0; i < FREE_UNDOS; i++) {
      expect(eng.undo(false)).toBe(true);
      eng.fire(2, 0);
    }
    expect(eng.getState().undosLeft).toBe(0);
    expect(eng.undo(false)).toBe(false);
    expect(eng.undo(true)).toBe(true);
  });

  it('undo recovers from failed collision', () => {
    const eng = new Engine(FIXTURE);
    eng.fire(0, 0); // collision fail
    expect(eng.getState().status).toBe('failed');
    eng.undo(false);
    expect(eng.getState().status).toBe('playing');
    expect(eng.getState().arrowsRemaining).toBe(2);
  });
});

describe('hint safety', () => {
  it('lists only arrows with clear exit', () => {
    const state = createState(FIXTURE);
    const hints = findSafeHints(state);
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
      const sol = solve(createState(level), 32);
      expect(sol, `level ${level.id} unsolvable`).not.toBeNull();
      let s = createState(level);
      for (const step of sol!) {
        const r = fireArrow(s, step.x, step.y);
        expect(r.ok, `level ${level.id} fire failed at ${step.x},${step.y}`).toBe(true);
        if (!r.ok) return;
        s = r.state;
      }
      expect(s.status).toBe('won');
    }
  });

  it('levelToBoard places walls and arrows', () => {
    const level = loadPack().levels.find((l) => l.id === 6)!;
    const board = levelToBoard(level);
    expect(board.some((c) => c.kind === 'wall')).toBe(true);
    expect(board.some((c) => c.kind === 'arrow')).toBe(true);
  });
});
