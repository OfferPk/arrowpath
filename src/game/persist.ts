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
