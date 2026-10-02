import { describe, expect, it } from 'vitest';
import { createState } from '../src/game/engine';
import type { LevelDef } from '../src/game/types';
import {
  describeBoard,
  describeBoardCell,
  describeUndoResult,
} from '../src/ui/accessibility';

const LEVEL: LevelDef = {
  id: 7,
  w: 3,
  h: 2,
  cells: [
    { x: 0, y: 0, t: 'arrow', d: 'E' },
    { x: 2, y: 0, t: 'arrow', d: 'E' },
    { x: 1, y: 1, t: 'wall' },
  ],
};

describe('spoken puzzle board descriptions', () => {
  const state = createState(LEVEL);

  it('announces arrow direction and the position of an arrow blocking its path', () => {
    expect(describeBoardCell(state, 0, 0)).toBe(
      'Row 1, column 1: arrow pointing east. Path is blocked by another arrow at row 1, column 3; the arrow can slide to row 1, column 2.',
    );
  });

  it('announces clear paths, empty cells, and walls with row and column positions', () => {
    expect(describeBoardCell(state, 2, 0)).toBe(
      'Row 1, column 3: arrow pointing east. Path is clear to the board edge.',
    );
    expect(describeBoardCell(state, 0, 1)).toBe('Row 2, column 1: empty.');
    expect(describeBoardCell(state, 1, 1)).toBe('Row 2, column 2: wall.');
  });

  it('announces the wall that blocks an arrow path', () => {
    const wallLevel: LevelDef = {
      id: 8,
      w: 1,
      h: 2,
      cells: [
        { x: 0, y: 0, t: 'arrow', d: 'S' },
        { x: 0, y: 1, t: 'wall' },
      ],
    };
    expect(describeBoardCell(createState(wallLevel), 0, 0)).toBe(
      'Row 1, column 1: arrow pointing south. Cannot move; wall is immediately ahead at row 2, column 1.',
    );
  });

  it('summarizes board dimensions and remaining piece counts', () => {
    expect(describeBoard(state)).toContain('Level 7 puzzle board. 2 rows by 3 columns.');
    expect(describeBoard(state)).toContain('2 arrows remaining; 1 wall.');
    expect(describeBoard(state)).toContain('arrow keys');
  });

  it('confirms an undo before summarizing the restored board', () => {
    expect(describeUndoResult(state)).toBe(
      'Undo complete. Level 7 puzzle board. 2 rows by 3 columns. 2 arrows remaining; 1 wall. Use the arrow keys to move between cells. Press Enter or Space to fire an arrow.',
    );
  });
});
