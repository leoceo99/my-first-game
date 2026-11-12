import { mulberry32, makeNoise, clamp, dist, MinHeap, TAU } from './util.js';

export const W = 2800, H = 2000, CELL = 40;
export const COLS = W / CELL, ROWS = H / CELL;
export const T = { GRASS: 0, ROAD: 1, FOREST: 2, BUILDING: 3, WATER: 4, BRIDGE: 5, FIELD: 6 };
export const RIVER_HALF = 40;

export function riverX(y) {
  return 1420 + Math.sin(y * 0.0029 + 0.4) * 120 + Math.sin(y * 0.0077 + 1.3) * 40;
}

export const HQ = [{ x: 210, y: 1790 }, { x: 2590, y: 210 }];
export const POINTS_DEF = [
  { id: 'A', name: '농장', x: 640, y: 1450 },
  { id: 'B', name: '마을', x: 720, y: 600 },
  { id: 'C', name: '다리', x: riverX(1000), y: 1000 },
  { id: 'D', name: '교회', x: 2080, y: 1400 },
  { id: 'E', name: '공장', x: 2160, y: 560 },
];

function roadDefs() {
  const [A, B, C, D, E] = POINTS_DEF;
  const rx = riverX;
  const cl = { x: rx(1000) - 170, y: 1010 }, cr = { x: rx(1000) + 170, y: 990 };
  return [
    [HQ[0], { x: 400, y: 1620 }, A, { x: 980, y: 1230 }, cl, C, cr, { x: 1820, y: 780 }, E, { x: 2400, y: 380 }, HQ[1]],
    [B, { x: 1050, y: 380 }, { x: rx(330) - 170, y: 330 }, { x: rx(330), y: 330 }, { x: rx(330) + 170, y: 330 }, { x: 1880, y: 420 }, E],
    [A, { x: 980, y: 1700 }, { x: rx(1700) - 170, y: 1700 }, { x: rx(1700), y: 1700 }, { x: rx(1700) + 170, y: 1700 }, { x: 1850, y: 1600 }, D],
    [B, { x: 1000, y: 820 }, cl],
    [cr, { x: 1750, y: 1200 }, D],
    [HQ[0], { x: 330, y: 1150 }, B],
    [D, { x: 2450, y: 950 }, HQ[1]],
  ];
}

