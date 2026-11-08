// 게임 규칙 (순수 TypeScript: DOM·브라우저 API 사용 금지)

export const WORLD_WIDTH = 800;
export const WORLD_HEIGHT = 450;
export const PLAYER_SIZE = 40;
export const PLAYER_SPEED = 240; // px/s

export interface Input {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export interface Player {
  x: number; // 왼쪽 위 모서리
  y: number;
  width: number;
  height: number;
}

export interface GameState {
  width: number;
  height: number;
  player: Player;
}

export function createGame(): GameState {
  return {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    player: {
      x: (WORLD_WIDTH - PLAYER_SIZE) / 2,
      y: (WORLD_HEIGHT - PLAYER_SIZE) / 2,
      width: PLAYER_SIZE,
      height: PLAYER_SIZE,
    },
  };
}

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

export function update(state: GameState, input: Input, dtSeconds: number): GameState {
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const p = state.player;
  return {
    ...state,
    player: {
      ...p,
      x: clamp(p.x + dx * PLAYER_SPEED * dtSeconds, 0, state.width - p.width),
      y: clamp(p.y + dy * PLAYER_SPEED * dtSeconds, 0, state.height - p.height),
    },
  };
}
