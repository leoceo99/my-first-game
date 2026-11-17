import * as THREE from 'three';
import type { Obstacle } from '../sim/player';
import { toon, toonMesh } from './toon';

/** 점검용 작은 중세 마을: 흙길, 집 6채, 나무, 우물. 모두 기본 도형(에셋 없음). */
export function buildWorld(scene: THREE.Scene): Obstacle[] {
  const obstacles: Obstacle[] = [];
  scene.background = new THREE.Color(0x6f7a86);
  scene.fog = new THREE.Fog(0x6f7a86, 25, 70);

  const hemi = new THREE.HemisphereLight(0xb8c4d0, 0x3a3226, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2c0, 2.4);
  sun.position.set(18, 30, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -30; sc.right = sc.top = 30; sc.far = 80;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), toon(0x4d5a35));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(4, 80), toon(0x7a6347));
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;
  road.receiveShadow = true;
  scene.add(road);

  const houses: [number, number, number, number, number][] = [
    // x, z, 폭, 깊이, 회전(0 또는 90도)
    [-7, -8, 5, 4, 0], [7, -10, 4, 5, 0], [-7, 4, 4, 4, 0],
    [8, 3, 5, 4, 0], [-8, 16, 5, 5, 0], [7, 15, 4, 4, 0],
  ];
  for (const [x, z, w, d] of houses) {
    const h = 2.6;
    const wall = toonMesh(new THREE.BoxGeometry(w, h, d), 0xb9a98a, 0.06);
    wall.position.set(x, h / 2, z);
    const roof = toonMesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 2, 4), 0x5b2e22, 0.06);
    roof.position.set(x, h + 1, z);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.05), toon(0x3b2a1e));
    door.position.set(x + (x < 0 ? w / 2 + 0.03 : -w / 2 - 0.03), 0.8, z);
    door.rotation.y = Math.PI / 2;
    scene.add(wall, roof, door);
    obstacles.push({ kind: 'box', x, z, hw: w / 2, hd: d / 2 });
  }

  // 나무: 시드 고정 난수로 매번 같은 자리
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    const x = (rnd() - 0.5) * 70, z = (rnd() - 0.5) * 70;
    if (Math.abs(x) < 13 && z > -15 && z < 22) continue; // 마을 안은 비움
    const trunk = toonMesh(new THREE.CylinderGeometry(0.2, 0.3, 2, 6), 0x4a3424, 0.05);
    trunk.position.set(x, 1, z);
    const s = 0.8 + rnd() * 0.6;
    const leaves = toonMesh(new THREE.ConeGeometry(1.4 * s, 3.2 * s, 7), 0x2c4a2a, 0.06);
    leaves.position.set(x, 2 + 1.4 * s, z);
    scene.add(trunk, leaves);
    obstacles.push({ kind: 'circle', x, z, r: 0.35 });
  }

  // 우물 (광장 가운데)
  const well = toonMesh(new THREE.CylinderGeometry(0.9, 1, 0.9, 12), 0x7d7a74, 0.05);
  well.position.set(0, 0.45, 9);
  const post1 = toonMesh(new THREE.BoxGeometry(0.15, 1.6, 0.15), 0x4a3424);
  post1.position.set(-0.8, 1.2, 9);
  const post2 = post1.clone(); post2.position.x = 0.8;
  const beam = toonMesh(new THREE.BoxGeometry(1.8, 0.15, 0.15), 0x4a3424);
  beam.position.set(0, 2, 9);
  scene.add(well, post1, post2, beam);
  obstacles.push({ kind: 'circle', x: 0, z: 9, r: 1 });

  return obstacles;
}
