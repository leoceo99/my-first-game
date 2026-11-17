import { describe, expect, it } from 'vitest';
import { stepPlayer, WALK_SPEED, RUN_SPEED, PLAYER_RADIUS, WORLD_HALF, type Obstacle, type PlayerState } from '../../src/sim/player';

const start: PlayerState = { x: 0, z: 0, yaw: 0, pitch: 0 };
const run = (s: PlayerState, input: any, sec: number, obs: Obstacle[] = []) => {
  for (let i = 0; i < sec * 60; i++) s = stepPlayer(s, input, 1 / 60, obs);
  return s;
};

describe('플레이어 이동', () => {
  it('앞으로 1초 걸으면 -z 방향으로 걷는 속도만큼 간다', () => {
    const s = run(start, { forward: 1, strafe: 0, run: false }, 1);
    expect(s.x).toBeCloseTo(0, 5);
    expect(s.z).toBeCloseTo(-WALK_SPEED, 3);
  });
  it('달리면 더 빠르다', () => {
    const s = run(start, { forward: 1, strafe: 0, run: true }, 1);
    expect(s.z).toBeCloseTo(-RUN_SPEED, 3);
  });
  it('대각선이 더 빠르지 않다', () => {
    const s = run(start, { forward: 1, strafe: 1, run: false }, 1);
    expect(Math.hypot(s.x, s.z)).toBeCloseTo(WALK_SPEED, 3);
  });
  it('바라보는 방향을 따른다 (90도 왼쪽으로 돌면 -x로 간다)', () => {
    const s = run({ ...start, yaw: Math.PI / 2 }, { forward: 1, strafe: 0, run: false }, 1);
    expect(s.x).toBeCloseTo(-WALK_SPEED, 3);
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
