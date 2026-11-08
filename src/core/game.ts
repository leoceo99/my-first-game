// 게임 규칙 (순수 TypeScript: DOM·브라우저 API 사용 금지)

export const WORLD_WIDTH = 800;
export const WORLD_HEIGHT = 450;
export const PLAYER_SIZE = 40;
export const MOVE_SPEED = 240; // px/s
export const GRAVITY = 1800; // px/s^2
export const JUMP_SPEED = 650; // px/s
export const MAX_FALL_SPEED = 900; // px/s
export const GROUND_HEIGHT = 40;
export const MAX_STEP = 1 / 60; // 한 번에 계산하는 최대 시간(초)

const EPS = 1e-6;

export interface Input {
  left: boolean;
  right: boolean;
  jump: boolean;
}

export interface Rect {
  x: number; // 왼쪽 위 모서리
  y: number;
  width: number;
  height: number;
}

export interface Player extends Rect {
  vy: number; // 세로 속도 (아래가 +)
  onGround: boolean;
}

export interface GameState {
  width: number;
  height: number;
  player: Player;
  platforms: Rect[];
}

export function createLevel(): Rect[] {
  return [
    // 바닥
    { x: 0, y: WORLD_HEIGHT - GROUND_HEIGHT, width: WORLD_WIDTH, height: GROUND_HEIGHT },
    // 떠 있는 발판 (점프 높이 약 117px 이내로 이어진다)
    { x: 120, y: 330, width: 140, height: 20 },
    { x: 340, y: 250, width: 140, height: 20 },
    { x: 580, y: 330, width: 140, height: 20 },
  ];
}

export function createGame(): GameState {
  const platforms = createLevel();
  return {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    player: {
      x: (WORLD_WIDTH - PLAYER_SIZE) / 2,
      y: platforms[0].y - PLAYER_SIZE,
      width: PLAYER_SIZE,
      height: PLAYER_SIZE,
      vy: 0,
      onGround: true,
    },
    platforms,
  };
}

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

const overlapsX = (p: Rect, r: Rect): boolean =>
  p.x + p.width > r.x + EPS && p.x < r.x + r.width - EPS;
const overlapsY = (p: Rect, r: Rect): boolean =>
  p.y + p.height > r.y + EPS && p.y < r.y + r.height - EPS;

function step(state: GameState, input: Input, dt: number): GameState {
  let { x, y, vy, onGround } = state.player;
  const { width, height } = state.player;
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  // 가로 이동 + 가로 충돌
  const oldX = x;
  x += dx * MOVE_SPEED * dt;
  for (const r of state.platforms) {
    if (!overlapsX({ x, y, width, height }, r) || !overlapsY({ x, y, width, height }, r)) continue;
    if (x > oldX) x = r.x - width;
    else if (x < oldX) x = r.x + r.width;
  }

  // 점프 + 중력
  if (input.jump && onGround) vy = -JUMP_SPEED;
  vy = Math.min(vy + GRAVITY * dt, MAX_FALL_SPEED);

  // 세로 이동 + 세로 충돌
  const oldY = y;
  y += vy * dt;
  onGround = false;
  for (const r of state.platforms) {
    if (!overlapsX({ x, y, width, height }, r) || !overlapsY({ x, y, width, height }, r)) continue;
    if (y > oldY || (y === oldY && vy > 0)) {
      y = r.y - height; // 위에서 착지
      vy = 0;
      onGround = true;
    } else if (y < oldY) {
      y = r.y + r.height; // 머리 부딪힘
      vy = 0;
    }
  }

  // 월드 좌우 경계
  x = clamp(x, 0, state.width - width);

  return { ...state, player: { ...state.player, x, y, vy, onGround } };
}

export function update(state: GameState, input: Input, dtSeconds: number): GameState {
  if (!(dtSeconds > 0)) return state;
  const n = Math.ceil(dtSeconds / MAX_STEP - EPS);
  const dt = dtSeconds / n;
  let s = state;
  for (let i = 0; i < n; i++) s = step(s, input, dt);
  return s;
}
