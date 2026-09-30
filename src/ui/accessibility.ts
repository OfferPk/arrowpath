import { traceFire } from '../game/engine';
import type { BoardCell, GameState } from '../game/types';

const DIRECTION_NAMES: Record<Extract<BoardCell, { kind: 'arrow' }>['dir'], string> = {
  N: 'north',
  E: 'east',
  S: 'south',
  W: 'west',
};

/** Describe one board position without relying on its visual color. */
export function describeBoardCell(state: GameState, x: number, y: number): string {
  const cell = state.cells[y * state.w + x];
  const position = `Row ${y + 1}, column ${x + 1}`;
  if (!cell) return `${position}: outside the board.`;
  if (cell.kind === 'empty') return `${position}: empty.`;
  if (cell.kind === 'wall') return `${position}: wall.`;

  const path = traceFire(state, x, y);
  if (path.result === 'clear') {
    return `${position}: arrow pointing ${DIRECTION_NAMES[cell.dir]}. Path is clear to the board edge.`;
  }
  if (path.result === 'collision' || path.result === 'wall') {
    const blocker = path.blocker;
    const blockerName = path.result === 'wall' ? 'wall' : 'another arrow';
    const stopped = path.path[path.path.length - 1];
    const blockerPosition = `row ${blocker!.y + 1}, column ${blocker!.x + 1}`;
    if (stopped!.x === x && stopped!.y === y) {
      return `${position}: arrow pointing ${DIRECTION_NAMES[cell.dir]}. Cannot move; ${blockerName} is immediately ahead at ${blockerPosition}.`;
    }
    return `${position}: arrow pointing ${DIRECTION_NAMES[cell.dir]}. Path is blocked by ${blockerName} at ${blockerPosition}; the arrow can slide to row ${stopped!.y + 1}, column ${stopped!.x + 1}.`;
  }
  return `${position}: arrow pointing ${DIRECTION_NAMES[cell.dir]}.`;
}

/** A concise overview read when the accessible grid receives focus. */
export function describeBoard(state: GameState): string {
  const walls = state.cells.filter((cell) => cell.kind === 'wall').length;
  const arrowText = state.arrowsRemaining === 1 ? 'arrow' : 'arrows';
  const wallText = walls === 1 ? 'wall' : 'walls';
  return `Level ${state.levelId} puzzle board. ${state.h} rows by ${state.w} columns. ${state.arrowsRemaining} ${arrowText} remaining; ${walls} ${wallText}. Use the arrow keys to move between cells. Press Enter or Space to fire an arrow.`;
}

/** Confirm the undo action before summarizing the restored board to screen readers. */
export function describeUndoResult(state: GameState): string {
  return `Undo complete. ${describeBoard(state)}`;
}
