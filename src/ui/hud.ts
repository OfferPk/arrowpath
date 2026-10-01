import type { GameState } from '../game/types';

export type HudPlayMode = 'campaign' | 'daily';

export function getHudStats(
  state: Pick<GameState, 'levelId' | 'arrowsRemaining' | 'undosLeft' | 'movesMade'>,
  mode: HudPlayMode,
): { level: string; left: string; undos: string; moves: string } {
  return {
    level: mode === 'daily' ? `D${state.levelId}` : String(state.levelId),
    left: String(state.arrowsRemaining),
    undos: String(state.undosLeft),
    moves: String(state.movesMade),
  };
}
