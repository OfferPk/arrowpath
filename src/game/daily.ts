/** Asia/Karachi daily challenge helpers (UTC+5 calendar day). */

const LEVEL_COUNT = 50;

/** Hash string to uint32 (FNV-1a inspired mix) — same pattern as GlowGrid/WordHunt. */
export function hashStringToUint32(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Calendar date YYYY-MM-DD in Asia/Karachi (UTC+5).
 * Uses explicit offset — not browser-local — for testability.
 */
export function dailyKeyKarachi(now: Date = new Date()): string {
  const utcMs = now.getTime();
  const karachiMs = utcMs + 5 * 60 * 60 * 1000;
  const d = new Date(karachiMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Deterministic level id in 1..levelCount from PKT daily key. */
export function dailyLevelId(
  dailyKey: string,
  levelCount: number = LEVEL_COUNT,
): number {
  const n = Math.max(1, levelCount | 0);
  const h = hashStringToUint32(`arrowpath-daily|${dailyKey}`);
  return (h % n) + 1;
}
