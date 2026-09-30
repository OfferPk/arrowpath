import { describe, expect, it } from 'vitest';
import { getCampaignLevelToHighlight } from '../src/ui/level-select';

describe('campaign level-picker highlight', () => {
  it('points to the Continue destination unless an unfinished campaign run should resume', () => {
    expect(
      getCampaignLevelToHighlight({
        activeCampaignLevelId: null,
        unlockedLevel: 2,
        totalLevels: 50,
      }),
    ).toBe(2);

    expect(
      getCampaignLevelToHighlight({
        activeCampaignLevelId: 3,
        unlockedLevel: 5,
        totalLevels: 50,
      }),
    ).toBe(3);
  });
});
