import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAdLog,
  getAdLog,
  isAdsRemoved,
  purchaseRemoveAds,
  showInterstitial,
  showRewarded,
} from '../src/ads/stubs';

describe('ads stubs', () => {
  beforeEach(() => {
    clearAdLog();
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
  });

  it('showInterstitial logs when ads enabled', async () => {
    expect(isAdsRemoved()).toBe(false);
    await showInterstitial('fail');
    expect(getAdLog().some((l) => l.includes('interstitial:show:fail'))).toBe(true);
  });

  it('purchaseRemoveAds sets flag and skips interstitial', async () => {
    await purchaseRemoveAds();
    expect(isAdsRemoved()).toBe(true);
    await showInterstitial('retry');
    expect(getAdLog().some((l) => l.includes('interstitial:skipped'))).toBe(true);
  });

  it('showRewarded resolves true', async () => {
    const ok = await showRewarded('hint');
    expect(ok).toBe(true);
  });
});
