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
  restart?: boolean;
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

export interface Enemy extends Rect {
  vx: number; // 가로 속도 (오른쪽이 +)
  minX: number; // 순찰 구간 왼쪽 끝 (x의 최솟값)
  maxX: number; // 순찰 구간 오른쪽 끝 (x의 최댓값)
}

export type Status = 'playing' | 'gameover' | 'clear';

export interface Level {
  platforms: Rect[];
  coins: Rect[];
  enemies: Enemy[];
}

export interface GameState {
  width: number;
  height: number;
  player: Player;
  platforms: Rect[];
  coins: Rect[];
  enemies: Enemy[];
  totalCoins: number;
  score: number;
  status: Status;
  jumpHeld: boolean; // 이전 프레임의 jump 입력 (누른 순간만 점프하기 위해)
}

const COIN_SIZE = 20;
export const ENEMY_SIZE = 30;
export const ENEMY_SPEED = 80; // px/s

const coin = (x: number, y: number): Rect => ({ x, y, width: COIN_SIZE, height: COIN_SIZE });
const patrolEnemy = (x: number, y: number, minX: number, maxX: number): Enemy => ({
  x, y, width: ENEMY_SIZE, height: ENEMY_SIZE, vx: ENEMY_SPEED, minX, maxX,
});

export function createLevel(): Level {
  return {
    platforms: [
      // 바닥
      { x: 0, y: WORLD_HEIGHT - GROUND_HEIGHT, width: WORLD_WIDTH, height: GROUND_HEIGHT },
      // 떠 있는 발판 (점프 높이 약 117px 이내로 이어진다)
      { x: 120, y: 330, width: 140, height: 20 },
      { x: 340, y: 250, width: 140, height: 20 },
      { x: 580, y: 330, width: 140, height: 20 },
    ],
    coins: [
      coin(50, 380), // 바닥 왼쪽
      coin(170, 300), // 발판 1 위
      coin(290, 340), // 발판 1과 2 사이 (공중)
      coin(400, 200), // 발판 2 위
      coin(630, 300), // 발판 3 위
      coin(740, 380), // 바닥 오른쪽
    ],
    enemies: [
      patrolEnemy(340, 220, 340, 450), // 발판 2 위 (발판 340~480)
      patrolEnemy(600, 380, 480, 770), // 바닥 오른쪽 구간
    ],
  };
}

export function createGame(): GameState {
  const { platforms, coins, enemies } = createLevel();
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
    coins,
    enemies,
    totalCoins: coins.length,
    score: 0,
    status: 'playing',
    jumpHeld: false,
  };
}

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

const overlapsX = (p: Rect, r: Rect): boolean =>
  p.x + p.width > r.x + EPS && p.x < r.x + r.width - EPS;
const overlapsY = (p: Rect, r: Rect): boolean =>
  p.y + p.height > r.y + EPS && p.y < r.y + r.height - EPS;

const touches = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

function moveEnemy(e: Enemy, dt: number): Enemy {
  let x = e.x + e.vx * dt;
  let vx = e.vx;
  if (x <= e.minX) {
    x = e.minX;
    vx = Math.abs(vx);
  } else if (x >= e.maxX) {
    x = e.maxX;
    vx = -Math.abs(vx);
  }
  return { ...e, x, vx };
}

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

  const player = { ...state.player, x, y, vy, onGround };

  // 적 순찰
  const enemies = state.enemies.map((e) => moveEnemy(e, dt));

  // 코인 먹기
  const coins = state.coins.filter((c) => !touches(player, c));
  const score = state.score + (state.coins.length - coins.length);

  let status: Status = 'playing';
  if (enemies.some((e) => touches(player, e))) status = 'gameover';
  else if (coins.length === 0) status = 'clear';

  return { ...state, player, enemies, coins, score, status };
}

export function update(state: GameState, input: Input, dtSeconds: number): GameState {
  const pressed = input.jump && !state.jumpHeld; // 이번 프레임에 막 누름
  if (state.status !== 'playing') {
    if (pressed || input.restart) return { ...createGame(), jumpHeld: input.jump };
    return state.jumpHeld === input.jump ? state : { ...state, jumpHeld: input.jump };
  }
  if (!(dtSeconds > 0)) return state;
  const n = Math.ceil(dtSeconds / MAX_STEP - EPS);
  const dt = dtSeconds / n;
  let s = state;
  for (let i = 0; i < n && s.status === 'playing'; i++) {
    // 점프는 누른 순간(첫 하위 단계)에만 적용한다
    s = step(s, { ...input, jump: i === 0 && pressed }, dt);
  }
  return { ...s, jumpHeld: input.jump };
}
