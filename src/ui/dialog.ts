export interface DialogFocusTarget {
  focus(options?: { preventScroll?: boolean }): void;
}

export interface DialogKeydownLike {
  key: string;
  shiftKey: boolean;
  preventDefault(): void;
}

export type DialogKeyResult = 'dismiss' | 'trapped' | 'pass';

/** Keep keyboard focus inside a modal and report Escape as a dismiss request. */
export function manageDialogKeydown(
  event: DialogKeydownLike,
  focusable: readonly DialogFocusTarget[],
  activeElement: DialogFocusTarget | null,
): DialogKeyResult {
  if (event.key === 'Escape') {
    event.preventDefault();
    return 'dismiss';
  }
  if (event.key !== 'Tab') return 'pass';

  if (focusable.length === 0) {
    event.preventDefault();
    return 'trapped';
  }

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const activeIndex = activeElement ? focusable.indexOf(activeElement) : -1;

  if (activeIndex < 0) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus({ preventScroll: true });
    return 'trapped';
  }
  if (event.shiftKey && activeIndex === 0) {
    event.preventDefault();
    last.focus({ preventScroll: true });
    return 'trapped';
  }
  if (!event.shiftKey && activeIndex === focusable.length - 1) {
    event.preventDefault();
    first.focus({ preventScroll: true });
    return 'trapped';
  }
  return 'pass';
}
