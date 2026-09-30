export interface UpdateNoticeInput {
  available: boolean;
  screen: string;
  hasUnfinishedPuzzle: boolean;
}

export interface UpdateNoticePresentation {
  visible: boolean;
  requiresConfirmation: boolean;
  message: string;
  actionLabel: string;
}

/** Decide whether installing a waiting worker can safely reload without losing a puzzle. */
export function getUpdateNoticePresentation(
  input: UpdateNoticeInput,
): UpdateNoticePresentation {
  if (!input.available) {
    return {
      visible: false,
      requiresConfirmation: false,
      message: '',
      actionLabel: '',
    };
  }

  const requiresConfirmation =
    input.screen === 'play' || input.hasUnfinishedPuzzle;
  return {
    visible: true,
    requiresConfirmation,
    message: requiresConfirmation
      ? 'An update is ready. Review before reloading; an unfinished puzzle will restart.'
      : 'A game update is ready. Reload when you’re ready to install it.',
    actionLabel: requiresConfirmation ? 'Review update' : 'Reload to update',
  };
}
