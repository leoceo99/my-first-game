import type { Surface } from '../sim/surface';

/**
 * 효과음: 녹음 파일 없이 브라우저에서 바로 합성한다(잡음 + 필터 + 음량 곡선).
 * → 라이선스 걱정이 없고 파일 크기 0. 정식 소리(녹음·CC0 에셋)로 바꿀 때까지 쓰는 임시 소리.
 * 브라우저 규칙상 첫 클릭·터치·키 입력 뒤에만 소리가 난다.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** 첫 사용자 입력 때 부른다 */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  private ready() { return this.ctx && this.master && this.noise && this.ctx.state === 'running'; }
  private jitter(v: number, amt = 0.15) { return v * (1 + (Math.random() * 2 - 1) * amt); }

  /** 잡음 한 번: 필터 종류·주파수, 길이, 음량 */
  private burst(opts: { type: BiquadFilterType; freq: number; q?: number; dur: number; gain: number; delay?: number; freqEnd?: number; attack?: number }) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    src.playbackRate.value = this.jitter(1, 0.2);
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t0 + opts.dur);
    f.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    const att = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain, t0 + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + opts.dur + 0.05);
  }

  /** 낮은 '쿵' (사인파가 아래로 미끄러짐) */
  private thump(freq: number, dur: number, gain: number, delay = 0) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master!);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  /** 발소리: 바닥 재질마다 다르게. intensity 0~1 (걷기≈0.35, 달리기≈1) */
  footstep(surface: Surface, intensity: number) {
    if (!this.ready()) return;
    const k = 0.25 + 0.75 * intensity;
    if (surface === 'grass') {
      // 풀: 높은 '사각' + 뒤따르는 작은 스침
      this.burst({ type: 'bandpass', freq: this.jitter(2600), q: 0.6, dur: 0.13 + 0.05 * intensity, gain: 0.22 * k });
      this.burst({ type: 'highpass', freq: this.jitter(4000), dur: 0.07, gain: 0.08 * k, delay: 0.04 });
      this.thump(this.jitter(70), 0.06, 0.12 * k);
    } else if (surface === 'dirt') {
      // 흙: 둔한 '턱' + 모래알 부서지는 소리
      this.thump(this.jitter(85), 0.08, 0.35 * k);
      this.burst({ type: 'lowpass', freq: this.jitter(900), dur: 0.09, gain: 0.3 * k });
      this.burst({ type: 'bandpass', freq: this.jitter(3000), q: 1.2, dur: 0.05, gain: 0.07 * k, delay: 0.015 });
    } else {
      // 돌: 짧고 딱딱한 '탁' + 가벼운 울림
      this.burst({ type: 'bandpass', freq: this.jitter(3200), q: 2.5, dur: 0.04, gain: 0.35 * k });
      this.thump(this.jitter(190), 0.045, 0.22 * k);
      this.burst({ type: 'bandpass', freq: this.jitter(2400), q: 3, dur: 0.06, gain: 0.06 * k, delay: 0.05 });
    }
  }

  /** 착지: 두 발이 거의 함께 닿는 소리 */
  land(surface: Surface, intensity: number) {
    if (!this.ready()) return;
    this.footstep(surface, Math.min(1, intensity + 0.3));
    setTimeout(() => this.footstep(surface, intensity * 0.7), 35);
  }

  /** 점프: 옷자락 펄럭 */
  jump() {
    if (!this.ready()) return;
    this.burst({ type: 'bandpass', freq: 900, freqEnd: 1800, q: 0.7, dur: 0.16, gain: 0.08, attack: 0.03 });
  }

  /** 칼 휘두르는 바람 소리 */
  swoosh(dur = 0.22) {
    if (!this.ready()) return;
    this.burst({ type: 'bandpass', freq: 500, freqEnd: 2600, q: 1.6, dur, gain: 0.35, attack: dur * 0.45 });
  }

  /** 칼 뽑기·넣기: 쇠가 스치는 소리 */
  draw() {
    if (!this.ready()) return;
    this.burst({ type: 'bandpass', freq: 5200, freqEnd: 7000, q: 9, dur: 0.32, gain: 0.12, attack: 0.05 });
    this.burst({ type: 'highpass', freq: 3000, dur: 0.2, gain: 0.04, delay: 0.05 });
  }

  /** 짚 허수아비를 벤 소리 */
  hit() {
    if (!this.ready()) return;
    this.thump(140, 0.12, 0.45);
    this.burst({ type: 'lowpass', freq: 1800, dur: 0.18, gain: 0.35 });
    this.burst({ type: 'bandpass', freq: 3500, q: 1, dur: 0.25, gain: 0.1, delay: 0.03 });
  }
}
