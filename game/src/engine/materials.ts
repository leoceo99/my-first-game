import * as THREE from 'three';

// 사실적(물리 기반) 재질 도구 (A-1, 11-19 디렉터 결정: 만화풍 폐기).
// 질감은 모두 코드로 직접 만든다(저작권 문제 없음). 같은 종류·반복이면 재질을 재사용한다.

export type Kind =
  | 'grass' | 'dirt' | 'cobble' | 'plaster' | 'tile' | 'wood' | 'bark' | 'foliage' | 'straw' | 'rock'
  | 'cloth' | 'cloak' | 'leather' | 'skin' | 'iron' | 'brass' | 'steel';

/** 시드 고정 난수 → 매번 같은 질감 */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** 이어 붙여도 이음새가 없는 값 잡음. 사용할 때 wx, wy = 질감 한 장에 들어가는 격자 칸 수(정수)를 알려 주면 그 칸 수로 되감긴다 */
function makeNoise(seed: number) {
  const N = 256, r = rng(seed);
  const g = new Float32Array(N * N);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number, wx: number, wy = wx) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi);
    const x0 = ((xi % wx) + wx) % wx, x1 = (x0 + 1) % wx, y0 = ((yi % wy) + wy) % wy, y1 = (y0 + 1) % wy;
    const a = g[y0 * N + x0], b = g[y0 * N + x1], c = g[y1 * N + x0], d = g[y1 * N + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
type Noise = ReturnType<typeof makeNoise>;
/** 여러 크기의 잡음을 겹친다. u,v는 0~1(이어 붙임 단위). base는 첫 겹의 격자 칸 수 */
function fbm(n: Noise, u: number, v: number, base: number, oct = 4) {
  let sum = 0, amp = 0.5, tot = 0;
  for (let o = 0; o < oct; o++) {
    const f = base * 2 ** o;
    sum += n(u * f, v * f, f) * amp; tot += amp; amp *= 0.5;
  }
  return sum / tot;
}

type Texel = [number, number, number, number]; // 색 r,g,b(0~255) + 높낮이 h(0~1)
function paint(size: number, fn: (u: number, v: number) => Texel) {
  const col = document.createElement('canvas'), bump = document.createElement('canvas');
  col.width = col.height = bump.width = bump.height = size;
  const cc = col.getContext('2d')!, bc = bump.getContext('2d')!;
  const ci = cc.createImageData(size, size), bi = bc.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b, h] = fn(x / size, y / size);
    const i = (y * size + x) * 4;
    ci.data[i] = r; ci.data[i + 1] = g; ci.data[i + 2] = b; ci.data[i + 3] = 255;
    const hv = Math.max(0, Math.min(255, h * 255));
    bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = hv; bi.data[i + 3] = 255;
  }
  cc.putImageData(ci, 0, 0); bc.putImageData(bi, 0, 0);
  const mk = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk(col, true), bump: mk(bump, false) };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const shade = (c: [number, number, number], k: number): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k];

interface Recipe {
  /** 질감 한 장 그리기. 없으면 단색 */
  tex?: (size: number) => { map: THREE.Texture; bump: THREE.Texture };
  color?: number;
  rough: number;
  metal?: number;
  bumpScale?: number;
  double?: boolean;
  size?: number;
}

/** 격자 무늬 돌/기와 같은 칸 무늬용 칸 정보 */
function cellsTexture(opts: { cols: number; rows: number; seed: number; base: [number, number, number]; vary: number; mortar: [number, number, number]; mortarW: number; stagger: boolean }) {
  return (size: number) => {
    const n = makeNoise(opts.seed), r = rng(opts.seed + 1);
    const tint = Array.from({ length: opts.cols * opts.rows }, () => 0.75 + r() * 0.5 * opts.vary + (1 - opts.vary) * 0.25);
    return paint(size, (u, v) => {
      const row = Math.floor(v * opts.rows);
      const uu = u * opts.cols + (opts.stagger && row % 2 ? 0.5 : 0);
      const col = Math.floor(uu), fu = uu - col, fv = v * opts.rows - row;
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
      const t = tint[row * opts.cols + (((col % opts.cols) + opts.cols) % opts.cols)];
      const grain = fbm(n, u, v, 4, 3);
      const k = t * (0.85 + grain * 0.3);
      if (edge < opts.mortarW) return [...shade(opts.mortar, 0.8 + grain * 0.4), 0.05] as Texel;
      return [...shade(opts.base, k), 0.5 + edge * 0.6 + grain * 0.25] as Texel;
    });
  };
}

