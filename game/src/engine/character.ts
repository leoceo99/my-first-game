import * as THREE from 'three';
import { toonMesh } from './toon';

/** 임시 주인공: 기본 도형으로 만든 망토 입은 사람. 정식 모델(T-007 에셋)로 교체 예정. */
export function buildCharacter() {
  const root = new THREE.Group();
  const body = new THREE.Group(); // 걸을 때 흔들리는 부분
  root.add(body);

  const torso = toonMesh(new THREE.CylinderGeometry(0.26, 0.32, 0.8, 10), 0x5a6470);
  torso.position.y = 1.15;
  const cloak = toonMesh(new THREE.ConeGeometry(0.45, 1.1, 10, 1, true), 0x3a1f1c);
  cloak.position.set(0, 1.0, 0.05);
  const head = toonMesh(new THREE.SphereGeometry(0.2, 14, 10), 0xd9b08c);
  head.position.y = 1.75;
  const hood = toonMesh(new THREE.SphereGeometry(0.23, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0x3a1f1c);
  hood.position.y = 1.78;
  const legL = toonMesh(new THREE.CylinderGeometry(0.09, 0.08, 0.75, 6), 0x2e2a26);
  legL.position.set(-0.12, 0.38, 0);
  const legR = legL.clone(); legR.position.x = 0.12;
  // 칼집 (등 뒤 롱소드 암시)
  const sword = toonMesh(new THREE.BoxGeometry(0.06, 1.1, 0.04), 0x8c8c94);
  sword.position.set(0.15, 1.3, 0.3);
  sword.rotation.z = 0.5;
  body.add(torso, cloak, head, hood, legL, legR, sword);

  let phase = 0;
  return {
    root,
    /** speed: 실제 이동 속도(m/s) — 걸음 흔들림 크기에 씀 */
    animate(dt: number, speed: number) {
      phase += dt * speed * 3.2;
      const amt = Math.min(1, speed / 5);
      legL.rotation.x = Math.sin(phase) * 0.7 * amt;
      legR.rotation.x = -Math.sin(phase) * 0.7 * amt;
      body.position.y = Math.abs(Math.sin(phase)) * 0.06 * amt;
    },
  };
}
