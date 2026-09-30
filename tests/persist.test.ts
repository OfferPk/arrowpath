import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/game/engine';
import {
  clearActivePuzzle,
  getProgress,
  getSettings,
  loadActivePuzzle,
  saveActivePuzzle,
  type ActivePuzzleSnapshot,
} from '../src/game/persist';
import type { LevelDef } from '../src/game/types';

const PREFIX = 'arrowpath:v1:';
const ACTIVE_KEY = `${PREFIX}active-puzzle`;
const FIXTURE: LevelDef = {
  id: 9,
  w: 3,
  h: 1,
  cells: [
    { x: 0, y: 0, t: 'arrow', d: 'E' },
    { x: 2, y: 0, t: 'arrow', d: 'E' },
  ],
};

const values = new Map<string, string>();
const storage = {
  getItem(key: string): string | null {
    return values.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    values.set(key, String(value));
  },
  removeItem(key: string): void {
    values.delete(key);
  },
};

function snapshot(): ActivePuzzleSnapshot {
  const engine = new Engine(FIXTURE);
  engine.fire(2, 0);
  return {
    version: 1,
    levelId: FIXTURE.id,
    mode: 'campaign',
    dailyKey: null,
    engine: engine.getSnapshot(),
  };
}

beforeEach(() => {
  values.clear();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('active puzzle persistence', () => {
  it('round-trips a versioned active snapshot without changing progress, settings, or daily records', () => {
    values.set(`${PREFIX}progress`, JSON.stringify({ unlocked: 7, cleared: [1, 4] }));
    values.set(`${PREFIX}settings`, JSON.stringify({ muted: true, adsRemoved: false }));
    values.set(`${PREFIX}daily:2026-09-30`, JSON.stringify({ completed: false, levelId: 12 }));
    const before = new Map(values);
    const active = snapshot();

    saveActivePuzzle(active);

    expect(JSON.parse(values.get(ACTIVE_KEY)!)).toMatchObject({ version: 1, levelId: 9 });
    expect(loadActivePuzzle()).toEqual(active);
    expect(getProgress()).toEqual({ unlocked: 7, cleared: [1, 4] });
    expect(getSettings()).toEqual({ muted: true, adsRemoved: false });
    expect(values.get(`${PREFIX}daily:2026-09-30`)).toBe(before.get(`${PREFIX}daily:2026-09-30`));
  });

  it('clears only the active run when requested and preserves other saved data', () => {
    values.set(`${PREFIX}progress`, JSON.stringify({ unlocked: 5, cleared: [1, 2] }));
    values.set(`${PREFIX}settings`, JSON.stringify({ muted: true, adsRemoved: false }));
    values.set(`${PREFIX}daily:2026-09-30`, JSON.stringify({ completed: true, levelId: 4 }));
    saveActivePuzzle(snapshot());

    clearActivePuzzle();

    expect(values.has(ACTIVE_KEY)).toBe(false);
    expect(getProgress()).toEqual({ unlocked: 5, cleared: [1, 2] });
    expect(getSettings()).toEqual({ muted: true, adsRemoved: false });
    expect(values.has(`${PREFIX}daily:2026-09-30`)).toBe(true);
  });

  it('falls back safely and removes malformed JSON and unsupported snapshot versions', () => {
    values.set(ACTIVE_KEY, '{not-json');
    expect(loadActivePuzzle()).toBeNull();
    expect(values.has(ACTIVE_KEY)).toBe(false);

    values.set(ACTIVE_KEY, JSON.stringify({ ...snapshot(), version: 2 }));
    expect(loadActivePuzzle()).toBeNull();
    expect(values.has(ACTIVE_KEY)).toBe(false);
  });

  it('rejects malformed snapshot metadata instead of exposing it to the game engine', () => {
    values.set(ACTIVE_KEY, JSON.stringify({
      version: 1,
      levelId: 0,
      mode: 'campaign',
      dailyKey: null,
      engine: {},
    }));

    expect(loadActivePuzzle()).toBeNull();
    expect(values.has(ACTIVE_KEY)).toBe(false);
  });
});