const RECIPES: Record<Kind, Recipe> = {
  grass: {
    rough: 0.95,
    tex: (s) => { const n = makeNoise(11), n2 = makeNoise(12); return paint(s, (u, v) => {
      const a = fbm(n, u, v, 2, 5), blades = n2(u * 64, v * 64, 64);
      const c = shade([62, 84, 40], 0.7 + a * 0.7 + (blades - 0.5) * 0.35);
      return [c[0], c[1], c[2], 0.4 + blades * 0.5];
    }); },
  },
  dirt: {
    rough: 0.98,
    tex: (s) => { const n = makeNoise(21), n2 = makeNoise(22); return paint(s, (u, v) => {
      const a = fbm(n, u, v, 2, 5), p = n2(u * 48, v * 48, 48);
      const c = shade([122, 94, 62], 0.65 + a * 0.6 + (p > 0.82 ? 0.25 : 0));
      return [c[0], c[1], c[2], 0.3 + a * 0.4 + (p > 0.82 ? 0.3 : 0)];
    }); },
  },
  cobble: {
    rough: 0.9, bumpScale: 2.2,
    tex: cellsTexture({ cols: 5, rows: 5, seed: 31, base: [140, 134, 126], vary: 0.9, mortar: [58, 54, 48], mortarW: 0.07, stagger: true }),
  },
  plaster: {
    rough: 0.92,
    tex: (s) => { const n = makeNoise(41); return paint(s, (u, v) => {
      const a = fbm(n, u, v, 2, 5), stain = fbm(n, v + 0.3, u, 1, 3);
      const c = shade([186, 170, 140], 0.72 + a * 0.45 - Math.max(0, stain - 0.55) * 0.5);
      return [c[0], c[1], c[2], 0.4 + a * 0.5];
    }); },
  },
  tile: {
    rough: 0.85, bumpScale: 2.4,
    tex: cellsTexture({ cols: 8, rows: 8, seed: 51, base: [112, 56, 40], vary: 0.8, mortar: [28, 18, 14], mortarW: 0.06, stagger: true }),
  },
  wood: {
    rough: 0.85, bumpScale: 1.0,
    tex: (s) => { const n = makeNoise(61), w = makeNoise(62); return paint(s, (u, v) => {
      const ring = Math.sin((v * 14 + fbm(w, u, v, 2, 3) * 5) * Math.PI) * 0.5 + 0.5;
      const f = n(u * 4, v * 64, 4, 64);
      const c = shade([96, 66, 42], 0.65 + ring * 0.3 + f * 0.25);
      return [c[0], c[1], c[2], 0.3 + ring * 0.4 + f * 0.2];
    }); },
  },
  bark: {
    rough: 0.98, bumpScale: 3.0,
    tex: (s) => { const n = makeNoise(71); return paint(s, (u, v) => {
      const ridge = n(u * 12, v * 3, 12, 3), a = fbm(n, u, v, 3, 3);
      const c = shade([78, 58, 42], 0.5 + ridge * 0.7 + a * 0.2);
      return [c[0], c[1], c[2], ridge];
    }); },
  },
  foliage: {
    rough: 0.9, double: true, size: 128,
    tex: (s) => { const n = makeNoise(81); return paint(s, (u, v) => {
      const a = n(u * 32, v * 32, 32), b = fbm(n, u, v, 2, 3);
      const c = shade([44, 78, 40], 0.55 + a * 0.6 + b * 0.3);
      return [c[0], c[1], c[2], a];
    }); },
  },
  straw: {
    rough: 0.95, bumpScale: 1.4, size: 128,
    tex: (s) => { const n = makeNoise(91); return paint(s, (u, v) => {
      const st = n(u * 48, v * 6, 48, 6), a = n(u * 6, v * 6, 6);
      const c = shade([184, 150, 70], 0.6 + st * 0.5 + a * 0.2);
      return [c[0], c[1], c[2], st];
    }); },
  },
  rock: {
    rough: 0.95, bumpScale: 3.0, size: 128,
    tex: (s) => { const n = makeNoise(101); return paint(s, (u, v) => {
      const a = fbm(n, u, v, 3, 5);
      const c = shade([118, 114, 108], 0.55 + a * 0.8);
      return [c[0], c[1], c[2], a];
    }); },
  },
  cloth: { color: 0x4a525c, rough: 0.95 },
  cloak: { color: 0x4a2622, rough: 0.97, double: true },
  leather: { color: 0x3a281c, rough: 0.7 },
  skin: { color: 0xc99d7e, rough: 0.6 },
  iron: { color: 0x3a3b3d, rough: 0.55, metal: 0.8 },
  brass: { color: 0x8a7440, rough: 0.4, metal: 0.9 },
  steel: { color: 0xc4c8ce, rough: 0.25, metal: 1.0 },
};

