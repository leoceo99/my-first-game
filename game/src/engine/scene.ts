import * as THREE from 'three';

/** 골격 점검용 최소 장면: 셀 셰이딩(툰) 재질의 물체 하나와 조명. T-004에서 본격 장면으로 교체. */
export function createSkeletonScene(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1820);
  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 1.2, 4);
  camera.lookAt(0, 0, 0);

  // 3단계 명암 그라데이션 → 셀 셰이딩 느낌
  const steps = new Uint8Array([60, 150, 255]);
  const gradient = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;

  const mesh = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.8, 0.28, 128, 16),
    new THREE.MeshToonMaterial({ color: 0x9a3b2e, gradientMap: gradient }),
  );
  scene.add(mesh);
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const sun = new THREE.DirectionalLight(0xffeedd, 2.2);
  sun.position.set(3, 4, 2);
  scene.add(sun);

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  return {
    renderer,
    render(dtSec: number) {
      mesh.rotation.y += dtSec * 0.6;
      mesh.rotation.x += dtSec * 0.2;
      renderer.render(scene, camera);
    },
  };
}
