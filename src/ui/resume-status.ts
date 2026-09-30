export type RestoredRunMode = 'campaign' | 'daily';

export interface RestoredRunStatusInput {
  levelId: number;
  mode: RestoredRunMode;
  poursCompleted: number;
}

export function describeRestoredRunStatus({
  levelId,
  mode,
  poursCompleted,
}: RestoredRunStatusInput): string {
  const puzzle = mode === 'daily' ? `Daily challenge ${levelId}` : `Level ${levelId}`;
  const pourWord = poursCompleted === 1 ? 'pour' : 'pours';
  return `Resumed ${puzzle}. ${poursCompleted} ${pourWord} completed.`;
}
