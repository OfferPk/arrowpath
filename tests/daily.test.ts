import { describe, expect, it } from 'vitest';
import {
  dailyKeyKarachi,
  dailyLevelId,
  hashStringToUint32,
} from '../src/game/daily';

describe('dailyKeyKarachi (PKT / UTC+5)', () => {
  it('returns YYYY-MM-DD for a mid-day PKT instant', () => {
    // 2026-09-28 12:00 PKT = 2026-09-28 07:00 UTC
    const d = new Date('2026-09-28T07:00:00.000Z');
    expect(dailyKeyKarachi(d)).toBe('2026-09-28');
  });

  it('stays on prior PKT day just before UTC+5 midnight', () => {
    // 2026-09-27 23:59:59 PKT = 2026-09-27 18:59:59 UTC
    const before = new Date('2026-09-27T18:59:59.000Z');
    expect(dailyKeyKarachi(before)).toBe('2026-09-27');
  });

  it('rolls to next PKT day at/after UTC+5 midnight', () => {
    // 2026-09-28 00:00:00 PKT = 2026-09-27 19:00:00 UTC
    const at = new Date('2026-09-27T19:00:00.000Z');
    expect(dailyKeyKarachi(at)).toBe('2026-09-28');
    const after = new Date('2026-09-27T19:00:01.000Z');
    expect(dailyKeyKarachi(after)).toBe('2026-09-28');
  });

  it('handles UTC midnight still previous PKT evening', () => {
    // 2026-09-28 00:00 UTC = 2026-09-28 05:00 PKT → still 2026-09-28
    expect(dailyKeyKarachi(new Date('2026-09-28T00:00:00.000Z'))).toBe(
      '2026-09-28',
    );
    // 2026-09-27 20:00 UTC = 2026-09-28 01:00 PKT
    expect(dailyKeyKarachi(new Date('2026-09-27T20:00:00.000Z'))).toBe(
      '2026-09-28',
    );
  });
});

describe('dailyLevelId', () => {
  it('same PKT day key → same levelId', () => {
    const key = '2026-09-28';
    const a = dailyLevelId(key, 50);
    const b = dailyLevelId(key, 50);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(1);
    expect(a).toBeLessThanOrEqual(50);
  });

  it('different days usually differ (hash not identical)', () => {
    const a = dailyLevelId('2026-09-28', 50);
    const b = dailyLevelId('2026-09-29', 50);
    // Extremely unlikely to collide; still assert range + deterministic
    expect(b).toBeGreaterThanOrEqual(1);
    expect(b).toBeLessThanOrEqual(50);
    expect(dailyLevelId('2026-09-29', 50)).toBe(b);
    // Allow rare equality but check hash seeds differ
    expect(hashStringToUint32('arrowpath-daily|2026-09-28')).not.toBe(
      hashStringToUint32('arrowpath-daily|2026-09-29'),
    );
    void a;
  });

  it('maps into 1..N for small N', () => {
    for (let i = 0; i < 20; i++) {
      const id = dailyLevelId(`2026-01-${String(i + 1).padStart(2, '0')}`, 7);
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(7);
    }
  });

  it('boundary keys around PKT midnight pick stable ids', () => {
    const beforeKey = dailyKeyKarachi(new Date('2026-09-27T18:59:59.000Z'));
    const afterKey = dailyKeyKarachi(new Date('2026-09-27T19:00:00.000Z'));
    expect(beforeKey).toBe('2026-09-27');
    expect(afterKey).toBe('2026-09-28');
    expect(dailyLevelId(beforeKey, 50)).toBe(dailyLevelId('2026-09-27', 50));
    expect(dailyLevelId(afterKey, 50)).toBe(dailyLevelId('2026-09-28', 50));
  });
});
