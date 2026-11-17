// 걸음 박자: 땅 위에서 실제로 움직인 거리로 발걸음을 센다 → 발이 미끄러져 보이지 않고, 발소리가 발 닿는 순간에 난다.
import { RUN_SPEED, WALK_SPEED } from './player';

export interface Gait {
  /** 땅 위에서 누적한 걸음 거리(걸음 단위). 정수가 바뀔 때마다 발이 땅에 닿는다 */
  steps: number;
  wasOnGround: boolean;
}
export type GaitEvent = { kind: 'step'; foot: 'left' | 'right'; intensity: number } | { kind: 'land'; intensity: number } | { kind: 'jump' };

export const WALK_STRIDE = 0.72; // 한 걸음 길이(m) — 걸을 때
export const RUN_STRIDE = 1.45; // 달릴 때

/** 0=걷기, 1=달리기 사이의 비율 */
export function runBlend(speed: number): number {
  return Math.max(0, Math.min(1, (speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));
}
export function strideFor(speed: number): number {
  return WALK_STRIDE + (RUN_STRIDE - WALK_STRIDE) * runBlend(speed);
}

export function newGait(): Gait {
  return { steps: 0, wasOnGround: true };
}

/** 이동 거리와 속력으로 걸음을 진행하고, 발 닿음·점프·착지 사건을 돌려준다. */
export function advanceGait(g: Gait, distance: number, speed: number, onGround: boolean, fallSpeed = 0): { gait: Gait; events: GaitEvent[] } {
  const events: GaitEvent[] = [];
  let steps = g.steps;
  if (g.wasOnGround && !onGround) events.push({ kind: 'jump' });
  if (!g.wasOnGround && onGround) {
    events.push({ kind: 'land', intensity: Math.min(1, 0.4 + fallSpeed / 8) });
    steps = Math.ceil(steps); // 착지하면 걸음 박자를 새로 맞춘다
  }
  if (onGround && speed > 0.05) {
    const before = Math.floor(steps);
    steps += distance / strideFor(speed);
    const after = Math.floor(steps);
    for (let i = before + 1; i <= after; i++) {
      events.push({ kind: 'step', foot: i % 2 === 0 ? 'left' : 'right', intensity: 0.35 + 0.65 * runBlend(speed) });
    }
  }
  return { gait: { steps, wasOnGround: onGround }, events };
}

/** 걷기 위상(라디안). 한 걸음 = π. 애니메이션이 쓴다 */
export function gaitPhase(g: Gait): number {
  // 걸음 수가 정수일 때 다리가 가장 벌어져 발뒤꿈치가 닿는다 (짝수=왼발 앞)
  return g.steps * Math.PI + Math.PI / 2;
}
