import type { GameState } from '../game/types';

interface UndoEngine {
  getState(): GameState;
  undo(forceExtra?: boolean): boolean;
}

/** Undo once and return the cell index of the arrow that has just been restored. */
export function undoAndGetFocusIndex(
  engine: UndoEngine,
  fallbackIndex: number,
  forceExtra = false,
): number | null {
  const currentState = engine.getState();
  if (!engine.undo(forceExtra)) return null;
  const restoredState = engine.getState();

  if (
    currentState.w !== restoredState.w ||
    currentState.h !== restoredState.h ||
    currentState.cells.length !== restoredState.cells.length
  ) {
    return fallbackIndex;
  }

  const restoredArrowIndex = restoredState.cells.findIndex((cell, index) => {
    if (cell.kind !== 'arrow') return false;
    const currentCell = currentState.cells[index];
    return currentCell?.kind !== 'arrow' || currentCell.dir !== cell.dir;
  });
  return restoredArrowIndex >= 0 ? restoredArrowIndex : fallbackIndex;
}

/** Focus a board cell after the accessible board has been re-rendered. */
export function focusUndoCell(boardAccess: ParentNode, index: number): void {
  boardAccess
    .querySelector<HTMLButtonElement>(`[data-cell-index="${index}"]`)
    ?.focus({ preventScroll: true });
}
