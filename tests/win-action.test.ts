import { describe, expect, it } from 'vitest';
import { getWinActionLabel } from '../src/ui/win-action';

describe('win action labels', () => {
  it('offers the next campaign level before the final level', () => {
    expect(getWinActionLabel('campaign', 49, 50)).toBe('Next level');
  });

  it('names the Home destination after the final campaign level', () => {
    expect(getWinActionLabel('campaign', 50, 50)).toBe('Back to home');
  });

  it('keeps daily completion pointed back to the campaign', () => {
    expect(getWinActionLabel('daily', 50, 50)).toBe('Continue campaign');
  });
});
