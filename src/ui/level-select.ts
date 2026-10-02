interface CampaignLevelHighlightOptions {
  activeCampaignLevelId: number | null;
  unlockedLevel: number;
  totalLevels: number;
}

interface CampaignLevelGridTargetOptions {
  currentLevelId: number;
  key: string;
  unlockedLevel: number;
  totalLevels: number;
  columns?: number;
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

interface CampaignLevelAccessibleLabelOptions {
  levelId: number;
  unlocked: boolean;
  cleared: boolean;
  current: boolean;
}

/** Describe a Campaign level's progress state for assistive technology. */
export function getCampaignLevelAccessibleLabel({
  levelId,
  unlocked,
  cleared,
  current,
}: CampaignLevelAccessibleLabelOptions): string {
  if (!unlocked) return `Level ${levelId}, locked`;
  if (current && cleared) return `Level ${levelId}, current, cleared`;
  if (current) return `Level ${levelId}, current`;
  if (cleared) return `Level ${levelId}, cleared`;
  return `Level ${levelId}, available`;
}

/**
 * Return the adjacent level in the visible row-major grid, without wrapping
 * across rows or moving focus onto a locked or nonexistent level.
 */
export function getCampaignLevelGridTarget({
  currentLevelId,
  key,
  unlockedLevel,
  totalLevels,
  columns = 5,
}: CampaignLevelGridTargetOptions): number | null {
  if (
    !Number.isInteger(currentLevelId) ||
    !Number.isInteger(unlockedLevel) ||
    !Number.isInteger(totalLevels) ||
    !Number.isInteger(columns) ||
    columns < 1
  ) {
    return null;
  }

  const lastAvailableLevel = Math.min(unlockedLevel, totalLevels);
  if (currentLevelId < 1 || currentLevelId > lastAvailableLevel) return null;

  const column = (currentLevelId - 1) % columns;
  let targetLevelId: number;
  switch (key) {
    case 'ArrowLeft':
      if (column === 0) return null;
      targetLevelId = currentLevelId - 1;
      break;
    case 'ArrowRight':
      if (column === columns - 1) return null;
      targetLevelId = currentLevelId + 1;
      break;
    case 'ArrowUp':
      targetLevelId = currentLevelId - columns;
      break;
    case 'ArrowDown':
      targetLevelId = currentLevelId + columns;
      break;
    default:
      return null;
  }

  return targetLevelId >= 1 && targetLevelId <= lastAvailableLevel
    ? targetLevelId
    : null;
}
