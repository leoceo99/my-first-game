import { describe, expect, it } from 'vitest';
import { judge, PerfRecorder } from '../../src/sim/perf';
import { BenchRun } from '../../src/sim/bench';

describe('성능 통계', () => {
  it('고른 60fps면 평균·저점 모두 60', () => {
    const r = new PerfRecorder();
    for (let i = 0; i < 300; i++) r.add(1000 / 60);
    const s = r.summary();
    expect(s.avgFps).toBeCloseTo(60, 0);
    expect(s.low1Fps).toBeCloseTo(60, 0);
    expect(judge(s)).toBe('ok');
  });
  it('가끔 끊기면 평균은 높아도 1% 저점이 낮게 나온다', () => {
    const r = new PerfRecorder();
    for (let i = 0; i < 297; i++) r.add(16);
    for (let i = 0; i < 3; i++) r.add(200); // 0.2초 멈칫 3번
    const s = r.summary();
    expect(s.avgFps).toBeGreaterThan(50);
    expect(s.low1Fps).toBeLessThan(10);
    expect(s.maxMs).toBe(200);
    expect(judge(s)).toBe('borderline');
  });
  it('잘못된 값은 버리고, 기록 없으면 0·느림', () => {
    const r = new PerfRecorder();
    r.add(0); r.add(-5); r.add(NaN); r.add(Infinity);
    expect(r.count).toBe(0);
    expect(judge(r.summary())).toBe('slow');
  });
  it('최대 개수를 넘으면 오래된 것부터 버린다', () => {
    const r = new PerfRecorder(10);
    for (let i = 0; i < 10; i++) r.add(100);
    for (let i = 0; i < 10; i++) r.add(10);
    expect(r.summary().avgMs).toBe(10);
  });
});

describe('자동 성능 측정 진행표', () => {
  it('단계마다 준비 후 측정하고 결과를 하나씩 남긴다', () => {
    const b = new BenchRun(['low', 'medium', 'high'], 1, 2);
    const changes: string[] = [];
    let guard = 0;
    while (!b.done && guard++ < 10000) {
      const cur = b.current()!;
      const ms = cur.level === 'low' ? 10 : cur.level === 'medium' ? 20 : 40;
      if (b.advance(ms, 50, 1000)) changes.push(b.current()!.level);
    }
    expect(changes).toEqual(['medium', 'high']);
    expect(b.results.map((r) => r.level)).toEqual(['low', 'medium', 'high']);
    expect(b.results[0].avgFps).toBeCloseTo(100, 0);
    expect(b.results[2].avgFps).toBeCloseTo(25, 0);
    expect(b.results[1].drawCalls).toBe(50);
    expect(b.progress).toBe(1);
    expect(b.current()).toBeNull();
  });
  it('측정 동안 한 바퀴(2π) 돈다, 준비 중에는 기록하지 않는다', () => {
    const b = new BenchRun(['low'], 1, 2);
    b.advance(500);
    expect(b.current()!.phase).toBe('warmup');
    b.advance(500); b.advance(1000);
    expect(b.current()!.phase).toBe('measure');
    expect(b.current()!.yaw).toBeCloseTo(Math.PI, 5);
    b.advance(1000);
    expect(b.done).toBe(true);
    expect(b.results[0].frames).toBe(2);
  });
});
