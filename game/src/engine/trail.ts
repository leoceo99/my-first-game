import * as THREE from 'three';

/** 칼이 지나간 자리에 남는 흐린 띠. 베는 궤적이 눈에 보이게 한다. */
export class BladeTrail {
  private n = 14;
  private bases: THREE.Vector3[] = [];
  private tips: THREE.Vector3[] = [];
  private geo = new THREE.BufferGeometry();
  readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    const pos = new Float32Array(this.n * 2 * 3);
    const alpha = new Float32Array(this.n * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    const idx: number[] = [];
    for (let i = 0; i < this.n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    this.geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.92, 0.93, 0.96, vA * 0.45); }',
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** active면 새 칼날 위치를 쌓고, 아니면 서서히 지운다 */
  push(base: THREE.Vector3, tip: THREE.Vector3, active: boolean) {
    if (active) {
      this.bases.unshift(base.clone());
      this.tips.unshift(tip.clone());
    } else if (this.bases.length) {
      this.bases.pop(); this.tips.pop();
    }
    if (this.bases.length > this.n) { this.bases.length = this.n; this.tips.length = this.n; }
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const alpha = this.geo.getAttribute('alpha') as THREE.BufferAttribute;
    for (let i = 0; i < this.n; i++) {
      const b = this.bases[Math.min(i, this.bases.length - 1)] ?? base;
      const t = this.tips[Math.min(i, this.tips.length - 1)] ?? tip;
      // 칼날 바깥쪽 2/3만 띠를 그린다
      const inner = b.clone().lerp(t, 0.35);
      pos.setXYZ(i * 2, inner.x, inner.y, inner.z);
      pos.setXYZ(i * 2 + 1, t.x, t.y, t.z);
      const a = i < this.bases.length ? 1 - i / this.n : 0;
      alpha.setX(i * 2, a * 0.3);
      alpha.setX(i * 2 + 1, a);
    }
    pos.needsUpdate = true;
    alpha.needsUpdate = true;
  }
}
