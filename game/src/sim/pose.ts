// 몸 자세 계산. 관절 각도와 손 위치만 다루는 순수 수학이라 테스트할 수 있다.
// 좌표: 캐릭터 기준, 앞 = -z, 오른쪽 = +x, 위 = +y. 각도 x가 +면 팔다리가 앞으로 간다.

export type Vec3 = [number, number, number];

export interface BodyPose {
  /** 엉덩이 높이 변화(m): 걸음 흔들림 + 웅크림 */
  bob: number;
  /** 좌우 체중 이동(m, +면 오른쪽) — 뒤에서 볼 때 걷는 느낌의 핵심 */
  sway: number;
  /** 골반·몸통 좌우 기울기(라디안) */
  hipsRoll: number;
  spineRoll: number;
  /** 몸통 숙임(+면 뒤로 젖힘)·비틀기 */
  spinePitch: number;
  spineYaw: number;
  hipsYaw: number;
  hipL: number; kneeL: number;
  hipR: number; kneeR: number;
  /** 팔(검을 안 들었을 때만 씀) */
  shoulderL: number; elbowL: number;
  shoulderR: number; elbowR: number;
}

export const LEG = { thigh: 0.47, shin: 0.45 };
export const ARM = { upper: 0.3, fore: 0.3 };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * 걷기·달리기·서기·공중 자세.
 * @param phase 걸음 위상 (gaitPhase)
 * @param amount 0=서 있음 ~ 1=걷는 속도 이상
 * @param run 0=걷기 ~ 1=달리기
 * @param airborne 공중이면 true
 * @param time 숨쉬기용 시간(초)
 */
export function locomotionPose(phase: number, amount: number, run: number, airborne: boolean, time: number): BodyPose {
  const s = Math.sin(phase), c = Math.cos(phase);
  const legA = lerp(0.42, 0.85, run) * amount;
  // 앞으로 나가는 다리(cos>0인 쪽)는 무릎을 굽혀 들어 올린다
  const kneeSwing = lerp(0.55, 1.6, run) * amount;
  const kneeBase = lerp(0.06, 0.25, run) * amount;
  const armA = lerp(0.32, 0.55, run) * amount;
  const elbow = lerp(0.18, 1.45, run) * Math.max(amount, 0.3) + 0.12;
  // 걷기: 다리가 지나칠 때(발이 몸 아래) 가장 높다 / 달리기: 다리를 벌린 공중 순간이 높다
  const walkBob = 0.035 * (1 - Math.abs(s)) - 0.02;
  const runBob = 0.07 * Math.abs(s) - 0.07;
  const breathe = 0.012 * Math.sin(time * 1.8) * (1 - amount);

  // 디딘 발 쪽으로 무게가 실린다: 왼발 디딤 중간(phase=π)에 왼쪽(-x)
  const pose: BodyPose = {
    sway: lerp(0.035, 0.018, run) * c * amount,
    hipsRoll: lerp(0.07, 0.04, run) * c * amount,
    spineRoll: -lerp(0.09, 0.05, run) * c * amount,
    bob: lerp(walkBob, runBob, run) * amount,
    spinePitch: -lerp(0.04, 0.3, run) * amount + breathe,
    spineYaw: 0.14 * s * amount,
    hipsYaw: -0.1 * s * amount,
    hipL: legA * s,
    hipR: -legA * s,
    kneeL: -(kneeBase + kneeSwing * Math.max(0, c)),
    kneeR: -(kneeBase + kneeSwing * Math.max(0, -c)),
    shoulderL: -armA * s,
    shoulderR: armA * s,
    elbowL: elbow,
    elbowR: elbow,
  };
  if (airborne) {
    // 공중: 무릎을 당기고 팔을 살짝 든다
    pose.hipL = 0.55; pose.kneeL = -1.0;
    pose.hipR = -0.05; pose.kneeR = -0.55;
    pose.shoulderL = 0.35; pose.shoulderR = 0.25;
    pose.elbowL = pose.elbowR = 0.8;
    pose.bob = 0;
    pose.sway = pose.hipsRoll = pose.spineRoll = 0;
  }
  return pose;
}

// ── 3차원 벡터 도구
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * 두 마디 팔 IK: 어깨에서 목표점까지 팔꿈치 위치를 구한다. pole 쪽으로 팔꿈치가 꺾인다.
 * 손이 닿지 않으면 목표 방향으로 쭉 뻗는다.
 */
export function solveTwoBone(shoulder: Vec3, target: Vec3, pole: Vec3, l1: number, l2: number): { elbow: Vec3; hand: Vec3 } {
  const d = sub(target, shoulder);
  const dist = Math.max(Math.abs(l1 - l2) + 1e-3, Math.min(l1 + l2 - 1e-4, length(d)));
  const dir = length(d) > 1e-6 ? normalize(d) : [0, -1, 0] as Vec3;
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let perp = sub(pole, scale(dir, dot(pole, dir)));
  if (length(perp) < 1e-6) perp = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  perp = normalize(sub(perp, scale(dir, dot(perp, dir))));
  const elbow = add(add(shoulder, scale(dir, a)), scale(perp, h));
  const hand = add(shoulder, scale(dir, dist));
  return { elbow, hand };
}

/** 앞뒤로만 흔드는 팔(검이 없을 때)의 팔꿈치·손 위치 */
export function armFK(shoulder: Vec3, shoulderAngle: number, elbowAngle: number, outward: number): { elbow: Vec3; hand: Vec3 } {
  const dirAt = (ang: number): Vec3 => [outward, -Math.cos(ang), -Math.sin(ang)];
  const u = normalize(dirAt(shoulderAngle));
  const f = normalize(dirAt(shoulderAngle + elbowAngle));
  const elbow = add(shoulder, scale(u, ARM.upper));
  return { elbow, hand: add(elbow, scale(f, ARM.fore)) };
}
