// 성능 통계 (E-1). 프레임 시간(ms)을 모아 평균 fps, 느린 1% fps, 가장 느린 프레임을 낸다.
// "평균은 괜찮은데 가끔 뚝 끊기는" 문제를 잡으려면 평균만으로는 부족해서 느린 쪽 값도 같이 본다.

export interface PerfSummary {
  frames: number;
  /** 평균 fps (전체 시간 기준) */
  avgFps: number;
  /** 평균 프레임 시간 ms */
  avgMs: number;
  /** 가장 느린 1% 프레임들의 평균을 fps로 바꾼 값 ("1% 저점") */
  low1Fps: number;
  /** 95% 프레임이 이 시간 안에 그려짐 (ms) */
  p95Ms: number;
  /** 가장 느린 프레임 ms */
  maxMs: number;
}

export class PerfRecorder {
  private samples: number[] = [];
  constructor(private readonly maxSamples = 3600) {}

  /** 프레임 하나의 걸린 시간(ms)을 기록한다. 0 이하나 숫자가 아닌 값은 버린다. */
  add(frameMs: number): void {
    if (!(frameMs > 0) || !Number.isFinite(frameMs)) return;
    this.samples.push(frameMs);
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  reset(): void { this.samples = []; }

  get count(): number { return this.samples.length; }

  summary(): PerfSummary {
    const n = this.samples.length;
    if (n === 0) return { frames: 0, avgFps: 0, avgMs: 0, low1Fps: 0, p95Ms: 0, maxMs: 0 };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const total = sorted.reduce((s, v) => s + v, 0);
    const avgMs = total / n;
    const worstCount = Math.max(1, Math.ceil(n * 0.01));
    const worst = sorted.slice(n - worstCount);
    const worstAvg = worst.reduce((s, v) => s + v, 0) / worst.length;
    const p95Ms = sorted[Math.min(n - 1, Math.ceil(n * 0.95) - 1)];
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      frames: n,
      avgFps: r1(1000 / avgMs),
      avgMs: r1(avgMs),
      low1Fps: r1(1000 / worstAvg),
      p95Ms: r1(p95Ms),
      maxMs: r1(sorted[n - 1]),
    };
  }
}

/** 판정: 목표(30fps)를 평균과 1% 저점 기준으로 본다. */
export function judge(s: PerfSummary, targetFps = 30): 'ok' | 'borderline' | 'slow' {
  if (s.frames === 0) return 'slow';
  if (s.avgFps >= targetFps && s.low1Fps >= targetFps * 0.66) return 'ok';
  if (s.avgFps >= targetFps * 0.85) return 'borderline';
  return 'slow';
}
