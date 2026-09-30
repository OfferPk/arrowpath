import type { EngineSnapshot } from './engine';

const PREFIX = 'arrowpath:v1:';
const ACTIVE_PUZZLE_KEY = 'active-puzzle';
const ACTIVE_PUZZLE_VERSION = 1;

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

export interface ActivePuzzleSnapshot {
  version: 1;
  levelId: number;
  mode: 'campaign' | 'daily';
  dailyKey: string | null;
  engine: EngineSnapshot;
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

export function clearActivePuzzle(): void {
  try {
    localStorage.removeItem(PREFIX + ACTIVE_PUZZLE_KEY);
  } catch {
    /* private mode / unavailable storage */
  }
}

export function saveActivePuzzle(snapshot: ActivePuzzleSnapshot): void {
  write(ACTIVE_PUZZLE_KEY, snapshot);
}

export function loadActivePuzzle(): ActivePuzzleSnapshot | null {
  try {
    const raw = localStorage.getItem(PREFIX + ACTIVE_PUZZLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActivePuzzleSnapshot>;
    const validEnvelope =
      parsed.version === ACTIVE_PUZZLE_VERSION &&
      Number.isInteger(parsed.levelId) &&
      (parsed.levelId ?? 0) > 0 &&
      (parsed.mode === 'campaign' || parsed.mode === 'daily') &&
      (parsed.mode === 'campaign'
        ? parsed.dailyKey === null
        : typeof parsed.dailyKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dailyKey)) &&
      typeof parsed.engine === 'object' &&
      parsed.engine !== null &&
      !Array.isArray(parsed.engine);
    if (!validEnvelope) {
      clearActivePuzzle();
      return null;
    }
    return parsed as ActivePuzzleSnapshot;
  } catch {
    clearActivePuzzle();
    return null;
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
