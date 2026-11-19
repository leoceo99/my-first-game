// 자동 성능 측정 진행표 (E-1). 화질 단계를 차례로 바꿔 가며 같은 동작(제자리 한 바퀴 돌며 걷기)을
// 똑같은 시간 동안 재고 단계별 결과를 모은다. 화면과 분리된 순수 로직이라 시간 흐름을 테스트할 수 있다.
import { PerfRecorder, type PerfSummary } from './perf';
import type { QualityLevel } from './quality';

export interface BenchResult extends PerfSummary {
  level: QualityLevel;
  drawCalls: number;
  triangles: number;
}

export interface BenchStep {
  /** 지금 써야 할 화질 단계 */
  level: QualityLevel;
  /** 측정 중 주인공의 바라보는 방향(라디안). 한 단계 동안 한 바퀴 돈다 */
  yaw: number;
  /** 'warmup' = 단계를 바꾼 직후 준비 시간(기록 안 함), 'measure' = 기록 중 */
  phase: 'warmup' | 'measure';
}

export class BenchRun {
  private idx = 0;
  private t = 0;
  private rec = new PerfRecorder();
  private draw = 0;
  private tris = 0;
  private renderSamples = 0;
  readonly results: BenchResult[] = [];
  done = false;

  constructor(
    readonly levels: readonly QualityLevel[],
    readonly warmupSec = 1.5,
    readonly measureSec = 6,
  ) {
    if (levels.length === 0) this.done = true;
  }

  /** 지금 무엇을 해야 하는지. 끝났으면 null */
  current(): BenchStep | null {
    if (this.done) return null;
    const inMeasure = this.t >= this.warmupSec;
    const k = inMeasure ? (this.t - this.warmupSec) / this.measureSec : 0;
    return { level: this.levels[this.idx], yaw: k * Math.PI * 2, phase: inMeasure ? 'measure' : 'warmup' };
  }

  /**
   * 프레임 하나가 지난 뒤 호출한다. frameMs는 실제 프레임 간격, drawCalls·triangles는 렌더러가 센 값.
   * 단계가 바뀌면 true를 돌려준다(호출한 쪽이 화질을 바꿔야 함).
   */
  advance(frameMs: number, drawCalls = 0, triangles = 0): boolean {
    if (this.done) return false;
    const measuring = this.t >= this.warmupSec;
    this.t += frameMs / 1000;
    if (measuring) {
      this.rec.add(frameMs);
      this.draw += drawCalls;
      this.tris += triangles;
      this.renderSamples++;
    }
    if (this.t < this.warmupSec + this.measureSec) return false;
    const n = Math.max(1, this.renderSamples);
    this.results.push({ level: this.levels[this.idx], ...this.rec.summary(), drawCalls: Math.round(this.draw / n), triangles: Math.round(this.tris / n) });
    this.idx++;
    this.t = 0;
    this.rec.reset();
    this.draw = this.tris = this.renderSamples = 0;
    if (this.idx >= this.levels.length) { this.done = true; return false; }
    return true;
  }

  /** 0~1 진행률 */
  get progress(): number {
    if (this.done) return 1;
    const per = this.warmupSec + this.measureSec;
    return Math.min(1, (this.idx * per + this.t) / (per * this.levels.length));
  }
}
