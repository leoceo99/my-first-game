import { rnd, TAU } from './util.js';

function sprite(stops, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

// layer 0: ground (under units) | 2: smoke (over canopy) | 3: additive light
const KINDS = {
  smoke: { spr: 'smoke', layer: 2 },
  dark: { spr: 'dark', layer: 2 },
  dust: { spr: 'dust', layer: 0 },
  splash: { spr: 'water', layer: 0 },
  fire: { spr: 'fire', layer: 3, add: true },
  flash: { spr: 'flash', layer: 3, add: true },
  glow: { spr: 'glow', layer: 3, add: true },
  tracer: { layer: 3, add: true },
  spark: { layer: 3, add: true },
  debris: { layer: 0 },
  ring: { layer: 0 },
};

export class FX {
  constructor() {
    this.list = [];
    this.wind = { x: 9, y: -5 };
    this.spr = {
      smoke: sprite([[0, 'rgba(175,172,165,0.85)'], [0.5, 'rgba(160,158,150,0.45)'], [1, 'rgba(150,148,140,0)']]),
      dark: sprite([[0, 'rgba(40,37,34,0.95)'], [0.5, 'rgba(45,42,38,0.55)'], [1, 'rgba(45,42,38,0)']]),
      dust: sprite([[0, 'rgba(150,128,92,0.8)'], [0.5, 'rgba(140,120,88,0.4)'], [1, 'rgba(140,120,88,0)']]),
      water: sprite([[0, 'rgba(220,235,235,0.9)'], [0.5, 'rgba(180,205,205,0.4)'], [1, 'rgba(180,205,205,0)']]),
      fire: sprite([[0, 'rgba(255,240,180,1)'], [0.3, 'rgba(255,170,60,0.9)'], [0.7, 'rgba(230,80,20,0.35)'], [1, 'rgba(200,50,10,0)']]),
      flash: sprite([[0, 'rgba(255,255,235,1)'], [0.35, 'rgba(255,225,140,0.8)'], [1, 'rgba(255,170,60,0)']]),
      glow: sprite([[0, 'rgba(255,190,110,0.55)'], [1, 'rgba(255,120,40,0)']]),
    };
  }

  add(kind, x, y, o = {}) {
    if (this.list.length > 3200 && (kind === 'smoke' || kind === 'dust' || kind === 'dark')) return;
    const life = o.life ?? 1;
    this.list.push({
      k: kind, def: KINDS[kind], x, y, z: o.z ?? 0,
      vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0,
      life, max: life, s: o.s ?? 10, gs: o.gs ?? 0, a: o.a ?? 1,
      drag: o.drag ?? 0, c: o.c, len: o.len ?? 0, wind: o.wind ?? 0,
    });
  }

  update(dt) {
    const L = this.list, w = this.wind;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L[i] = L[L.length - 1]; L.pop(); continue; }
      if (p.drag) { const f = Math.max(0, 1 - p.drag * dt); p.vx *= f; p.vy *= f; }
      p.vx += w.x * p.wind * dt; p.vy += w.y * p.wind * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.s += p.gs * dt;
      if (p.k === 'debris') {
        p.vz -= 520 * dt; p.z += p.vz * dt;
        if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.5; p.vy *= 0.5; }
      }
    }
  }

  draw(ctx, layer, view) {
    const L = this.list;
    let additive = false;
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < L.length; i++) {
      const p = L[i], d = p.def;
      if (d.layer !== layer) continue;
      if (p.x < view.x0 - 80 || p.x > view.x1 + 80 || p.y < view.y0 - 80 || p.y > view.y1 + 80) continue;
      if (!!d.add !== additive) {
        additive = !!d.add;
        ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over';
      }
      const t = p.life / p.max;
      if (d.spr) {
        const fade = t > 0.85 ? (1 - t) / 0.15 : t / 0.85;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.a * (p.k === 'flash' ? t : fade)));
        ctx.drawImage(this.spr[d.spr], p.x - p.s, p.y - p.z - p.s, p.s * 2, p.s * 2);
      } else if (p.k === 'tracer') {
        const sp = Math.hypot(p.vx, p.vy) || 1;
        ctx.globalAlpha = Math.min(1, p.a);
        ctx.strokeStyle = p.c;
        ctx.lineWidth = p.s;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - (p.vx / sp) * p.len, p.y - (p.vy / sp) * p.len);
        ctx.stroke();
      } else if (p.k === 'spark') {
        ctx.globalAlpha = t;
        ctx.strokeStyle = p.c || '#ffd27a';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      } else if (p.k === 'debris') {
        ctx.globalAlpha = Math.min(1, t * 3);
        if (p.z > 2) {
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(p.x - 1, p.y - 1, 2.5, 2.5);
        }
        ctx.fillStyle = p.c || '#3a3026';
        ctx.fillRect(p.x - p.s / 2, p.y - p.z - p.s / 2, p.s, p.s);
      } else if (p.k === 'ring') {
        ctx.globalAlpha = t * p.a;
        ctx.strokeStyle = p.c || 'rgba(255,240,210,1)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.s, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- presets ----------
  muzzle(x, y, a, big = false) {
    const s = big ? 22 : 7;
    this.add('flash', x, y, { life: big ? 0.12 : 0.05, s });
    if (big) {
      for (let i = 0; i < 6; i++) {
        const aa = a + rnd(-0.5, 0.5), sp = rnd(40, 160);
        this.add('smoke', x, y, { vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, life: rnd(1, 2.2), s: rnd(6, 10), gs: 14, drag: 2.5, a: 0.6, wind: 1 });
      }
    } else if (Math.random() < 0.3) {
      this.add('smoke', x, y, { vx: Math.cos(a) * 20, vy: Math.sin(a) * 20, life: 0.8, s: 3, gs: 8, a: 0.35, drag: 2, wind: 1 });
    }
  }

  tracer(x0, y0, x1, y1, color) {
    const d = Math.hypot(x1 - x0, y1 - y0) || 1;
    const sp = 1600;
    this.add('tracer', x0, y0, { vx: ((x1 - x0) / d) * sp, vy: ((y1 - y0) / d) * sp, life: d / sp, s: 1.3, len: Math.min(40, d), c: color, a: 0.9 });
  }

  impactDust(x, y, water) {
    this.add(water ? 'splash' : 'dust', x, y, { life: 0.5, s: 3, gs: 10, a: 0.7 });
  }

  sparks(x, y, n = 6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = rnd(80, 260);
      this.add('spark', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.15, 0.35), drag: 3 });
    }
  }

  explosion(x, y, sc = 1, water = false) {
    this.add('flash', x, y, { life: 0.14, s: 42 * sc });
    this.add('glow', x, y, { life: 0.5, s: 70 * sc, a: 0.8 });
    this.add('ring', x, y, { life: 0.3, s: 6, gs: 320 * sc, a: 0.5 });
    if (water) {
      for (let i = 0; i < 18 * sc; i++) {
        const a = Math.random() * TAU, sp = rnd(20, 140) * sc;
        this.add('splash', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.6, 1.4), s: rnd(5, 12) * sc, gs: 14, drag: 2.5, a: 0.8 });
      }
      return;
    }
    for (let i = 0; i < 9 * sc; i++) {
      const a = Math.random() * TAU, sp = rnd(30, 140) * sc;
      this.add('fire', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.25, 0.6), s: rnd(8, 18) * sc, gs: 20, drag: 3 });
    }
    for (let i = 0; i < 12 * sc; i++) {
      const a = Math.random() * TAU, sp = rnd(15, 90) * sc;
      this.add('dark', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(1.8, 4), s: rnd(8, 14) * sc, gs: rnd(10, 22) * sc, drag: 1.4, a: 0.75, wind: 1 });
    }
    for (let i = 0; i < 6 * sc; i++) {
      const a = Math.random() * TAU, sp = rnd(10, 50);
      this.add('smoke', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(3, 6), s: rnd(14, 20) * sc, gs: 9 * sc, drag: 0.8, a: 0.5, wind: 1.5 });
    }
    for (let i = 0; i < 12 * sc; i++) {
      const a = Math.random() * TAU, sp = rnd(40, 180) * sc;
      this.add('dust', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.6, 1.4), s: rnd(6, 12) * sc, gs: 16, drag: 2.5, a: 0.7 });
    }
    for (let i = 0; i < 12 * sc; i++) {
      const a = Math.random() * TAU, sp = rnd(40, 170) * sc;
      this.add('debris', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rnd(120, 300), life: rnd(1, 2), s: rnd(1.5, 3), c: Math.random() < 0.5 ? '#2e261d' : '#5a4a34' });
    }
    this.sparks(x, y, 6 * sc);
  }
}
