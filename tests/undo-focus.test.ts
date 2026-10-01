import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../src/game/engine';
import type { LevelDef } from '../src/game/types';
import { focusUndoCell, undoAndGetFocusIndex } from '../src/ui/undo-focus';

const BLOCKED_SLIDE: LevelDef = {
  id: 9010,
  w: 3,
  h: 1,
  cells: [
    { x: 0, y: 0, t: 'arrow', d: 'E' },
    { x: 2, y: 0, t: 'arrow', d: 'E' },
  ],
};

const CLEAR_ARROW: LevelDef = {
  id: 9011,
  w: 3,
  h: 1,
  cells: [{ x: 1, y: 0, t: 'arrow', d: 'E' }],
};

describe('keyboard focus after Undo', () => {
  it('returns the focus index to an arrow restored from a partial slide', () => {
    const engine = new Engine(BLOCKED_SLIDE);
    engine.fire(0, 0);

    expect(undoAndGetFocusIndex(engine, 1)).toBe(0);
    expect(engine.getState().cells[0]).toEqual({ kind: 'arrow', dir: 'E' });
  });

  it('identifies an arrow restored after it cleared the board', () => {
    const engine = new Engine(CLEAR_ARROW);
    engine.fire(1, 0);

    expect(undoAndGetFocusIndex(engine, 2)).toBe(1);
    expect(engine.getState().cells[1]).toEqual({ kind: 'arrow', dir: 'E' });
  });

  it('restores the arrow index after a rewarded Undo with no free undos left', () => {
    const engine = new Engine(BLOCKED_SLIDE);
    for (let i = 0; i < 3; i++) {
      expect(engine.fire(0, 0).ok).toBe(true);
      expect(engine.undo(false)).toBe(true);
    }
    expect(engine.getState().undosLeft).toBe(0);
    engine.fire(0, 0);

    expect(undoAndGetFocusIndex(engine, 1, true)).toBe(0);
    expect(engine.getState().undosLeft).toBe(0);
    expect(engine.getState().cells[0]).toEqual({ kind: 'arrow', dir: 'E' });
  });

  it('does not return a focus index when no Undo was applied', () => {
    const engine = new Engine(BLOCKED_SLIDE);

    expect(undoAndGetFocusIndex(engine, 2)).toBeNull();
  });

  it('focuses the requested rendered board cell without scrolling', () => {
    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    const boardAccess = { querySelector } as unknown as ParentNode;

    focusUndoCell(boardAccess, 4);

    expect(querySelector).toHaveBeenCalledWith('[data-cell-index="4"]');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
