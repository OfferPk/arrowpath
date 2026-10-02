import { describe, expect, it, vi } from 'vitest';
import { handleUndoShortcut } from '../src/ui/undo-shortcut';

type ShortcutEvent = Parameters<typeof handleUndoShortcut>[0];

function shortcutEvent(overrides: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return {
    key: 'z',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...overrides,
  };
}

describe('keyboard Undo shortcut', () => {
  it('handles Ctrl+Z and Cmd+Z while the play screen is active', () => {
    for (const event of [
      shortcutEvent(),
      shortcutEvent({ key: 'Z', ctrlKey: false, metaKey: true }),
    ]) {
      const undo = vi.fn();

      expect(handleUndoShortcut(event, 'play', false, undo)).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(undo).toHaveBeenCalledOnce();
    }
  });

  it('does not handle the shortcut outside play or while a dialog is open', () => {
    for (const [screen, dialogOpen] of [
      ['home', false],
      ['play', true],
    ] as const) {
      const event = shortcutEvent();
      const undo = vi.fn();

      expect(handleUndoShortcut(event, screen, dialogOpen, undo)).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(undo).not.toHaveBeenCalled();
    }
  });

  it('does not intercept unmodified, redo, or alt-modified shortcuts', () => {
    for (const event of [
      shortcutEvent({ ctrlKey: false }),
      shortcutEvent({ shiftKey: true }),
      shortcutEvent({ altKey: true }),
      shortcutEvent({ key: 'y' }),
    ]) {
      const undo = vi.fn();

      expect(handleUndoShortcut(event, 'play', false, undo)).toBe(false);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(undo).not.toHaveBeenCalled();
    }
  });
});
