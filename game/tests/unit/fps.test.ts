import { describe, expect, it } from 'vitest';
import { FpsMeter } from '../../src/sim/fps';

describe('fps 측정기', () => {
  it('60fps 간격이면 60 근처를 낸다', () => {
    const m = new FpsMeter();
    for (let i = 0; i <= 120; i++) m.tick(i * (1000 / 60));
    expect(m.fps).toBeGreaterThanOrEqual(59);
    expect(m.fps).toBeLessThanOrEqual(61);
  });
  it('기록이 부족하면 0', () => {
    const m = new FpsMeter();
    m.tick(0);
    expect(m.fps).toBe(0);
  });
});
