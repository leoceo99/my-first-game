import * as THREE from 'three';
import type { PlayerState } from '../sim/player';

export type CameraMode = 'first' | 'third';
const EYE = 1.68;
const THIRD_DIST = 4.2;

/** 1인칭(눈 위치)과 3인칭(어깨 뒤)을 오간다. 전환은 0.25초 동안 부드럽게. */
export class CameraRig {
  mode: CameraMode = 'third';
  private blend = 1; // 0=1인칭, 1=3인칭
  constructor(public cam: THREE.PerspectiveCamera) {}

  toggle() { this.mode = this.mode === 'first' ? 'third' : 'first'; }

  update(p: PlayerState, dt: number) {
    const target = this.mode === 'third' ? 1 : 0;
    const k = Math.min(1, dt / 0.25);
    this.blend += (target - this.blend) * (k >= 1 ? 1 : k * 2.5);
    if (Math.abs(this.blend - target) < 0.01) this.blend = target;

    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    // 1인칭: 눈 위치에서 보는 방향으로
    const eye = new THREE.Vector3(p.x, EYE, p.z);
    const look = new THREE.Vector3(p.x + fx * cp, EYE - sp, p.z + fz * cp);
    // 3인칭: 시선 반대쪽 뒤·위, 약간 오른쪽 어깨
    const tp = new THREE.Vector3(
      p.x - fx * THIRD_DIST * cp + Math.cos(p.yaw) * 0.5,
      EYE + 0.4 + sp * THIRD_DIST,
      p.z - fz * THIRD_DIST * cp - Math.sin(p.yaw) * 0.5,
    );
    tp.y = Math.max(0.4, tp.y);
    const tlook = new THREE.Vector3(p.x + fx * 2, EYE - sp * 2, p.z + fz * 2);
    this.cam.position.copy(eye.lerp(tp, this.blend));
    this.cam.lookAt(look.lerp(tlook, this.blend));
  }

  /** 3인칭 비중이 이만큼은 돼야 주인공 몸을 그린다(1인칭에서 몸이 화면을 가리지 않게). */
  get showBody() { return this.blend > 0.3; }
}
