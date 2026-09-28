const PREFIX = 'arrowpath:v1:';

export interface Progress {
  /** Highest level unlocked (1-based). Level 1 always unlocked. */
  unlocked: number;
  /** Cleared level ids */
  cleared: number[];
}

export interface Settings {
  muted: boolean;
  adsRemoved: boolean;
}

/** Isolated daily progress — does not advance campaign unlock/cleared. */
export interface DailyRecord {
  completed: boolean;
  levelId: number;
  finishedAt?: string;
}

const DEFAULT_PROGRESS: Progress = { unlocked: 1, cleared: [] };
const DEFAULT_SETTINGS: Settings = { muted: false, adsRemoved: false };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export function getProgress(): Progress {
  const p = read<Progress>('progress', DEFAULT_PROGRESS);
  p.unlocked = Math.max(1, p.unlocked | 0);
  p.cleared = Array.isArray(p.cleared) ? p.cleared : [];
  return p;
}

export function markLevelCleared(levelId: number, totalLevels: number): Progress {
  const p = getProgress();
  if (!p.cleared.includes(levelId)) p.cleared.push(levelId);
  p.unlocked = Math.min(totalLevels, Math.max(p.unlocked, levelId + 1));
  write('progress', p);
  return p;
}

export function getSettings(): Settings {
  return read<Settings>('settings', DEFAULT_SETTINGS);
}

export function setSettings(partial: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...partial };
  write('settings', next);
  return next;
}

export function isOnboarded(): boolean {
  return read<{ ok: boolean }>('onboarded', { ok: false }).ok;
}

export function setOnboarded(): void {
  write('onboarded', { ok: true });
}

export function getDailyRecord(dailyKey: string): DailyRecord | null {
  try {
    const raw = localStorage.getItem(PREFIX + `daily:${dailyKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DailyRecord>;
    if (typeof parsed.levelId !== 'number') return null;
    return {
      completed: Boolean(parsed.completed),
      levelId: parsed.levelId,
      finishedAt: parsed.finishedAt,
    };
  } catch {
    return null;
  }
}

export function saveDailyRecord(dailyKey: string, record: DailyRecord): void {
  const prev = getDailyRecord(dailyKey);
  const completed = record.completed || Boolean(prev?.completed);
  write(`daily:${dailyKey}`, {
    completed,
    levelId: record.levelId,
    finishedAt: completed
      ? (prev?.finishedAt ?? record.finishedAt ?? new Date().toISOString())
      : record.finishedAt,
  });
}
