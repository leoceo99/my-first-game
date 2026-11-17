// 플레이어 이동 규칙. 화면(Three.js)과 분리된 순수 로직이라 자동 테스트가 가능하다.

export interface PlayerState {
  x: number;
  z: number;
  /** 발 높이(m). 0이면 땅 위 */
  y: number;
  /** 수평 속도(m/s) — 가속·감속(관성)을 위해 상태로 들고 다닌다 */
  vx: number;
  vz: number;
  /** 수직 속도(m/s) */
  vy: number;
  onGround: boolean;
  /** 몸이 바라보는 방향(라디안). 0이면 -z(화면 안쪽)를 본다. */
  yaw: number;
  /** 고개 숙임/듦(라디안). */
  pitch: number;
}

export interface MoveInput {
  /** 앞(+1)/뒤(-1) */
  forward: number;
  /** 오른쪽(+1)/왼쪽(-1) 옆걸음 */
  strafe: number;
  run: boolean;
  /** 이번 프레임에 점프를 눌렀는가 */
  jump?: boolean;
  /** 0~1. 공격 중 이동을 줄일 때 쓴다 (기본 1) */
  speedScale?: number;
}

/** 원형 장애물(나무, 우물)과 사각 장애물(집). 모두 땅 위 평면 기준. */
export type Obstacle =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'box'; x: number; z: number; hw: number; hd: number };

export const PLAYER_RADIUS = 0.35;
export const WALK_SPEED = 1.6; // m/s — 사람의 보통 걸음(약 1.4m/s)보다 조금 빠르게
export const RUN_SPEED = 4.8;
export const GROUND_ACCEL = 10; // m/s² — 걸음이 붙기까지 약 0.16초, 달리기는 약 0.5초
export const GROUND_DECEL = 14;
export const AIR_CONTROL = 0.25; // 공중에서는 방향을 거의 못 바꾼다
export const JUMP_SPEED = 4.3; // 최고 높이 약 0.7m
export const GRAVITY = 13;
export const WORLD_HALF = 40; // 마을 바깥 경계 (가로세로 80m)
export const PITCH_LIMIT = 1.3;

export function makePlayer(x = 0, z = 0, yaw = 0, pitch = 0): PlayerState {
  return { x, z, y: 0, vx: 0, vz: 0, vy: 0, onGround: true, yaw, pitch };
}

export function clampPitch(p: number): number {
  return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p));
}

/** 수평 속력(m/s) */
export function speedOf(s: PlayerState): number {
  return Math.hypot(s.vx, s.vz);
}

/** 한 프레임 이동. 가속·감속, 점프·중력, 장애물에 미끄러지듯 밀려나기. */
export function stepPlayer(s: PlayerState, input: MoveInput, dt: number, obstacles: Obstacle[]): PlayerState {
  let f = clamp1(input.forward);
  let r = clamp1(input.strafe);
  const len = Math.hypot(f, r);
  if (len > 1) { f /= len; r /= len; } // 대각선이 더 빠르지 않게
  const scale = input.speedScale ?? 1;
  const speed = (input.run ? RUN_SPEED : WALK_SPEED) * scale;
  const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
  // 앞 = (-sin, -cos), 오른쪽 = (cos, -sin)
  const tvx = (-sin * f + cos * r) * speed;
  const tvz = (-cos * f - sin * r) * speed;

  // 원하는 속도 쪽으로 가속(관성)
  const wantsMove = f !== 0 || r !== 0;
  let rate = wantsMove ? GROUND_ACCEL : GROUND_DECEL;
  if (!s.onGround) rate *= AIR_CONTROL;
  let [vx, vz] = approach2(s.vx, s.vz, tvx, tvz, rate * dt);

  // 점프·중력
  let vy = s.vy, y = s.y, onGround = s.onGround;
  if (input.jump && onGround) { vy = JUMP_SPEED; onGround = false; }
  if (!onGround) {
    vy -= GRAVITY * dt;
    y += vy * dt;
    if (y <= 0) { y = 0; vy = 0; onGround = true; }
  }

  let x = s.x + vx * dt;
  let z = s.z + vz * dt;
  for (let pass = 0; pass < 2; pass++) {
    for (const o of obstacles) [x, z] = pushOut(x, z, o);
  }
  const lim = WORLD_HALF - PLAYER_RADIUS;
  x = Math.max(-lim, Math.min(lim, x));
  z = Math.max(-lim, Math.min(lim, z));
  // 막혀서 못 간 만큼은 속도에서도 뺀다 (벽에 붙어 달리기 소리가 나지 않게)
  if (dt > 0) { vx = (x - s.x) / dt; vz = (z - s.z) / dt; }
  return { ...s, x, z, y, vx, vz, vy, onGround };
}

/** 2차원 속도를 목표 쪽으로 최대 maxDelta만큼 옮긴다 */
function approach2(vx: number, vz: number, tx: number, tz: number, maxDelta: number): [number, number] {
  const dx = tx - vx, dz = tz - vz;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d < 1e-9) return [tx, tz];
  return [vx + (dx / d) * maxDelta, vz + (dz / d) * maxDelta];
}

function clamp1(v: number) { return Math.max(-1, Math.min(1, v || 0)); }

function pushOut(x: number, z: number, o: Obstacle): [number, number] {
  if (o.kind === 'circle') {
    const dx = x - o.x, dz = z - o.z;
    const d = Math.hypot(dx, dz), min = o.r + PLAYER_RADIUS;
    if (d >= min) return [x, z];
    if (d < 1e-6) return [o.x + min, z];
    return [o.x + (dx / d) * min, o.z + (dz / d) * min];
  }
  const cx = Math.max(o.x - o.hw, Math.min(o.x + o.hw, x));
  const cz = Math.max(o.z - o.hd, Math.min(o.z + o.hd, z));
  const dx = x - cx, dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d >= PLAYER_RADIUS) return [x, z];
  if (d > 1e-6) return [cx + (dx / d) * PLAYER_RADIUS, cz + (dz / d) * PLAYER_RADIUS];
  const pushes: [number, number, number][] = [
    [o.x + o.hw + PLAYER_RADIUS - x, 1, 0],
    [x - (o.x - o.hw - PLAYER_RADIUS), -1, 0],
    [o.z + o.hd + PLAYER_RADIUS - z, 0, 1],
    [z - (o.z - o.hd - PLAYER_RADIUS), 0, -1],
  ];
  pushes.sort((a, b) => a[0] - b[0]);
  const [amt, sx, sz] = pushes[0];
  return [x + sx * amt, z + sz * amt];
}
