import { describe, expect, it } from 'vitest';
import { getUpdateNoticePresentation } from '../src/ui/pwa-update';

describe('PWA update handoff policy', () => {
  it('does not show an update action before an update is detected', () => {
    expect(
      getUpdateNoticePresentation({
        available: false,
        screen: 'home',
        hasUnfinishedPuzzle: false,
      }),
    ).toEqual({
      visible: false,
      requiresConfirmation: false,
      message: '',
      actionLabel: '',
    });
  });

  it('offers direct installation from a safe screen with no unfinished puzzle', () => {
    const view = getUpdateNoticePresentation({
      available: true,
      screen: 'home',
      hasUnfinishedPuzzle: false,
    });
    expect(view.visible).toBe(true);
    expect(view.requiresConfirmation).toBe(false);
    expect(view.actionLabel).toBe('Reload to update');
  });

  it('requires confirmation after leaving a puzzle screen with an unfinished run', () => {
    const view = getUpdateNoticePresentation({
      available: true,
      screen: 'home',
      hasUnfinishedPuzzle: true,
    });
    expect(view.visible).toBe(true);
    expect(view.requiresConfirmation).toBe(true);
    expect(view.actionLabel).toBe('Review update');
    expect(view.message).toContain('unfinished puzzle will restart');
  });

  it('requires confirmation while the game screen is open even after a clear', () => {
    const view = getUpdateNoticePresentation({
      available: true,
      screen: 'play',
      hasUnfinishedPuzzle: false,
    });
    expect(view.requiresConfirmation).toBe(true);
    expect(view.actionLabel).toBe('Review update');
  });

  it('keeps the confirmation guard in settings when an unfinished puzzle remains in memory', () => {
    const view = getUpdateNoticePresentation({
      available: true,
      screen: 'settings',
      hasUnfinishedPuzzle: true,
    });
    expect(view.requiresConfirmation).toBe(true);
  });
});
