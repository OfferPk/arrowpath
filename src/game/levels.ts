import type { LevelDef } from './types';

export interface LevelPack {
  version: number;
  theme: string;
  levels: LevelDef[];
}

let cached: LevelPack | null = null;

export async function loadLevels(): Promise<LevelPack> {
  if (cached) return cached;
  const res = await fetch(`${import.meta.env.BASE_URL}levels.json`);
  if (!res.ok) throw new Error(`Failed to load levels.json: ${res.status}`);
  const pack = (await res.json()) as LevelPack;
  if (!pack.levels || pack.levels.length < 1) {
    throw new Error('levels.json empty');
  }
  cached = pack;
  return pack;
}

export function getLevel(pack: LevelPack, id: number): LevelDef | undefined {
  return pack.levels.find((l) => l.id === id);
}
