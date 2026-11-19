import * as THREE from 'three';
import { effectivePixelRatio, type QualitySettings } from '../sim/quality';

/**
 * 화질 단계를 실제 렌더러·장면에 적용한다 (E-1).
 * 장면의 겉모습(색·빛의 세기·재질)은 아트팀 몫(world.ts)이라 여기서는 "얼마나 정밀하게 그리나"만 바꾼다:
 * 해상도 배율, 그림자 켜기·해상도·부드러움, 질감 선명도.
 * 계단 현상 줄이기(antialias)는 렌더러를 만들 때만 정할 수 있으므로 여기서 바꾸지 않는다.
 */
export function applyQuality(renderer: THREE.WebGLRenderer, scene: THREE.Scene, s: QualitySettings, cssW: number, cssH: number): void {
  renderer.setPixelRatio(effectivePixelRatio(window.devicePixelRatio, s));
  renderer.setSize(cssW, cssH);

  const shadowTypeChanged = renderer.shadowMap.enabled !== s.shadows
    || (s.shadows && (renderer.shadowMap.type === THREE.PCFSoftShadowMap) !== s.softShadows);
  renderer.shadowMap.enabled = s.shadows;
  renderer.shadowMap.type = s.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  renderer.shadowMap.needsUpdate = true;

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  scene.traverse((o) => {
    const light = o as THREE.DirectionalLight | THREE.SpotLight | THREE.PointLight;
    if ((light as THREE.Light).isLight && light.shadow && light.castShadow) {
      if (light.shadow.mapSize.x !== s.shadowMapSize) {
        light.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize);
        light.shadow.map?.dispose();
        light.shadow.map = null; // 다음 그림 때 새 해상도로 다시 만든다
      }
    }
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap'] as const) {
          const tex = (m as THREE.MeshStandardMaterial)[key];
          if (tex && tex.anisotropy !== Math.min(s.anisotropy, maxAniso)) {
            tex.anisotropy = Math.min(s.anisotropy, maxAniso);
            tex.needsUpdate = true;
          }
        }
        // 그림자 켜고 끄기·종류 바꾸기는 셰이더를 다시 만들어야 반영된다
        if (shadowTypeChanged) m.needsUpdate = true;
      }
    }
  });
}