/** 하늘빛 반사 지도: 금속에만 붙인다(모든 면에 붙이면 내장 그래픽에서 비싸다). look.ts가 한 번 설정 */
let metalEnv: THREE.Texture | null = null;
export function setMetalEnv(t: THREE.Texture) { metalEnv = t; }

const cache = new Map<string, THREE.MeshStandardMaterial>(); // (가벼운 재질도 같은 칸에 보관)
const texCache = new Map<Kind, { map: THREE.Texture; bump: THREE.Texture }>();

/** 재질 하나. rx, ry는 질감을 몇 번 반복해 붙일지(큰 면일수록 크게). 색을 줄 때는 tint(곱하기). */
export function mat(kind: Kind, rx = 1, ry = rx, tint?: number): THREE.MeshStandardMaterial {
  const key = `${kind}|${rx}|${ry}|${tint ?? ''}`;
  let m = cache.get(key);
  if (m) return m;
  const rc = RECIPES[kind];
  const common = { color: tint ?? rc.color ?? 0xffffff, side: rc.double ? THREE.DoubleSide : THREE.FrontSide };
  // 반사가 거의 없는 거친 표면(흙·풀·벽·기와·나무 등)은 확산광만 계산하는 가벼운 재질, 윤이 나는 것(금속·피부)만 물리 기반 전체 계산
  m = (rc.rough >= 0.85 && !rc.metal
    ? new THREE.MeshLambertMaterial(common)
    : new THREE.MeshStandardMaterial({ ...common, roughness: rc.rough, metalness: rc.metal ?? 0 })) as THREE.MeshStandardMaterial;
  if (rc.metal && metalEnv) { m.envMap = metalEnv; m.envMapIntensity = 1.1; }
  if (rc.tex) {
    let t = texCache.get(kind);
    if (!t) { t = rc.tex(rc.size ?? 256); texCache.set(kind, t); }
    const map = t.map.clone(), bump = t.bump.clone();
    for (const x of [map, bump]) { x.repeat.set(rx, ry); x.needsUpdate = true; }
    map.colorSpace = THREE.SRGBColorSpace;
    m.map = map;
    if (rc.bumpScale) { m.bumpMap = bump; m.bumpScale = rc.bumpScale; } // 화면을 크게 덮는 면(풀·흙·벽)은 요철 계산을 생략 → 내장 그래픽 부담 감소
    if (tint === undefined) m.color.set(0xffffff);
  }
  cache.set(key, m);
  return m;
}

/** 물체 하나(그림자 주고받음). 외곽선 없음. */
export function solid(geo: THREE.BufferGeometry, material: THREE.Material, cast = true) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}
