import { describe, expect, it } from 'vitest';
import { describeRestoredRunStatus } from '../src/ui/resume-status';

describe('restored-run status', () => {
  it('identifies a resumed campaign level and its completed pour count', () => {
    expect(
      describeRestoredRunStatus({
        levelId: 3,
        mode: 'campaign',
        poursCompleted: 1,
      }),
    ).toBe('Resumed Level 3. 1 pour completed.');
  });

  it('uses plural pours for zero and multiple completed moves', () => {
    expect(
      describeRestoredRunStatus({
        levelId: 4,
        mode: 'campaign',
        poursCompleted: 0,
      }),
    ).toBe('Resumed Level 4. 0 pours completed.');
    expect(
      describeRestoredRunStatus({
        levelId: 4,
        mode: 'campaign',
        poursCompleted: 2,
      }),
    ).toBe('Resumed Level 4. 2 pours completed.');
  });

  it('identifies daily challenge restores without changing their count', () => {
    expect(
      describeRestoredRunStatus({
        levelId: 28,
        mode: 'daily',
        poursCompleted: 2,
      }),
    ).toBe('Resumed Daily challenge 28. 2 pours completed.');
  });
});
