import * as THREE from 'three';

// 셀 셰이딩 도구: 3단 명암 재질 + 검은 외곽선(뒤집은 껍데기 방식).
let gradient: THREE.DataTexture | null = null;
function gradientMap() {
  if (!gradient) {
    const steps = new Uint8Array([70, 160, 255]);
    gradient = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const toonCache = new Map<number, THREE.MeshToonMaterial>();
export function toon(color: number) {
  let m = toonCache.get(color);
  if (!m) { m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap() }); toonCache.set(color, m); }
  return m;
}

const outlineMat = new THREE.MeshBasicMaterial({ color: 0x120e0c, side: THREE.BackSide });

/** 물체 하나 + 외곽선. thickness는 바깥으로 부풀리는 비율. */
export function toonMesh(geo: THREE.BufferGeometry, color: number, thickness = 0.04, shadows = true) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo, toon(color));
  body.castShadow = shadows;
  body.receiveShadow = true;
  const line = new THREE.Mesh(geo, outlineMat);
  geo.computeBoundingSphere();
  const r = geo.boundingSphere!.radius || 1;
  line.scale.setScalar(1 + thickness / r);
  g.add(body, line);
  return g;
}
