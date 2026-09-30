export type WinMode = 'campaign' | 'daily';

export function getWinActionLabel(
  mode: WinMode,
  levelId: number,
  totalLevels: number,
): string {
  if (mode === 'daily') return 'Continue campaign';
  return levelId >= totalLevels ? 'Back to home' : 'Next level';
}
