interface CampaignLevelHighlightOptions {
  activeCampaignLevelId: number | null;
  unlockedLevel: number;
  totalLevels: number;
}

/**
 * Match the level-picker marker to the campaign level the player should see
 * as current: an unfinished campaign run, or the next unlocked level.
 */
export function getCampaignLevelToHighlight({
  activeCampaignLevelId,
  unlockedLevel,
  totalLevels,
}: CampaignLevelHighlightOptions): number {
  if (activeCampaignLevelId !== null) return activeCampaignLevelId;
  return Math.min(unlockedLevel, totalLevels);
}
