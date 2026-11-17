// 검 동작(키프레임) 실행기. 동작 자체는 data/combat/*.json 데이터로 관리한다.
import { normalize, type Vec3 } from './pose';

export interface SwordPose {
  grip: Vec3;
  dir: Vec3;
  chest: [number, number];
  crouch: number;
  lunge: number;
}
export interface SwordKey extends Partial<SwordPose> { t: number; pose?: 'guard' }
export interface SwordClip { id: string; nameId: string; duration: number; hit: [number, number]; keys: SwordKey[] }
export interface SwordSet { guard: SwordPose & { name: string }; clips: SwordClip[] }

const toArr = (p: SwordPose) => [...p.grip, ...p.dir, ...p.chest, p.crouch, p.lunge];
const fromArr = (a: number[]): SwordPose => ({
  grip: [a[0], a[1], a[2]],
  dir: normalize([a[3], a[4], a[5]]),
  chest: [a[6], a[7]],
  crouch: a[8],
  lunge: a[9],
});

function resolveKey(set: SwordSet, k: SwordKey): SwordPose {
  if (k.pose === 'guard') return set.guard;
  return {
    grip: k.grip ?? set.guard.grip,
    dir: k.dir ?? set.guard.dir,
    chest: k.chest ?? set.guard.chest,
    crouch: k.crouch ?? set.guard.crouch,
    lunge: k.lunge ?? set.guard.lunge,
  };
}

/** Catmull-Rom 보간: 키 사이를 부드러운 곡선으로 지난다 (키마다 멈칫하지 않게) */
function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** clip의 time초 자세. 범위 밖이면 처음/끝 자세 */
export function sampleClip(set: SwordSet, clip: SwordClip, time: number): SwordPose {
  const keys = clip.keys;
  const t = Math.max(0, Math.min(clip.duration, time));
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const k1 = keys[i], k2 = keys[i + 1];
  const k0 = keys[Math.max(0, i - 1)], k3 = keys[Math.min(keys.length - 1, i + 2)];
  const span = k2.t - k1.t;
  const u = span > 0 ? (t - k1.t) / span : 0;
  const [a0, a1, a2, a3] = [k0, k1, k2, k3].map((k) => toArr(resolveKey(set, k)));
  return fromArr(a1.map((_, j) => catmull(a0[j], a1[j], a2[j], a3[j], u)));
}

export function guardPose(set: SwordSet): SwordPose {
  return set.guard;
}

/** 데이터 검사: 문제 목록(없으면 빈 배열) */
export function validateSwordSet(set: SwordSet): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const c of set.clips) {
    if (ids.has(c.id)) out.push(`${c.id}: id 중복`);
    ids.add(c.id);
    if (c.keys.length < 3) out.push(`${c.id}: 키가 3개 미만`);
    if (c.keys[0]?.t !== 0) out.push(`${c.id}: 첫 키가 0초가 아님`);
    if (c.keys[c.keys.length - 1]?.t !== c.duration) out.push(`${c.id}: 마지막 키가 duration과 다름`);
    if (c.keys[0]?.pose !== 'guard' || c.keys[c.keys.length - 1]?.pose !== 'guard') out.push(`${c.id}: 처음·끝이 지붕 자세가 아님(이어 베기 불가)`);
    for (let i = 1; i < c.keys.length; i++) if (c.keys[i].t <= c.keys[i - 1].t) out.push(`${c.id}: 키 시각이 증가하지 않음 (${i})`);
    if (!(c.hit[0] > 0 && c.hit[0] < c.hit[1] && c.hit[1] < c.duration)) out.push(`${c.id}: 타격 구간이 잘못됨`);
  }
  return out;
}

/** 공격 진행 상태 */
export interface AttackState { clipId: string; time: number; hitDone: boolean; queued: string | null }

/** 다음 공격을 이어서 걸 수 있는 시점(동작의 65% 이후) */
export const CHAIN_AT = 0.65;

export function startOrQueue(state: AttackState | null, set: SwordSet, clipId: string): AttackState | null {
  if (!set.clips.some((c) => c.id === clipId)) return state;
  if (!state) return { clipId, time: 0, hitDone: false, queued: null };
  return { ...state, queued: clipId };
}

/** 공격 시간 진행. 끝나면 예약된 다음 공격을 시작하거나 null */
export function advanceAttack(state: AttackState | null, set: SwordSet, dt: number): AttackState | null {
  if (!state) return null;
  const clip = set.clips.find((c) => c.id === state.clipId)!;
  const time = state.time + dt;
  if (state.queued && time >= clip.duration * CHAIN_AT) {
    // 이어 베기: 다음 동작의 처음(지붕 자세)으로 넘어간다
    return { clipId: state.queued, time: 0, hitDone: false, queued: null };
  }
  if (time >= clip.duration) return null;
  return { ...state, time };
}

export function inHitWindow(state: AttackState | null, set: SwordSet): boolean {
  if (!state) return false;
  const clip = set.clips.find((c) => c.id === state.clipId)!;
  return state.time >= clip.hit[0] && state.time <= clip.hit[1];
}

/** 칼날 선분이 세로 원기둥(허수아비 등)을 지났는지: 이전·현재 칼날 사이를 촘촘히 훑는다 */
export function bladeSweepHits(
  prevBase: Vec3, prevTip: Vec3, base: Vec3, tip: Vec3,
  cyl: { x: number; z: number; r: number; yMin: number; yMax: number },
): boolean {
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    for (let j = 0; j <= N; j++) {
      const v = j / N;
      // 이전 칼날과 현재 칼날 사이의 면 위 점
      const a = mix(prevBase, prevTip, v), b = mix(base, tip, v);
      const p = mix(a, b, u);
      if (p[1] >= cyl.yMin && p[1] <= cyl.yMax && Math.hypot(p[0] - cyl.x, p[2] - cyl.z) <= cyl.r) return true;
    }
  }
  return false;
}
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
