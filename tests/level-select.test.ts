import { describe, expect, it } from 'vitest';
import {
  getCampaignLevelGridTarget,
  getCampaignLevelToHighlight,
} from '../src/ui/level-select';

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

describe('campaign level-picker arrow navigation', () => {
  const move = (currentLevelId: number, key: string, unlockedLevel = 50) =>
    getCampaignLevelGridTarget({
      currentLevelId,
      key,
      unlockedLevel,
      totalLevels: 50,
    });

  it('moves horizontally without wrapping and vertically by the five-column layout', () => {
    expect(move(50, 'ArrowLeft')).toBe(49);
    expect(move(49, 'ArrowRight')).toBe(50);
    expect(move(50, 'ArrowUp')).toBe(45);
    expect(move(45, 'ArrowDown')).toBe(50);
    expect(move(46, 'ArrowLeft')).toBeNull();
    expect(move(44, 'ArrowRight')).toBe(45);
    expect(move(46, 'ArrowRight')).toBe(47);
    expect(move(45, 'ArrowRight')).toBeNull();
    expect(move(50, 'ArrowRight')).toBeNull();
  });

  it('does not move onto a locked or nonexistent level', () => {
    expect(move(2, 'ArrowRight', 2)).toBeNull();
    expect(move(2, 'ArrowDown', 2)).toBeNull();
    expect(move(1, 'ArrowUp', 2)).toBeNull();
    expect(move(50, 'ArrowDown', 50)).toBeNull();
  });

  it('rejects unknown keys and invalid grid inputs', () => {
    expect(move(1, 'Enter')).toBeNull();
    expect(move(0, 'ArrowRight')).toBeNull();
    expect(
      getCampaignLevelGridTarget({
        currentLevelId: 1,
        key: 'ArrowRight',
        unlockedLevel: 50,
        totalLevels: 50,
        columns: 0,
      }),
    ).toBeNull();
  });
});
