export interface BoardKeydownEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
  preventDefault(): void;
}
export interface BoardCellPosition {
  x: number;
  y: number;
}
/** Route board grid keys to focus movement or a single cell activation. */
export function handleBoardKeydown(
  event: BoardKeydownEventLike,
  current: BoardCellPosition,
  columns: number,
  rows: number,
  moveFocus: (position: BoardCellPosition) => void,
  activate: () => void,
): boolean {
  if (
    !Number.isInteger(columns) ||
    columns < 1 ||
    !Number.isInteger(rows) ||
    rows < 1 ||
    !Number.isInteger(current.x) ||
    !Number.isInteger(current.y) ||
    current.x < 0 ||
    current.y < 0 ||
    current.x >= columns ||
    current.y >= rows
  ) {
    return false;
  }

  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    // The board cells expose a gridcell role, so activate explicitly rather than
    // relying on browser-specific native-button keyboard behavior.
    event.preventDefault();
    if (!event.repeat) activate();
    return true;
  }

  let x = current.x;
  let y = current.y;
  if ((event.ctrlKey || event.metaKey) && event.key === 'Home') {
    x = 0;
    y = 0;
  } else if ((event.ctrlKey || event.metaKey) && event.key === 'End') {
    x = columns - 1;
    y = rows - 1;
  } else if (event.key === 'ArrowLeft') {
    x = Math.max(0, x - 1);
  } else if (event.key === 'ArrowRight') {
    x = Math.min(columns - 1, x + 1);
  } else if (event.key === 'ArrowUp') {
    y = Math.max(0, y - 1);
  } else if (event.key === 'ArrowDown') {
    y = Math.min(rows - 1, y + 1);
  } else if (event.key === 'Home') {
    x = 0;
  } else if (event.key === 'End') {
    x = columns - 1;
  } else {
    return false;
  }

  event.preventDefault();
  moveFocus({ x, y });
  return true;
}
