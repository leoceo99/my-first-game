import { describe, expect, it } from 'vitest';
import { makePlayer, stepPlayer, JUMP_SPEED, GRAVITY, WALK_SPEED, RUN_SPEED, PLAYER_RADIUS, WORLD_HALF, type Obstacle, type PlayerState } from '../../src/sim/player';

const start: PlayerState = makePlayer();
const run = (s: PlayerState, input: any, sec: number, obs: Obstacle[] = []) => {
  for (let i = 0; i < sec * 60; i++) s = stepPlayer(s, input, 1 / 60, obs);
  return s;
};

describe('플레이어 이동', () => {
  it('걷기: 바로 최고 속도가 아니라 가속해서 걷는 속도에 이른다', () => {
    const s1 = stepPlayer(start, { forward: 1, strafe: 0, run: false }, 1 / 60, []);
    expect(Math.hypot(s1.vx, s1.vz)).toBeLessThan(WALK_SPEED * 0.5);
    const s = run(start, { forward: 1, strafe: 0, run: false }, 1);
    expect(s.x).toBeCloseTo(0, 5);
    expect(s.vz).toBeCloseTo(-WALK_SPEED, 3);
    expect(s.z).toBeLessThan(-WALK_SPEED * 0.8);
  });
  it('달리면 더 빠르다', () => {
    const s = run(start, { forward: 1, strafe: 0, run: true }, 1.5);
    expect(s.vz).toBeCloseTo(-RUN_SPEED, 3);
  });
  it('손을 떼면 감속해서 멈춘다', () => {
    let s = run(start, { forward: 1, strafe: 0, run: true }, 1.5);
    s = run(s, { forward: 0, strafe: 0, run: false }, 0.5);
    expect(Math.hypot(s.vx, s.vz)).toBe(0);
  });
  it('대각선이 더 빠르지 않다', () => {
    const s = run(start, { forward: 1, strafe: 1, run: false }, 1);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(WALK_SPEED, 3);
  });
  it('바라보는 방향을 따른다 (90도 왼쪽으로 돌면 -x로 간다)', () => {
    const s = run({ ...start, yaw: Math.PI / 2 }, { forward: 1, strafe: 0, run: false }, 1);
    expect(s.vx).toBeCloseTo(-WALK_SPEED, 3);
  });
  it('점프: 약 0.7m 올라갔다가 땅에 내려온다', () => {
    let s = stepPlayer(start, { forward: 0, strafe: 0, run: false, jump: true }, 1 / 60, []);
    expect(s.onGround).toBe(false);
    let top = 0;
    for (let i = 0; i < 120; i++) { s = stepPlayer(s, { forward: 0, strafe: 0, run: false }, 1 / 60, []); top = Math.max(top, s.y); }
    expect(top).toBeCloseTo((JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY), 1);
    expect(s.onGround).toBe(true);
    expect(s.y).toBe(0);
  });
  it('공중에서는 다시 점프할 수 없다', () => {
    let s = stepPlayer(start, { forward: 0, strafe: 0, run: false, jump: true }, 1 / 60, []);
    const vy = s.vy;
    s = stepPlayer(s, { forward: 0, strafe: 0, run: false, jump: true }, 1 / 60, []);
    expect(s.vy).toBeLessThan(vy);
  });
  it('집(사각형)을 뚫고 지나가지 못한다', () => {
    const house: Obstacle = { kind: 'box', x: 0, z: -3, hw: 2, hd: 1 };
    const s = run(start, { forward: 1, strafe: 0, run: true }, 3, [house]);
    expect(s.z).toBeGreaterThanOrEqual(-2 + PLAYER_RADIUS - 1e-6);
  });
  it('나무(원)에 막히고 옆으로 미끄러진다', () => {
    const tree: Obstacle = { kind: 'circle', x: 0.1, z: -2, r: 0.4 };
    const s = run(start, { forward: 1, strafe: 0, run: false }, 3, [tree]);
    expect(Math.hypot(s.x - 0.1, s.z + 2)).toBeGreaterThanOrEqual(0.4 + PLAYER_RADIUS - 1e-6);
    expect(s.z).toBeLessThan(-3); // 결국 돌아서 지나감
  });
  it('세계 경계 밖으로 나가지 못한다', () => {
    const s = run(start, { forward: 1, strafe: 0, run: true }, 20);
    expect(s.z).toBeGreaterThanOrEqual(-WORLD_HALF);
  });
});
