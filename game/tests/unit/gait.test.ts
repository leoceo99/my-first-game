import { describe, expect, it } from 'vitest';
import { advanceGait, newGait, WALK_STRIDE, RUN_STRIDE, type GaitEvent } from '../../src/sim/gait';
import { WALK_SPEED, RUN_SPEED } from '../../src/sim/player';
import { surfaceAt } from '../../src/sim/surface';

function walk(meters: number, speed: number) {
  let g = newGait();
  const events: GaitEvent[] = [];
  const dt = 1 / 60;
  for (let d = 0; d < meters; d += speed * dt) {
    const r = advanceGait(g, speed * dt, speed, true);
    g = r.gait; events.push(...r.events);
  }
  return events.filter((e) => e.kind === 'step');
}

describe('걸음과 발소리', () => {
  it('걸을 때 한 걸음 길이마다 발소리가 한 번, 왼발·오른발 번갈아', () => {
    const ev = walk(7.2, WALK_SPEED);
    expect(ev.length).toBe(Math.round(7.2 / WALK_STRIDE));
    const feet = ev.map((e) => (e as any).foot);
    for (let i = 1; i < feet.length; i++) expect(feet[i]).not.toBe(feet[i - 1]);
  });
  it('달리면 보폭이 넓어 같은 거리에 발소리가 적고 더 세다', () => {
    const w = walk(14.5, WALK_SPEED), r = walk(14.5, RUN_SPEED);
    expect(r.length).toBe(Math.round(14.5 / RUN_STRIDE));
    expect(r.length).toBeLessThan(w.length);
    expect((r[0] as any).intensity).toBeGreaterThan((w[0] as any).intensity);
  });
  it('공중에서는 발소리가 없고, 착지할 때 착지 소리', () => {
    let g = newGait();
    let r = advanceGait(g, 0.1, 3, false);
    expect(r.events.map((e) => e.kind)).toEqual(['jump']);
    r = advanceGait(r.gait, 2, 3, false);
    expect(r.events).toEqual([]);
    r = advanceGait(r.gait, 0.05, 3, true, 4);
    expect(r.events[0].kind).toBe('land');
  });
  it('멈춰 있으면 발소리가 없다', () => {
    expect(advanceGait(newGait(), 0, 0, true).events).toEqual([]);
  });
});

describe('바닥 재질', () => {
  it('흙길·풀밭·우물 광장 돌바닥', () => {
    expect(surfaceAt(0, 0)).toBe('dirt');
    expect(surfaceAt(6, 0)).toBe('grass');
    expect(surfaceAt(0, 9)).toBe('stone');
    expect(surfaceAt(3, 9)).toBe('stone');
  });
});
