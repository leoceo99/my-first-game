// 플레이어 이동 규칙. 화면(Three.js)과 분리된 순수 로직이라 자동 테스트가 가능하다.

export interface PlayerState {
  x: number;
  z: number;
  /** 몸이 바라보는 방향(라디안). 0이면 -z(화면 안쪽)를 본다. */
  yaw: number;
  /** 고개 숙임/듦(라디안). 1인칭에서만 의미가 크다. */
  pitch: number;
}

export interface MoveInput {
  /** 앞(+1)/뒤(-1) */
  forward: number;
  /** 오른쪽(+1)/왼쪽(-1) 옆걸음 */
  strafe: number;
  run: boolean;
}

/** 원형 장애물(나무, 우물)과 사각 장애물(집). 모두 땅 위 평면 기준. */
export type Obstacle =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'box'; x: number; z: number; hw: number; hd: number };

export const PLAYER_RADIUS = 0.35;
export const WALK_SPEED = 2.2; // m/s (보통 걸음)
export const RUN_SPEED = 5.0;
export const WORLD_HALF = 40; // 마을 바깥 경계 (가로세로 80m)
export const PITCH_LIMIT = 1.3;

export function clampPitch(p: number): number {
  return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p));
}

/** 한 프레임 이동. 장애물을 뚫지 않고 미끄러지듯 밀려난다. */
export function stepPlayer(s: PlayerState, input: MoveInput, dt: number, obstacles: Obstacle[]): PlayerState {
  let f = clamp1(input.forward);
  let r = clamp1(input.strafe);
  const len = Math.hypot(f, r);
  if (len > 1) { f /= len; r /= len; } // 대각선이 더 빠르지 않게
  const speed = input.run ? RUN_SPEED : WALK_SPEED;
  const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
  // 앞 = (-sin, -cos), 오른쪽 = (cos, -sin)
  let x = s.x + (-sin * f + cos * r) * speed * dt;
  let z = s.z + (-cos * f - sin * r) * speed * dt;

  for (let pass = 0; pass < 2; pass++) {
    for (const o of obstacles) [x, z] = pushOut(x, z, o);
  }
  const lim = WORLD_HALF - PLAYER_RADIUS;
  x = Math.max(-lim, Math.min(lim, x));
  z = Math.max(-lim, Math.min(lim, z));
  return { ...s, x, z };
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
  // 사각형: 가장 가까운 점과의 거리로 판정
  const cx = Math.max(o.x - o.hw, Math.min(o.x + o.hw, x));
  const cz = Math.max(o.z - o.hd, Math.min(o.z + o.hd, z));
  const dx = x - cx, dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d >= PLAYER_RADIUS) return [x, z];
  if (d > 1e-6) return [cx + (dx / d) * PLAYER_RADIUS, cz + (dz / d) * PLAYER_RADIUS];
  // 중심이 사각형 안에 들어온 경우: 가장 가까운 변으로 밀어냄
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
