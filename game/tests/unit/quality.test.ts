import { describe, expect, it } from 'vitest';
import { AutoQuality, effectivePixelRatio, nextQuality, pickQuality, QUALITY, QUALITY_LEVELS } from '../../src/sim/quality';

describe('화질 단계', () => {
  it('단계가 오를수록 비싼 설정이 같거나 커진다', () => {
    const [lo, mid, hi] = QUALITY_LEVELS.map((l) => QUALITY[l]);
    expect(lo.pixelRatioCap).toBeLessThan(mid.pixelRatioCap);
    expect(mid.pixelRatioCap).toBeLessThan(hi.pixelRatioCap);
    expect(lo.shadows).toBe(false);
    expect(mid.shadows && hi.shadows).toBe(true);
    expect(mid.shadowMapSize).toBeLessThan(hi.shadowMapSize);
    expect(lo.postFx).toBe('none');
  });
  it('고르기 순서: 주소 → 저장 → 기본(보통), 틀린 값은 무시', () => {
    expect(pickQuality('high', 'low')).toEqual({ level: 'high', source: 'url' });
    expect(pickQuality('ultra', 'low')).toEqual({ level: 'low', source: 'saved' });
    expect(pickQuality(null, 'garbage')).toEqual({ level: 'medium', source: 'default' });
  });
  it('버튼은 낮음→보통→높음→낮음으로 돈다', () => {
    expect(nextQuality('low')).toBe('medium');
    expect(nextQuality('high')).toBe('low');
  });
  it('화면 배율은 기기 배율과 단계 상한 중 작은 값', () => {
    expect(effectivePixelRatio(2, QUALITY.high)).toBe(1.5);
    expect(effectivePixelRatio(1, QUALITY.high)).toBe(1);
    expect(effectivePixelRatio(1, QUALITY.low)).toBe(0.75);
    expect(effectivePixelRatio(0, QUALITY.medium)).toBe(1);
  });
});

describe('자동 낮춤', () => {
  const run = (a: AutoQuality, secs: number, fps: number, level: 'low' | 'medium' | 'high') => {
    let out = null;
    for (let t = 0; t < secs && !out; t += 0.1) out = a.update(0.1, fps, level);
    return out;
  };
  it('준비 시간이 지나고 6초 넘게 느리면 한 단계 낮춘다', () => {
    const a = new AutoQuality(true);
    expect(run(a, 9, 20, 'high')).toBeNull(); // 4초 준비 + 5초 느림 → 아직
    expect(run(a, 2, 20, 'high')).toBe('medium');
  });
  it('중간에 빨라지면 처음부터 다시 센다', () => {
    const a = new AutoQuality(true, 27, 6, 0);
    expect(run(a, 5, 20, 'medium')).toBeNull();
    a.update(0.1, 50, 'medium');
    expect(run(a, 5, 20, 'medium')).toBeNull();
  });
  it('꺼져 있거나 이미 낮음이면 바꾸지 않는다', () => {
    expect(run(new AutoQuality(false, 27, 6, 0), 20, 5, 'high')).toBeNull();
    const a = new AutoQuality(true, 27, 6, 0);
    expect(run(a, 20, 5, 'low')).toBeNull();
    expect(a.enabled).toBe(false);
  });
});
