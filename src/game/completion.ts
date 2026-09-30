/**
 * Reveal a completed level before attempting an interstitial. Ad providers are
 * optional in the MVP, so a missing or failing ad must never gate progress.
 */
export function completeLevelWithoutWaitingForAd(
  showCompletion: () => void,
  showInterstitial: (reason: string) => Promise<unknown>,
  reason: string,
): void {
  showCompletion();
  void Promise.resolve()
    .then(() => showInterstitial(reason))
    .catch(() => undefined);
}
