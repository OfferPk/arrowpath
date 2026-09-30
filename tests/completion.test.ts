import { describe, expect, it, vi } from 'vitest';
import { completeLevelWithoutWaitingForAd } from '../src/game/completion';

describe('level completion and interstitials', () => {
  it('shows the completion UI before starting an interstitial', async () => {
    const events: string[] = [];
    let finishAd!: (shown: boolean) => void;
    const pendingAd = new Promise<boolean>((resolve) => {
      finishAd = resolve;
    });
    const showCompletion = vi.fn(() => events.push('completion'));
    const showInterstitial = vi.fn((reason: string) => {
      events.push(`interstitial:${reason}`);
      return pendingAd;
    });

    completeLevelWithoutWaitingForAd(
      showCompletion,
      showInterstitial,
      'level-complete',
    );

    expect(showCompletion).toHaveBeenCalledOnce();
    expect(showInterstitial).not.toHaveBeenCalled();
    expect(events).toEqual(['completion']);

    await Promise.resolve();
    expect(showInterstitial).toHaveBeenCalledWith('level-complete');
    expect(events).toEqual(['completion', 'interstitial:level-complete']);
    finishAd(true);
  });

  it('keeps completion available when an ad provider rejects', async () => {
    const showCompletion = vi.fn();
    const showInterstitial = vi.fn(async () => {
      throw new Error('ad SDK unavailable');
    });

    expect(() =>
      completeLevelWithoutWaitingForAd(
        showCompletion,
        showInterstitial,
        'daily-complete',
      ),
    ).not.toThrow();
    expect(showCompletion).toHaveBeenCalledOnce();

    await Promise.resolve();
    await Promise.resolve();
    expect(showInterstitial).toHaveBeenCalledWith('daily-complete');
  });
});
