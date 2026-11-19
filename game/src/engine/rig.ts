import * as THREE from 'three';
import { ARM, LEG, armFK, solveTwoBone, type BodyPose, type Vec3 } from '../sim/pose';
import type { SwordPose } from '../sim/sword';
import { mat, solid } from './materials';

const HIP_HEIGHT = 0.95;
const SHOULDER_L: Vec3 = [-0.2, 0.52, 0];
const SHOULDER_R: Vec3 = [0.2, 0.52, 0];
const POLE_L: Vec3 = [-0.7, -1, 0.5];
const POLE_R: Vec3 = [0.7, -1, 0.5];
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
/** 검: 원점=오른손. 손잡이 -0.22~0.04, 날밑 0.06, 날 0.08~1.05 */
export const BLADE_BASE = 0.08;
export const BLADE_TIP = 1.05;
const LEFT_HAND_OFFSET = 0.13; // 왼손은 오른손보다 손잡이 끝(폼멜) 쪽

/** 관절 있는 임시 주인공(기본 도형). 다리는 관절 회전, 팔은 손 위치로 배치(IK). */
export function buildRig() {
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = HIP_HEIGHT;
  root.add(hips);
  const spine = new THREE.Group();
  hips.add(spine);

  const cloth = mat('cloth'), cloak = mat('cloak'), skin = mat('skin'), dark = mat('leather'), boot = mat('leather', 1, 1, 0x4a3424);
  const torso = solid(new THREE.CylinderGeometry(0.24, 0.2, 0.6, 14), cloth);
  torso.position.y = 0.3;
  const cape = solid(new THREE.CylinderGeometry(0.26, 0.34, 0.75, 14, 1, true, -Math.PI * 0.32, Math.PI * 0.64), cloak);
  cape.position.set(0, 0.22, 0.03); // 등 쪽(+z)을 덮는다
  const pelvis = solid(new THREE.CylinderGeometry(0.21, 0.22, 0.2, 14), dark);
  pelvis.position.y = -0.02;
  const head = solid(new THREE.SphereGeometry(0.15, 20, 14), skin);
  head.position.y = 0.76;
  const hood = solid(new THREE.SphereGeometry(0.175, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), cloak);
  hood.position.y = 0.77;
  hood.rotation.x = 0.9; // 두건이 뒤통수를 덮게 뒤로 기울임
  spine.add(torso, cape, head, hood);
  hips.add(pelvis);

  // 다리: 엉덩이 관절 → 무릎 관절 → 발
  const legs = [-0.1, 0.1].map((x) => {
    const hip = new THREE.Group();
    hip.position.set(x, -0.02, 0);
    const thigh = solid(new THREE.CylinderGeometry(0.085, 0.07, LEG.thigh, 10), dark);
    thigh.position.y = -LEG.thigh / 2;
    const knee = new THREE.Group();
    knee.position.y = -LEG.thigh;
    const shin = solid(new THREE.CylinderGeometry(0.068, 0.055, LEG.shin, 10), dark);
    shin.position.y = -LEG.shin / 2;
    const foot = solid(new THREE.BoxGeometry(0.1, 0.07, 0.22), boot);
    foot.position.set(0, -LEG.shin - 0.0, -0.05);
    knee.add(shin, foot);
    hip.add(thigh, knee);
    hips.add(hip);
    return { hip, knee };
  });

  // 팔: 위팔·아래팔을 따로 두고 매 프레임 위치·방향을 정한다
  const arm = () => {
    const upper = new THREE.Group();
    const um = solid(new THREE.CylinderGeometry(0.06, 0.05, ARM.upper, 10), cloth);
    um.position.y = -ARM.upper / 2;
    upper.add(um);
    const fore = new THREE.Group();
    const fm = solid(new THREE.CylinderGeometry(0.05, 0.042, ARM.fore - 0.05, 10), cloth);
    fm.position.y = -(ARM.fore - 0.05) / 2;
    const hand = solid(new THREE.SphereGeometry(0.05, 12, 8), skin);
    hand.position.y = -ARM.fore;
    fore.add(fm, hand);
    spine.add(upper, fore);
    return { upper, fore };
  };
  const armL = arm(), armR = arm();

  // 롱소드
  const sword = new THREE.Group();
  const grip = solid(new THREE.CylinderGeometry(0.02, 0.022, 0.26, 8), mat('leather'));
  grip.position.y = -0.09;
  const pommel = solid(new THREE.SphereGeometry(0.035, 12, 8), mat('brass'));
  pommel.position.y = -0.24;
  const guardBar = solid(new THREE.BoxGeometry(0.24, 0.03, 0.03), mat('brass'));
  guardBar.position.y = 0.06;
  const bladeGeo = new THREE.BoxGeometry(0.045, BLADE_TIP - BLADE_BASE, 0.008);
  bladeGeo.translate(0, (BLADE_TIP + BLADE_BASE) / 2, 0);
  const blade = solid(bladeGeo, mat('steel'));
  sword.add(grip, pommel, guardBar, blade);
  spine.add(sword);

  const v = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);
  const q = new THREE.Quaternion();
  function placeSegment(g: THREE.Object3D, from: Vec3, to: Vec3) {
    g.position.copy(v(from));
    const dir = v(to).sub(v(from)).normalize();
    g.quaternion.copy(q.setFromUnitVectors(DOWN, dir));
  }
  function placeArm(a: { upper: THREE.Group; fore: THREE.Group }, shoulder: Vec3, elbow: Vec3, hand: Vec3) {
    placeSegment(a.upper, shoulder, elbow);
    placeSegment(a.fore, elbow, hand);
  }

  const firstPersonHidden = [torso, cape, head, hood, pelvis];

  return {
    root,
    sword,
    /** 몸 자세 + (검을 들었으면) 검 자세를 적용한다 */
    apply(body: BodyPose, swordPose: SwordPose | null) {
      const crouch = swordPose?.crouch ?? 0;
      const lunge = swordPose?.lunge ?? 0;
      hips.position.set(body.sway, HIP_HEIGHT + body.bob - crouch, -lunge * 0.5);
      hips.rotation.set(0, body.hipsYaw, body.hipsRoll, 'YXZ');
      spine.rotation.set(body.spinePitch + (swordPose ? swordPose.chest[0] : 0), body.spineYaw + (swordPose ? swordPose.chest[1] : 0), body.spineRoll, 'YXZ');
      // 웅크림만큼 무릎을 굽힌다 (대략: 굽힘 각 ≈ 웅크림/다리길이*3)
      const bend = crouch * 3.2;
      const [L, R] = legs;
      L.hip.rotation.x = body.hipL + bend * 0.5 + lunge * 0.9;
      L.knee.rotation.x = body.kneeL - bend;
      R.hip.rotation.x = body.hipR + bend * 0.5 - lunge * 0.5;
      R.knee.rotation.x = body.kneeR - bend * 0.8;

      if (swordPose) {
        const handR = swordPose.grip;
        const handL: Vec3 = [
          handR[0] - swordPose.dir[0] * LEFT_HAND_OFFSET,
          handR[1] - swordPose.dir[1] * LEFT_HAND_OFFSET,
          handR[2] - swordPose.dir[2] * LEFT_HAND_OFFSET,
        ];
        const r = solveTwoBone(SHOULDER_R, handR, POLE_R, ARM.upper, ARM.fore);
        const l = solveTwoBone(SHOULDER_L, handL, POLE_L, ARM.upper, ARM.fore);
        placeArm(armR, SHOULDER_R, r.elbow, r.hand);
        placeArm(armL, SHOULDER_L, l.elbow, l.hand);
        // 손이 닿지 않아 끌려간 만큼 검도 손을 따라간다
        sword.position.copy(v(r.hand));
        sword.quaternion.copy(q.setFromUnitVectors(UP, v(swordPose.dir).normalize()));
      } else {
        const l = armFK(SHOULDER_L, body.shoulderL, body.elbowL, -0.12);
        const r = armFK(SHOULDER_R, body.shoulderR, body.elbowR, 0.12);
        placeArm(armL, SHOULDER_L, l.elbow, l.hand);
        placeArm(armR, SHOULDER_R, r.elbow, r.hand);
        // 등에 멘 검: 손잡이가 오른쪽 어깨 위로
        sword.position.set(0.16, 0.6, 0.2);
        sword.quaternion.copy(q.setFromUnitVectors(UP, new THREE.Vector3(-0.45, -0.88, 0.1).normalize()));
      }
    },
    setFirstPerson(on: boolean) {
      for (const m of firstPersonHidden) m.visible = !on;
    },
  };
}
