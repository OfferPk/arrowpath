import { describe, expect, it } from 'vitest';
import { Engine } from '../src/game/engine';
import type { LevelDef } from '../src/game/types';
import { getHudStats } from '../src/ui/hud';

const LEVEL: LevelDef = {
  id: 7,
  w: 3,
  h: 1,
  cells: [
    { x: 0, y: 0, t: 'arrow', d: 'E' },
    { x: 2, y: 0, t: 'arrow', d: 'E' },
  ],
};

const STATE = {
  levelId: 7,
  arrowsRemaining: 3,
  undosLeft: 2,
  movesMade: 4,
};

describe('gameplay HUD counters', () => {
  it('shows the campaign level and the current move count', () => {
    expect(getHudStats(STATE, 'campaign')).toEqual({
      level: '7',
      left: '3',
      undos: '2',
      moves: '4',
    });
  });

  it('keeps the Daily level marker and the same puzzle counters', () => {
    expect(getHudStats(STATE, 'daily')).toEqual({
      level: 'D7',
      left: '3',
      undos: '2',
      moves: '4',
    });
  });

  it('reflects a move and its undo in the live move counter', () => {
    const engine = new Engine(LEVEL);
    expect(getHudStats(engine.getState(), 'campaign').moves).toBe('0');

    expect(engine.fire(0, 0).ok).toBe(true);
    expect(getHudStats(engine.getState(), 'campaign').moves).toBe('1');

    expect(engine.undo()).toBe(true);
    expect(getHudStats(engine.getState(), 'campaign').moves).toBe('0');
  });
});