function sampleSpline(pts, step = 8) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const n = Math.max(2, Math.ceil(len / step));
    for (let j = 0; j < n; j++) {
      const t = j / n, t2 = t * t, t3 = t2 * t;
      const f = (a0, a1, a2, a3) => 0.5 * (2 * a1 + (-a0 + a2) * t + (2 * a0 - 5 * a1 + 4 * a2 - a3) * t2 + (-a0 + 3 * a1 - 3 * a2 + a3) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
  return out;
}

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function strokePath(g, pts, width, color, offset = 0) {
  g.beginPath();
  for (let i = 0; i < pts.length; i++) {
    let x = pts[i].x, y = pts[i].y;
    if (offset) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      x += (-dy / l) * offset; y += (dx / l) * offset;
    }
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.lineWidth = width;
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke();
}

export class GameMap {
  constructor(seed = 1944) {
    this.rng = mulberry32(seed);
    this.noise = makeNoise(this.rng);
    this.type = new Uint8Array(COLS * ROWS);
    this.cover = new Float32Array(COLS * ROWS).fill(1);
    this.buildings = [];
    this.sandbags = [];
    this.fields = [];
    // A* buffers
    this._g = new Float32Array(COLS * ROWS);
    this._from = new Int32Array(COLS * ROWS);
    this._closed = new Uint8Array(COLS * ROWS);
    this._heap = new MinHeap();
    this.generate();
    this.render();
  }

  // ---------- queries ----------
  idx(gx, gy) { return gy * COLS + gx; }
  cellType(gx, gy) {
    if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) return T.BUILDING;
    return this.type[gy * COLS + gx];
  }
  typeAt(x, y) { return this.cellType(Math.floor(x / CELL), Math.floor(y / CELL)); }
  walkableCell(gx, gy) {
    const t = this.cellType(gx, gy);
    return t !== T.BUILDING && t !== T.WATER;
  }
  blockedPx(x, y) {
    if (x < 4 || y < 4 || x > W - 4 || y > H - 4) return true;
    return !this.walkableCell(Math.floor(x / CELL), Math.floor(y / CELL));
  }
  speedMul(x, y, vehicle) {
    const t = this.typeAt(x, y);
    if (t === T.ROAD || t === T.BRIDGE) return 1.25;
    if (t === T.FOREST) return vehicle ? 0.5 : 0.82;
    if (t === T.FIELD) return 0.92;
    return 1;
  }
  /** damage multiplier for infantry standing at x,y (lower = better cover) */
  coverAt(x, y) {
    const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
    let c = (gx >= 0 && gy >= 0 && gx < COLS && gy < ROWS) ? this.cover[gy * COLS + gx] : 1;
    for (const s of this.sandbags) {
      const d = Math.hypot(x - s.x, y - s.y);
      if (Math.abs(d - s.r) < 16) {
        const a = Math.atan2(y - s.y, x - s.x);
        let da = a - s.a;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        if (Math.abs(da) < s.span / 2 + 0.12) c = Math.min(c, 0.45);
      }
    }
    return c;
  }
  inForest(x, y) { return this.typeAt(x, y) === T.FOREST; }

  losBlocked(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
    const n = Math.ceil(d / 20);
    let forest = 0;
    for (let i = 1; i < n; i++) {
      const x = x0 + (dx * i) / n, y = y0 + (dy * i) / n;
      const t = this.typeAt(x, y);
      if (t === T.BUILDING) return true;
      if (t === T.FOREST && i > 1 && i < n - 1) { forest++; if (forest >= 5) return true; }
    }
    return false;
  }

  lineClear(a, b, clr) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d < 1) return true;
    const nx = -dy / d * clr, ny = dx / d * clr;
    const n = Math.ceil(d / 10);
    for (let i = 1; i <= n; i++) {
      const x = a.x + (dx * i) / n, y = a.y + (dy * i) / n;
      if (this.blockedPx(x, y) || this.blockedPx(x + nx, y + ny) || this.blockedPx(x - nx, y - ny)) return false;
    }
    return true;
  }

  nearestWalkableCell(gx, gy) {
    if (this.walkableCell(gx, gy)) return [gx, gy];
    for (let r = 1; r < 14; r++) {
      let best = null, bd = 1e9;
      for (let y = gy - r; y <= gy + r; y++) {
        for (let x = gx - r; x <= gx + r; x++) {
          if (Math.max(Math.abs(x - gx), Math.abs(y - gy)) !== r) continue;
          if (!this.walkableCell(x, y)) continue;
          const d = (x - gx) ** 2 + (y - gy) ** 2;
          if (d < bd) { bd = d; best = [x, y]; }
        }
      }
      if (best) return best;
    }
    return [gx, gy];
  }
  nearestWalkablePx(x, y) {
    if (!this.blockedPx(x, y)) return { x, y };
    const [gx, gy] = this.nearestWalkableCell(Math.floor(x / CELL), Math.floor(y / CELL));
    return { x: gx * CELL + CELL / 2, y: gy * CELL + CELL / 2 };
  }

  findPath(sx, sy, tx, ty, vehicle) {
    let [sgx, sgy] = this.nearestWalkableCell(Math.floor(sx / CELL), Math.floor(sy / CELL));
    let [ggx, ggy] = this.nearestWalkableCell(Math.floor(tx / CELL), Math.floor(ty / CELL));
    const goalPx = this.blockedPx(tx, ty) ? { x: ggx * CELL + CELL / 2, y: ggy * CELL + CELL / 2 } : { x: tx, y: ty };
    const start = this.idx(sgx, sgy), goal = this.idx(ggx, ggy);
    if (start === goal) return [goalPx];
    const g = this._g, from = this._from, closed = this._closed, heap = this._heap;
    g.fill(Infinity); from.fill(-1); closed.fill(0); heap.clear();
    g[start] = 0;
    const h = (gx, gy) => {
      const dx = Math.abs(gx - ggx), dy = Math.abs(gy - ggy);
      return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)) * 0.75;
    };
    heap.push(h(sgx, sgy), start);
    let found = false, iter = 0;
    while (heap.size && iter++ < 8000) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === goal) { found = true; break; }
      const cx = cur % COLS, cy = (cur / COLS) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (!this.walkableCell(nx, ny)) continue;
          if (dx && dy && (!this.walkableCell(cx + dx, cy) || !this.walkableCell(cx, cy + dy))) continue;
          const ni = ny * COLS + nx;
          if (closed[ni]) continue;
          const t = this.type[ni];
          let c = t === T.ROAD || t === T.BRIDGE ? 0.75 : t === T.FOREST ? (vehicle ? 2.4 : 1.3) : 1;
          if (vehicle) {
            // keep tanks away from tight gaps next to buildings
            if (this.cellType(nx + 1, ny) === T.BUILDING || this.cellType(nx - 1, ny) === T.BUILDING ||
                this.cellType(nx, ny + 1) === T.BUILDING || this.cellType(nx, ny - 1) === T.BUILDING) c += 1.2;
          }
          const ng = g[cur] + c * (dx && dy ? 1.414 : 1);
          if (ng < g[ni]) {
            g[ni] = ng; from[ni] = cur;
            heap.push(ng + h(nx, ny), ni);
          }
        }
      }
    }
    if (!found) return [goalPx];
    const cells = [];
    for (let c = goal; c !== -1 && c !== start; c = from[c]) cells.push(c);
    cells.reverse();
    const pts = [{ x: sx, y: sy }];
    for (const c of cells) pts.push({ x: (c % COLS) * CELL + CELL / 2, y: ((c / COLS) | 0) * CELL + CELL / 2 });
    pts[pts.length - 1] = goalPx;
    // string pulling
    const clr = vehicle ? 16 : 6;
    const out = [];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.lineClear(pts[i], pts[j], clr)) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  // ---------- generation ----------
  generate() {
    const rng = this.rng, N = this.noise;
    this.roads = roadDefs().map((r) => sampleSpline(r));
    const roadCell = new Uint8Array(COLS * ROWS);
    for (const road of this.roads) {
      for (const p of road) {
        const gx = Math.floor(p.x / CELL), gy = Math.floor(p.y / CELL);
        for (let y = gy - 1; y <= gy + 1; y++) for (let x = gx - 1; x <= gx + 1; x++) {
          if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
          if (Math.hypot(x * CELL + CELL / 2 - p.x, y * CELL + CELL / 2 - p.y) < 30) roadCell[y * COLS + x] = 1;
        }
      }
    }
    for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
      const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2, i = gy * COLS + gx;
      if (Math.abs(x - riverX(y)) < RIVER_HALF + 2) this.type[i] = roadCell[i] ? T.BRIDGE : T.WATER;
      else this.type[i] = roadCell[i] ? T.ROAD : T.GRASS;
    }

    // villages
    const [A, B, C, D, E] = POINTS_DEF;
    const roofs = ['#8e4430', '#7d3b2b', '#5d6167', '#6e5040', '#9a5a3a'];
    this.placeCluster(A.x, A.y, 4, 'farm', ['#7b4a2e', '#8e4430']);
    this.placeCluster(B.x, B.y, 9, 'house', roofs);
    this.placeCluster(C.x - 150, C.y, 2, 'house', roofs, 60, 160);
    this.placeCluster(C.x + 150, C.y, 2, 'house', roofs, 60, 160);
    this.placeChurch(D.x, D.y);
    this.placeCluster(D.x, D.y, 5, 'house', roofs);
    this.placeCluster(E.x, E.y, 5, 'factory', ['#64666a', '#6c6a64']);
    for (let k = 0; k < 7; k++) {
      const x = 300 + rng() * (W - 600), y = 300 + rng() * (H - 600);
      if (Math.hypot(x - HQ[0].x, y - HQ[0].y) < 450 || Math.hypot(x - HQ[1].x, y - HQ[1].y) < 450) continue;
      this.placeCluster(x, y, 1 + ((rng() * 2) | 0), 'house', roofs, 0, 80);
    }

    // fields (visual + slight slow)
    const fieldSeeds = [[A.x, A.y, 5], [B.x, B.y, 3], [D.x, D.y, 2]];
    const fieldCols = ['#a69552', '#8f8448', '#7c8a46', '#9c8a50', '#86793f'];
    for (const [fx, fy, n] of fieldSeeds) {
      for (let k = 0; k < n; k++) {
        const a = rng() * TAU, r = 200 + rng() * 140;
        const f = { x: fx + Math.cos(a) * r, y: fy + Math.sin(a) * r, w: 150 + rng() * 120, h: 110 + rng() * 80, rot: (rng() - 0.5) * 0.4, col: fieldCols[(rng() * fieldCols.length) | 0] };
        this.fields.push(f);
      }
    }
    for (const f of this.fields) {
      for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
        const i = gy * COLS + gx;
        if (this.type[i] !== T.GRASS) continue;
        const x = gx * CELL + CELL / 2 - f.x, y = gy * CELL + CELL / 2 - f.y;
        const c = Math.cos(-f.rot), s = Math.sin(-f.rot);
        const lx = x * c - y * s, ly = x * s + y * c;
        if (Math.abs(lx) < f.w / 2 && Math.abs(ly) < f.h / 2) this.type[i] = T.FIELD;
      }
    }

    // forests
    for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
      const i = gy * COLS + gx;
      if (this.type[i] !== T.GRASS) continue;
      const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2;
      const n = N(x * 0.0042 + 31.7, y * 0.0042 + 11.3, 4);
      if (n < 0.58) continue;
      let near = false;
      for (const p of POINTS_DEF) if (Math.hypot(x - p.x, y - p.y) < 150) near = true;
      for (const h of HQ) if (Math.hypot(x - h.x, y - h.y) < 330) near = true;
      if (Math.abs(x - riverX(y)) < RIVER_HALF + 50) near = true;
      if (!near) this.type[i] = T.FOREST;
    }

    // cover grid
    for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
      const i = gy * COLS + gx;
      if (this.type[i] === T.FOREST) this.cover[i] = 0.55;
      else if (this.type[i] !== T.BUILDING && this.type[i] !== T.WATER) {
        let adj = false;
        for (let y = gy - 1; y <= gy + 1; y++) for (let x = gx - 1; x <= gx + 1; x++) if (this.cellType(x, y) === T.BUILDING && x >= 0 && y >= 0 && x < COLS && y < ROWS) adj = true;
        if (adj) this.cover[i] = 0.7;
      }
    }

    // sandbag arcs around points
    for (const p of POINTS_DEF) {
      const n = 3;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + rng() * 1.2;
        const r = 70 + rng() * 30;
        const span = 0.7 + rng() * 0.4;
        let ok = true;
        for (let s = -0.6; s <= 0.6; s += 0.2) {
          const aa = a + s * span, sx = p.x + Math.cos(aa) * r, sy = p.y + Math.sin(aa) * r;
          const t = this.typeAt(sx, sy);
          if (t === T.WATER || t === T.BUILDING || t === T.BRIDGE || Math.abs(sx - riverX(sy)) < RIVER_HALF + 14) ok = false;
        }
        if (!ok) continue;
        this.sandbags.push({ x: p.x, y: p.y, r, a, span });
      }
    }
  }

  placeCluster(px, py, count, style, roofs, rMin = 110, rMax = 270) {
    const rng = this.rng;
    let placed = 0, tries = 0;
    while (placed < count && tries++ < 300) {
      const a = rng() * TAU, r = rMin + rng() * (rMax - rMin);
      let cw, ch;
      if (style === 'factory') { cw = 3 + ((rng() * 2) | 0); ch = 2 + ((rng() * 2) | 0); }
      else if (style === 'farm') { cw = 2 + ((rng() * 2) | 0); ch = 2; if (rng() < 0.5) [cw, ch] = [ch, cw]; }
      else { cw = 2 + (rng() < 0.3 ? 1 : 0); ch = 2; if (rng() < 0.5) [cw, ch] = [ch, cw]; }
      const gx = Math.floor((px + Math.cos(a) * r) / CELL - cw / 2);
      const gy = Math.floor((py + Math.sin(a) * r) / CELL - ch / 2);
      if (!this.areaFree(gx - 1, gy - 1, cw + 2, ch + 2)) continue;
      for (let y = gy; y < gy + ch; y++) for (let x = gx; x < gx + cw; x++) this.type[y * COLS + x] = T.BUILDING;
      this.buildings.push({ x: gx * CELL, y: gy * CELL, w: cw * CELL, h: ch * CELL, style, roof: roofs[(rng() * roofs.length) | 0], seed: rng() });
      placed++;
    }
  }
  placeChurch(px, py) {
    for (let tries = 0; tries < 60; tries++) {
      const a = this.rng() * TAU, r = 140 + this.rng() * 60;
      const gx = Math.floor((px + Math.cos(a) * r) / CELL - 1.5), gy = Math.floor((py + Math.sin(a) * r) / CELL - 2.5);
      if (!this.areaFree(gx - 1, gy - 1, 5, 7)) continue;
      for (let y = gy; y < gy + 5; y++) for (let x = gx; x < gx + 3; x++) this.type[y * COLS + x] = T.BUILDING;
      this.buildings.push({ x: gx * CELL, y: gy * CELL, w: 3 * CELL, h: 5 * CELL, style: 'church', roof: '#5b5e63', seed: this.rng() });
      return;
    }
  }
  areaFree(gx, gy, w, h) {
    if (gx < 1 || gy < 1 || gx + w >= COLS - 1 || gy + h >= ROWS - 1) return false;
    for (let y = gy; y < gy + h; y++) for (let x = gx; x < gx + w; x++) {
      if (this.type[y * COLS + x] !== T.GRASS) return false;
    }
    for (const p of POINTS_DEF) {
      const cx = (gx + w / 2) * CELL, cy = (gy + h / 2) * CELL;
      if (Math.hypot(cx - p.x, cy - p.y) < 105) return false;
    }
    for (const hq of HQ) {
      const cx = (gx + w / 2) * CELL, cy = (gy + h / 2) * CELL;
      if (Math.hypot(cx - hq.x, cy - hq.y) < 380) return false;
    }
    return true;
  }

  // ---------- rendering ----------
  render() {
    const rng = mulberry32(777);
    const N = this.noise;
    const base = (this.base = mkCanvas(W, H));
    const g = (this.g = base.getContext('2d'));
    const canopy = (this.canopy = mkCanvas(W, H));
    const cg = canopy.getContext('2d');

    // 1. grass color field (low res, smooth upscale)
    const S = 4, lw = W / S, lh = H / S;
    const tmp = mkCanvas(lw, lh), tg = tmp.getContext('2d');
    const img = tg.createImageData(lw, lh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      const n1 = N(x * 0.02, y * 0.02, 4);
      const n2 = N(x * 0.06 + 50, y * 0.06 + 50, 3);
      const n3 = N(x * 0.008 + 90, y * 0.008 + 20, 2);
      const t = clamp((n1 - 0.3) * 1.6, 0, 1);
      let r = 74 + t * 40, gg = 92 + t * 34, b = 44 + t * 20;
      const dry = clamp((n3 - 0.55) * 3, 0, 1);
      r += dry * 30; gg += dry * 12; b += dry * 4;
      const d = (n2 - 0.5) * 22;
      const i = (y * lw + x) * 4;
      img.data[i] = r + d; img.data[i + 1] = gg + d; img.data[i + 2] = b + d * 0.5; img.data[i + 3] = 255;
    }
    tg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(tmp, 0, 0, W, H);

    // grass detail
    for (let k = 0; k < 60000; k++) {
      const x = rng() * W, y = rng() * H;
      g.fillStyle = rng() < 0.55 ? `rgba(35,50,20,${0.12 + rng() * 0.15})` : `rgba(170,175,100,${0.08 + rng() * 0.1})`;
      g.fillRect(x, y, 1 + rng() * 2, 1 + rng() * 2);
    }
    // dirt patches
    for (let k = 0; k < 90; k++) {
      const x = rng() * W, y = rng() * H, r = 20 + rng() * 60;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(110,92,60,0.25)');
      gr.addColorStop(1, 'rgba(110,92,60,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // 2. fields
    for (const f of this.fields) {
      g.save();
      g.translate(f.x, f.y); g.rotate(f.rot);
      g.fillStyle = f.col;
      g.globalAlpha = 0.85;
      g.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
      g.globalAlpha = 1;
      g.strokeStyle = 'rgba(60,50,25,0.28)';
      g.lineWidth = 2;
      for (let x = -f.w / 2 + 4; x < f.w / 2; x += 7) {
        g.beginPath(); g.moveTo(x, -f.h / 2 + 2); g.lineTo(x, f.h / 2 - 2); g.stroke();
      }
      // hedge border
      g.strokeStyle = 'rgba(40,58,24,0.9)';
      g.lineWidth = 5;
      g.strokeRect(-f.w / 2, -f.h / 2, f.w, f.h);
      for (let k = 0; k < (f.w + f.h) / 6; k++) {
        const side = (rng() * 4) | 0;
        let x, y;
        if (side === 0) { x = -f.w / 2 + rng() * f.w; y = -f.h / 2; }
        else if (side === 1) { x = -f.w / 2 + rng() * f.w; y = f.h / 2; }
        else if (side === 2) { x = -f.w / 2; y = -f.h / 2 + rng() * f.h; }
        else { x = f.w / 2; y = -f.h / 2 + rng() * f.h; }
        g.fillStyle = rng() < 0.5 ? '#334a1f' : '#3e5626';
        g.beginPath(); g.arc(x, y, 3 + rng() * 4, 0, TAU); g.fill();
      }
      g.restore();
    }

    // 3. river
    const rpts = [];
    for (let y = -60; y <= H + 60; y += 10) rpts.push({ x: riverX(y), y });
    strokePath(g, rpts, RIVER_HALF * 2 + 56, 'rgba(78,68,44,0.7)');
    strokePath(g, rpts, RIVER_HALF * 2 + 26, '#6c6143');
    strokePath(g, rpts, RIVER_HALF * 2 + 6, '#4c4a36');
    strokePath(g, rpts, RIVER_HALF * 2, '#2a4542');
    strokePath(g, rpts, RIVER_HALF * 1.35, '#30504b');
    strokePath(g, rpts, RIVER_HALF * 0.6, '#375a54');
    for (let k = 0; k < 900; k++) {
      const y = rng() * H, x = riverX(y) + (rng() - 0.5) * RIVER_HALF * 1.6;
      g.strokeStyle = `rgba(200,225,215,${0.05 + rng() * 0.09})`;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rng() - 0.5) * 3, y + 6 + rng() * 10); g.stroke();
    }
    // reeds
    for (let k = 0; k < 700; k++) {
      const y = rng() * H, side = rng() < 0.5 ? -1 : 1;
      const x = riverX(y) + side * (RIVER_HALF + 4 + rng() * 14);
      g.strokeStyle = rng() < 0.5 ? 'rgba(60,80,35,0.8)' : 'rgba(95,105,55,0.7)';
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rng() - 0.5) * 6, y - 4 - rng() * 6); g.stroke();
    }

    // 4. roads
    for (const road of this.roads) strokePath(g, road, 62, 'rgba(70,58,36,0.28)');
    for (const road of this.roads) strokePath(g, road, 46, '#7a6646');
    for (const road of this.roads) strokePath(g, road, 32, '#8b7652');
    for (const road of this.roads) {
      strokePath(g, road, 3, 'rgba(62,48,30,0.45)', 9);
      strokePath(g, road, 3, 'rgba(62,48,30,0.45)', -9);
      for (let k = 0; k < road.length; k += 2) {
        const p = road[k];
        g.fillStyle = rng() < 0.5 ? 'rgba(60,48,30,0.35)' : 'rgba(170,150,110,0.3)';
        g.fillRect(p.x + (rng() - 0.5) * 36, p.y + (rng() - 0.5) * 36, 2, 2);
      }
    }
    // 5. bridges
    for (const road of this.roads) {
      let run = [];
      const flush = () => {
        if (run.length > 3) {
          strokePath(g, run.map((p) => ({ x: p.x + 5, y: p.y + 7 })), 56, 'rgba(0,0,0,0.35)');
          strokePath(g, run, 56, '#5c5850');
          strokePath(g, run, 48, '#8c877b');
          strokePath(g, run, 40, '#999386');
          strokePath(g, run, 4, '#6a655a', 24);
          strokePath(g, run, 4, '#6a655a', -24);
          for (let k = 0; k < run.length; k += 3) {
            const p = run[k];
            g.fillStyle = 'rgba(70,65,55,0.35)';
            g.fillRect(p.x - 1, p.y - 18, 2, 36);
          }
        }
        run = [];
      };
      for (const p of road) {
        if (Math.abs(p.x - riverX(p.y)) < RIVER_HALF + 34) run.push(p);
        else flush();
      }
      flush();
    }

    // 6. HQ compounds
    HQ.forEach((h, team) => this.drawHQ(g, h, team, rng));

    // 7. sandbags
    for (const s of this.sandbags) {
      const n = Math.ceil((s.span * s.r) / 9);
      for (let k = 0; k <= n; k++) {
        const a = s.a - s.span / 2 + (s.span * k) / n;
        const x = s.x + Math.cos(a) * s.r, y = s.y + Math.sin(a) * s.r;
        g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(-5 + 2, -4 + 3, 10, 8);
        g.fillStyle = k % 2 ? '#b3a27a' : '#a8966c';
        g.beginPath(); g.ellipse(0, 0, 5.5, 4, 0, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(80,65,40,0.6)'; g.lineWidth = 0.8; g.stroke();
        g.restore();
      }
    }

    // 8. buildings
    for (const b of this.buildings) this.drawBuilding(g, b);

    // 9. trees
    const crowns = [];
    for (let v = 0; v < 10; v++) crowns.push(this.makeCrown(rng, v));
    const drawTree = (x, y, r) => {
      g.fillStyle = 'rgba(15,25,8,0.32)';
      g.beginPath(); g.ellipse(x + r * 0.45, y + r * 0.6, r * 1.05, r * 0.95, 0, 0, TAU); g.fill();
      const c = crowns[(rng() * crowns.length) | 0];
      cg.drawImage(c, x - r, y - r, r * 2, r * 2);
    };
    for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
      if (this.type[gy * COLS + gx] !== T.FOREST) continue;
      // forest floor (soft blobs, no hard tile edges)
      for (let k = 0; k < 3; k++) {
        const x = gx * CELL + rng() * CELL, y = gy * CELL + rng() * CELL, r = 26 + rng() * 14;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(34,46,20,0.5)');
        gr.addColorStop(1, 'rgba(34,46,20,0)');
        g.fillStyle = gr;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
      if (this.type[gy * COLS + gx] !== T.FOREST) continue;
      for (let k = 0; k < 4; k++) drawTree(gx * CELL + rng() * CELL, gy * CELL + rng() * CELL, 13 + rng() * 11);
    }
    // scattered trees & roadside rows
    for (let k = 0; k < 260; k++) {
      const x = rng() * W, y = rng() * H;
      const t = this.typeAt(x, y);
      if (t !== T.GRASS) continue;
      let ok = true;
      for (const p of POINTS_DEF) if (Math.hypot(x - p.x, y - p.y) < 120) ok = false;
      for (const h of HQ) if (Math.hypot(x - h.x, y - h.y) < 200) ok = false;
      if (ok) drawTree(x, y, 10 + rng() * 9);
    }
    for (const road of this.roads) {
      for (let k = 0; k < road.length; k += 9) {
        if (rng() > 0.35) continue;
        const a = road[k], b = road[Math.min(road.length - 1, k + 1)];
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        const side = rng() < 0.5 ? -1 : 1;
        const x = a.x + (-dy / l) * 42 * side, y = a.y + (dx / l) * 42 * side;
        if (this.typeAt(x, y) !== T.GRASS && this.typeAt(x, y) !== T.FIELD) continue;
        let ok = true;
        for (const p of POINTS_DEF) if (Math.hypot(x - p.x, y - p.y) < 110) ok = false;
        if (ok) drawTree(x, y, 9 + rng() * 6);
      }
    }

    // 10. minimap thumb
    const mm = (this.thumb = mkCanvas(280, 200));
    const mg = mm.getContext('2d');
    mg.drawImage(base, 0, 0, 280, 200);
    mg.drawImage(canopy, 0, 0, 280, 200);
  }

  makeCrown(rng, v) {
    const c = mkCanvas(64, 64), g = c.getContext('2d');
    const hues = [['#2c401c', '#4a6a2c', '#6a8a3e'], ['#2a3d1d', '#43602a', '#5f7f3a'], ['#33441e', '#536b2e', '#748c45'], ['#26391b', '#3d5a28', '#58783a']];
    const [d, m, l] = hues[v % hues.length];
    const blobs = 5 + ((rng() * 4) | 0);
    for (let i = 0; i < blobs; i++) {
      const a = rng() * TAU, r = rng() * 12;
      const x = 32 + Math.cos(a) * r, y = 32 + Math.sin(a) * r, rr = 12 + rng() * 8;
      const gr = g.createRadialGradient(x - rr * 0.35, y - rr * 0.35, rr * 0.1, x, y, rr);
      gr.addColorStop(0, l); gr.addColorStop(0.55, m); gr.addColorStop(1, d);
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
    }
    for (let i = 0; i < 25; i++) {
      g.fillStyle = `rgba(150,180,90,${0.08 + rng() * 0.12})`;
      g.beginPath(); g.arc(18 + rng() * 26, 18 + rng() * 26, 1 + rng() * 2.5, 0, TAU); g.fill();
    }
    return c;
  }

  drawHQ(g, h, team, rng) {
    const gr = g.createRadialGradient(h.x, h.y, 20, h.x, h.y, 210);
    gr.addColorStop(0, 'rgba(112,96,64,0.75)');
    gr.addColorStop(0.7, 'rgba(112,96,64,0.4)');
    gr.addColorStop(1, 'rgba(112,96,64,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(h.x, h.y, 210, 0, TAU); g.fill();
    const tent = team === 0 ? ['#5c6a3c', '#4b5832'] : ['#6a6c6c', '#56595a'];
    const tents = [[-70, -40, 0], [-20, 50, 0.2], [60, -70, -0.15], [-90, 60, 0.4], [40, 40, 0]];
    for (const [dx, dy, rot] of tents) {
      g.save(); g.translate(h.x + dx, h.y + dy); g.rotate(rot);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-22 + 5, -15 + 6, 44, 30);
      g.fillStyle = tent[0]; g.fillRect(-22, -15, 44, 15);
      g.fillStyle = tent[1]; g.fillRect(-22, 0, 44, 15);
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(-22, 0); g.lineTo(22, 0); g.stroke();
      g.restore();
    }
    // crates
    for (let k = 0; k < 10; k++) {
      const x = h.x + (rng() - 0.5) * 220, y = h.y + (rng() - 0.5) * 220;
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 3, y + 3, 12, 12);
      g.fillStyle = '#7a6440'; g.fillRect(x, y, 12, 12);
      g.strokeStyle = '#4e3f27'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, 11, 11);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 12, y + 12); g.stroke();
    }
    // landing / parade square
    g.strokeStyle = 'rgba(220,210,170,0.25)';
    g.lineWidth = 3;
    g.strokeRect(h.x - 40, h.y - 40, 80, 80);
  }

  drawBuilding(g, b) {
    const rng = mulberry32((b.seed * 1e9) | 0);
    const m = 3;
    const x = b.x + m, y = b.y + m, w = b.w - m * 2, h = b.h - m * 2;
    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.fillRect(x + 9, y + 11, w, h);
    if (b.style === 'factory') {
      g.fillStyle = '#4b4b48'; g.fillRect(x, y, w, h);
      g.fillStyle = b.roof; g.fillRect(x + 2, y + 2, w - 4, h - 4);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1;
      for (let xx = x + 12; xx < x + w - 4; xx += 12) { g.beginPath(); g.moveTo(xx, y + 2); g.lineTo(xx, y + h - 2); g.stroke(); }
      g.fillStyle = 'rgba(150,175,180,0.45)';
      for (let xx = x + 16; xx < x + w - 16; xx += 24) g.fillRect(xx, y + 10, 8, h - 20);
      // chimney
      const cx = x + w - 16, cy = y + 16;
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.ellipse(cx + 18, cy + 22, 9, 8, 0.6, 0, TAU); g.fill();
      g.fillStyle = '#7b4f3c'; g.beginPath(); g.arc(cx, cy, 9, 0, TAU); g.fill();
      g.fillStyle = '#1d1a18'; g.beginPath(); g.arc(cx, cy, 5, 0, TAU); g.fill();
      return;
    }
    if (b.style === 'church') {
      // nave
      g.fillStyle = '#9d978b'; g.fillRect(x, y, w, h);
      g.fillStyle = '#5d6066'; g.fillRect(x + 2, y + 2, w / 2 - 2, h - 4);
      g.fillStyle = '#4a4d52'; g.fillRect(x + w / 2, y + 2, w / 2 - 2, h - 4);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x + w / 2, y + 2); g.lineTo(x + w / 2, y + h - 2); g.stroke();
      // transept
      g.fillStyle = '#5d6066'; g.fillRect(x - 12, y + h * 0.35, w + 24, 26);
      g.fillStyle = '#4a4d52'; g.fillRect(x - 12, y + h * 0.35 + 13, w + 24, 13);
      // tower
      const tx = x + w / 2, ty = y + 18, ts = 34;
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(tx - ts / 2 + 18, ty - ts / 2 + 22, ts, ts);
      g.fillStyle = '#a49e91'; g.fillRect(tx - ts / 2, ty - ts / 2, ts, ts);
      const tri = (c, ax, ay, bx, by) => { g.fillStyle = c; g.beginPath(); g.moveTo(tx, ty); g.lineTo(ax, ay); g.lineTo(bx, by); g.closePath(); g.fill(); };
      const s = ts / 2 - 2;
      tri('#6c7076', tx - s, ty - s, tx + s, ty - s);
      tri('#55585d', tx + s, ty - s, tx + s, ty + s);
      tri('#45484c', tx + s, ty + s, tx - s, ty + s);
      tri('#606368', tx - s, ty + s, tx - s, ty - s);
      return;
    }
    // gable roof house / barn
    g.fillStyle = b.style === 'farm' ? '#8a7356' : '#b3a68c';
    g.fillRect(x, y, w, h);
    const horiz = w >= h;
    const base = b.roof;
    g.fillStyle = base;
    g.fillRect(x + 1, y + 1, w - 2, h - 2);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    if (horiz) g.fillRect(x + 1, y + h / 2, w - 2, h / 2 - 1);
    else g.fillRect(x + w / 2, y + 1, w / 2 - 1, h - 2);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    if (horiz) g.fillRect(x + 1, y + 1, w - 2, h / 2 - 1);
    else g.fillRect(x + 1, y + 1, w / 2 - 1, h - 2);
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1;
    if (horiz) for (let yy = y + 5; yy < y + h - 2; yy += 5) { g.beginPath(); g.moveTo(x + 2, yy); g.lineTo(x + w - 2, yy); g.stroke(); }
    else for (let xx = x + 5; xx < x + w - 2; xx += 5) { g.beginPath(); g.moveTo(xx, y + 2); g.lineTo(xx, y + h - 2); g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 2;
    g.beginPath();
    if (horiz) { g.moveTo(x + 2, y + h / 2); g.lineTo(x + w - 2, y + h / 2); }
    else { g.moveTo(x + w / 2, y + 2); g.lineTo(x + w / 2, y + h - 2); }
    g.stroke();
    // chimney
    if (b.style !== 'farm') {
      const cx = x + 8 + rng() * (w - 24), cy = y + 6 + rng() * (h - 20);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(cx + 4, cy + 5, 8, 8);
      g.fillStyle = '#6d4b3b'; g.fillRect(cx, cy, 8, 8);
      g.fillStyle = '#2a2420'; g.fillRect(cx + 2, cy + 2, 4, 4);
    }
    // weathering
    for (let k = 0; k < 8; k++) {
      g.fillStyle = `rgba(30,25,20,${0.05 + rng() * 0.1})`;
      g.fillRect(x + rng() * (w - 8), y + rng() * (h - 8), 4 + rng() * 8, 3 + rng() * 6);
    }
  }

  // ---------- dynamic terrain decals ----------
  paintCrater(x, y, r) {
    const g = this.g;
    const gr = g.createRadialGradient(x, y, 0, x, y, r * 1.6);
    gr.addColorStop(0, 'rgba(28,22,15,0.85)');
    gr.addColorStop(0.45, 'rgba(50,40,26,0.6)');
    gr.addColorStop(0.7, 'rgba(105,88,60,0.35)');
    gr.addColorStop(1, 'rgba(90,75,50,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r * 1.6, 0, TAU); g.fill();
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * TAU, d = r * (0.8 + Math.random() * 1.2);
      g.fillStyle = Math.random() < 0.5 ? 'rgba(40,32,22,0.6)' : 'rgba(120,100,70,0.5)';
      g.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 2, 2);
    }
  }
  paintScorch(x, y, r) {
    const g = this.g;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(15,12,10,0.8)');
    gr.addColorStop(1, 'rgba(15,12,10,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  paintTrack(x, y, a) {
    const g = this.g;
    g.save(); g.translate(x, y); g.rotate(a);
    g.fillStyle = 'rgba(45,36,24,0.16)';
    g.fillRect(-3, -15, 6, 7);
    g.fillRect(-3, 8, 6, 7);
    g.restore();
  }
}
