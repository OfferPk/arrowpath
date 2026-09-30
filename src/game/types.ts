/** Direction an arrow faces / travels. */
export type Dir = 'N' | 'E' | 'S' | 'W';

export type CellType = 'arrow' | 'wall';

export interface LevelCell {
  x: number;
  y: number;
  t: CellType;
  d?: Dir;
}

export interface LevelDef {
  id: number;
  w: number;
  h: number;
  cells: LevelCell[];
}

/** Runtime board cell. */
export type BoardCell =
  | { kind: 'empty' }
  | { kind: 'wall' }
  | { kind: 'arrow'; dir: Dir };

export type Status = 'playing' | 'won' | 'failed';

export interface GameState {
  levelId: number;
  w: number;
  h: number;
  /** row-major: index = y * w + x */
  cells: BoardCell[];
  status: Status;
  /** Remaining free undos this level (starts at 3). */
  undosLeft: number;
  /** Legacy fail reason retained for older saved puzzles. */
  failReason?: 'collision' | 'wall';
  arrowsRemaining: number;
  /** Number of actual arrow movements, including partial slides and exits. */
  movesMade: number;
}

export const DIR_DELTA: Record<Dir, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

export const DIRS: Dir[] = ['N', 'E', 'S', 'W'];

export const FREE_UNDOS = 3;
