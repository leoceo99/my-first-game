import { clamp } from './util.js';

const GAP = { rifle: 0.035, mg: 0.03, explosion: 0.05, explosionSmall: 0.05, cannon: 0.05, rocket: 0.05, mortar: 0.05, whistle: 0.15, click: 0.03, order: 0.06 };

/** 모든 효과음은 WebAudio로 실시간 합성합니다 (외부 파일 없음). */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.lx = 0; this.ly = 0; this.lz = 1;
    this.last = {};
    this.muted = false;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.25;
    this.master = c.createGain();
    this.master.gain.value = 0.75;
    this.master.connect(this.comp);
    this.comp.connect(c.destination);
    const len = c.sampleRate * 3;
    const nb = c.createBuffer(1, len, c.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = nb;
    const bb = c.createBuffer(1, len, c.sampleRate);
    const e = bb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      e[i] = last * 3.5;
    }
    this.brown = bb;
    // iOS unlock
    const s = c.createBufferSource();
    s.buffer = c.createBuffer(1, 1, 22050);
    s.connect(c.destination);
    s.start(0);
    this.startAmbient();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.75;
  }

  setListener(x, y, z) { this.lx = x; this.ly = y; this.lz = z; }

  spatial(x, y, vol) {
    if (x == null) return { g: vol, pan: 0, lp: 20000 };
    const d = Math.hypot(x - this.lx, y - this.ly);
    const ref = 420 / Math.sqrt(this.lz);
    const g = vol / (1 + (d / ref) ** 2);
    if (g < 0.012) return null;
    return { g, pan: clamp(((x - this.lx) * this.lz) / 700, -0.85, 0.85), lp: clamp(20000 * Math.exp(-d / 850), 600, 20000) };
  }

  out(sp) {
    const c = this.ctx;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = sp.lp;
    if (c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = sp.pan;
      lp.connect(p); p.connect(this.master);
    } else lp.connect(this.master);
    return lp;
  }

  burst(dest, { t, dur, type = 'lowpass', f, f1, q = 0.7, gain, attack = 0.002, brown = false, rate = 1 }) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = brown ? this.brown : this.noise;
    s.playbackRate.value = rate;
    const fl = c.createBiquadFilter();
    fl.type = type;
    fl.frequency.setValueAtTime(f, t);
    if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    fl.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(dest);
    const off = Math.random() * Math.max(0, 2.8 - dur);
    s.start(t, off, dur + 0.05);
  }

  tone(dest, { t, dur, f0, f1, gain, type = 'sine', attack = 0.004 }) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  play(name, x = null, y = null, vol = 1) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const gap = GAP[name] ?? 0.02;
    if (this.last[name] && now - this.last[name] < gap) return;
    this.last[name] = now;
    const sp = this.spatial(x, y, vol);
    if (!sp) return;
    const dest = this.out(sp);
    const g = sp.g, t = now;
    const r = 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'rifle':
        this.burst(dest, { t, dur: 0.16, type: 'bandpass', f: 1700 * r, q: 0.9, gain: 0.5 * g });
        this.burst(dest, { t, dur: 0.3, f: 520, gain: 0.45 * g });
        break;
      case 'mg':
        this.burst(dest, { t, dur: 0.09, type: 'bandpass', f: 1350 * r, q: 0.9, gain: 0.38 * g });
        this.burst(dest, { t, dur: 0.15, f: 420, gain: 0.38 * g });
        break;
      case 'cannon':
        this.burst(dest, { t, dur: 0.08, type: 'bandpass', f: 2600, q: 0.6, gain: 0.45 * g });
        this.burst(dest, { t, dur: 1.1, f: 1000, f1: 140, gain: 1.0 * g });
        this.tone(dest, { t, dur: 0.5, f0: 95, f1: 38, gain: 0.8 * g });
        break;
      case 'explosion':
        this.burst(dest, { t, dur: 1.8, f: 1300, f1: 110, gain: 1.15 * g });
        this.burst(dest, { t, dur: 2.4, f: 320, gain: 1.0 * g, brown: true });
        this.tone(dest, { t, dur: 0.9, f0: 62, f1: 26, gain: 0.9 * g });
        break;
      case 'explosionSmall':
        this.burst(dest, { t, dur: 0.9, f: 1600, f1: 200, gain: 0.85 * g });
        this.tone(dest, { t, dur: 0.4, f0: 85, f1: 35, gain: 0.5 * g });
        break;
      case 'rocket':
        this.burst(dest, { t, dur: 0.5, type: 'bandpass', f: 800, f1: 3200, q: 1.2, gain: 0.5 * g, attack: 0.04 });
        this.burst(dest, { t, dur: 0.2, f: 600, gain: 0.4 * g });
        break;
      case 'mortar':
        this.tone(dest, { t, dur: 0.2, f0: 170, f1: 65, gain: 0.6 * g });
        this.burst(dest, { t, dur: 0.35, f: 700, gain: 0.5 * g });
        break;
      case 'whistle':
        this.tone(dest, { t, dur: 1.0, f0: 1500 * r, f1: 480, gain: 0.1 * g, attack: 0.25 });
        break;
      case 'capture':
        this.tone(dest, { t, dur: 0.16, f0: 660, gain: 0.18, type: 'triangle' });
        this.tone(dest, { t: t + 0.15, dur: 0.3, f0: 990, gain: 0.18, type: 'triangle' });
        break;
      case 'lost':
        this.tone(dest, { t, dur: 0.2, f0: 440, gain: 0.18, type: 'triangle' });
        this.tone(dest, { t: t + 0.18, dur: 0.35, f0: 300, gain: 0.18, type: 'triangle' });
        break;
      case 'click':
        this.tone(dest, { t, dur: 0.04, f0: 1400, gain: 0.05, type: 'square' });
        break;
      case 'order':
        this.tone(dest, { t, dur: 0.06, f0: 560, gain: 0.09, type: 'triangle' });
        this.tone(dest, { t: t + 0.06, dur: 0.08, f0: 840, gain: 0.08, type: 'triangle' });
        break;
      case 'deploy':
        this.tone(dest, { t, dur: 0.12, f0: 392, gain: 0.12, type: 'triangle' });
        this.tone(dest, { t: t + 0.1, dur: 0.12, f0: 523, gain: 0.12, type: 'triangle' });
        this.tone(dest, { t: t + 0.2, dur: 0.25, f0: 659, gain: 0.12, type: 'triangle' });
        break;
      case 'denied':
        this.tone(dest, { t, dur: 0.15, f0: 180, gain: 0.12, type: 'square' });
        break;
    }
  }

  startAmbient() {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.brown;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    const g = c.createGain();
    g.gain.value = 0.05;
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start();
    const distant = () => {
      if (this.ctx && this.ctx.state === 'running' && !this.muted) {
        const t = this.ctx.currentTime;
        const dest = this.out({ g: 1, pan: Math.random() * 1.6 - 0.8, lp: 260 + Math.random() * 200 });
        this.burst(dest, { t, dur: 2.5, f: 300, f1: 60, gain: 0.25 + Math.random() * 0.25, brown: true });
      }
      setTimeout(distant, 4000 + Math.random() * 9000);
    };
    setTimeout(distant, 3000);
  }
}
