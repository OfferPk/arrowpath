type UndoShortcutKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'preventDefault'
>;

/** Handle Ctrl/Cmd+Z only during play, outside dialogs and redo/modified shortcuts. */
export function handleUndoShortcut(
  event: UndoShortcutKeyEvent,
  screen: string,
  dialogOpen: boolean,
  undo: () => void,
): boolean {
  const isUndoKey =
    !event.altKey &&
    !event.shiftKey &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 'z';
  if (screen !== 'play' || dialogOpen || !isUndoKey) return false;

  event.preventDefault();
  undo();
  return true;
}
