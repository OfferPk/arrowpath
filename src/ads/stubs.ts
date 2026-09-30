/**
 * Ad / IAP placeholder hooks — no real SDK in MVP.
 * UI wires buttons to these; they log + resolve so flows never crash.
 */
import { getSettings, setSettings } from '../game/persist';

const log: string[] = [];

export function getAdLog(): readonly string[] {
  return log;
}

export function clearAdLog(): void {
  log.length = 0;
}

export function isAdsRemoved(): boolean {
  return getSettings().adsRemoved === true;
}

export async function showInterstitial(reason: string = 'generic'): Promise<boolean> {
  if (isAdsRemoved()) {
    log.push(`interstitial:skipped:${reason}`);
    return false;
  }
  log.push(`interstitial:show:${reason}`);
  // Simulated async ad
  await Promise.resolve();
  return true;
}

export async function showRewarded(reason: string = 'hint'): Promise<boolean> {
  // Rewarded still shown even if remove-ads (common pattern) — but we skip if ads removed for MVP simplicity
  if (isAdsRemoved()) {
    log.push(`rewarded:auto-grant:${reason}`);
    return true;
  }
  log.push(`rewarded:show:${reason}`);
  await Promise.resolve();
  log.push(`rewarded:earned:${reason}`);
  return true;
}

export async function purchaseRemoveAds(): Promise<boolean> {
  log.push('iap:remove-ads:stub');
  setSettings({ adsRemoved: true });
  await Promise.resolve();
  return true;
}
