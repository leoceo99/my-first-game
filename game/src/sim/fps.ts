// 초당 화면 수(fps) 측정기. 화면과 분리된 순수 로직이라 자동 테스트가 가능하다.
export class FpsMeter {
  private frames: number[] = [];
  constructor(private windowMs = 1000) {}

  /** 프레임이 그려진 시각(ms)을 기록한다. */
  tick(nowMs: number): void {
    this.frames.push(nowMs);
    const cutoff = nowMs - this.windowMs;
    while (this.frames.length > 0 && this.frames[0] <= cutoff) this.frames.shift();
  }

  /** 최근 windowMs 동안의 fps. 기록이 2개 미만이면 0. */
  get fps(): number {
    if (this.frames.length < 2) return 0;
    const span = this.frames[this.frames.length - 1] - this.frames[0];
    if (span <= 0) return 0;
    return Math.round(((this.frames.length - 1) * 1000) / span);
  }
}
