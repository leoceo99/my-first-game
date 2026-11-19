import * as THREE from 'three';
import type { Obstacle } from '../sim/player';
import { PLAZA, ROAD_HALF_WIDTH } from '../sim/surface';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat, solid } from './materials';

/** 점검용 작은 중세 마을: 흙길, 집 6채, 나무, 우물. 기본 도형 + 코드로 만든 사실적 질감(외부 에셋 없음). 조명·안개는 look.ts. */
export function buildWorld(scene: THREE.Scene): Obstacle[] {
  const obstacles: Obstacle[] = [];

  const flat = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const f = new THREE.Mesh(geo, m);
    f.rotation.x = -Math.PI / 2;
    f.position.set(x, y, z);
    f.receiveShadow = true;
    scene.add(f);
    return f;
  };
  // 바닥: 풀밭 → 흙길 → 우물 광장 돌바닥 (sim/surface.ts의 PLAZA와 같은 자리·크기)
  flat(new THREE.PlaneGeometry(80, 80), mat('grass', 40), 0, 0, 0);
  flat(new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, 80), mat('dirt', ROAD_HALF_WIDTH * 2 / 2.5, 32), 0, 0.01, 0);
  flat(new THREE.CircleGeometry(PLAZA.r, 48), mat('cobble', PLAZA.r * 2 / 3), PLAZA.x, 0.02, PLAZA.z);

  const houses: [number, number, number, number, number][] = [
    // x, z, 폭, 깊이, 회전(0 또는 90도)
    [-7, -8, 5, 4, 0], [7, -10, 4, 5, 0], [-7, 4, 4, 4, 0],
    [8, 3, 5, 4, 0], [-8, 16, 5, 5, 0], [7, 15, 4, 4, 0],
  ];
  for (const [x, z, w, d] of houses) {
    const h = 2.6;
    const wall = solid(new THREE.BoxGeometry(w, h, d), mat('plaster', Math.max(w, d) / 2.5, h / 2.5));
    wall.position.set(x, h / 2, z);
    // 아랫단 돌 기초와 목재 들보로 평평한 상자 느낌을 줄인다
    const base = solid(new THREE.BoxGeometry(w + 0.12, 0.5, d + 0.12), mat('rock', Math.max(w, d) / 1.5, 1));
    base.position.set(x, 0.25, z);
    const beam = solid(new THREE.BoxGeometry(w + 0.1, 0.16, d + 0.1), mat('wood', Math.max(w, d), 1));
    beam.position.set(x, h - 0.08, z);
    const roof = solid(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 2, 4), mat('tile', 4, 2));
    roof.position.set(x, h + 1, z);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(w / Math.max(w, d) * 1.08, 1, d / Math.max(w, d) * 1.08);
    const chimney = solid(new THREE.BoxGeometry(0.55, 1.6, 0.55), mat('rock', 1, 2));
    chimney.position.set(x + w * 0.22, h + 1.5, z - d * 0.15);
    const door = solid(new THREE.BoxGeometry(0.9, 1.6, 0.06), mat('wood', 1, 1));
    door.position.set(x + (x < 0 ? w / 2 + 0.04 : -w / 2 - 0.04), 0.8, z);
    door.rotation.y = Math.PI / 2;
    scene.add(wall, base, beam, roof, chimney, door);
    obstacles.push({ kind: 'box', x, z, hw: w / 2, hd: d / 2 });
  }

  // 나무·바위: 시드 고정 난수로 매번 같은 자리
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    const x = (rnd() - 0.5) * 70, z = (rnd() - 0.5) * 70;
    if (Math.abs(x) < 13 && z > -15 && z < 22) continue; // 마을 안은 비움
    const s = 0.8 + rnd() * 0.6;
    const trunk = solid(new THREE.CylinderGeometry(0.2, 0.32, 2.2, 8), mat('bark', 1, 2));
    trunk.position.set(x, 1.1, z);
    scene.add(trunk);
    // 가지 층 3겹을 한 덩어리로 합쳐 그린다(그리기 호출 수↓): 아래가 넓고 위로 갈수록 좁다
    const layers = [0, 1, 2].map((k) => {
      const g = new THREE.ConeGeometry((1.5 - k * 0.38) * s, (1.7 - k * 0.2) * s, 9);
      g.rotateY(rnd() * 6);
      g.rotateX((rnd() - 0.5) * 0.12);
      g.translate(0, (1.9 + k * 1.05) * (0.9 + s * 0.1), 0);
      return g;
    });
    const crown = solid(mergeGeometries(layers), mat('foliage', 3, 2));
    crown.position.set(x, 0, z);
    scene.add(crown);
    obstacles.push({ kind: 'circle', x, z, r: 0.35 });
  }
  for (let i = 0; i < 22; i++) {
    const x = (rnd() - 0.5) * 70, z = (rnd() - 0.5) * 70, s = 0.35 + rnd() * 0.7;
    if (Math.abs(x) < 3 || (Math.abs(x) < 13 && z > -15 && z < 22)) continue; // 길·마을 안은 비움
    const rock = solid(new THREE.DodecahedronGeometry(s, 1), mat('rock', 2, 2));
    rock.position.set(x, s * 0.45, z);
    rock.scale.set(1.2, 0.8, 1);
    rock.rotation.set(rnd() * 3, rnd() * 6, rnd() * 3);
    scene.add(rock);
    obstacles.push({ kind: 'circle', x, z, r: s * 0.9 });
  }

  // 우물 (광장 가운데)
  const well = solid(new THREE.CylinderGeometry(0.9, 1, 0.9, 16), mat('rock', 4, 1));
  well.position.set(0, 0.45, 9);
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.78, 16), new THREE.MeshStandardMaterial({ color: 0x0c1a22, roughness: 0.08, metalness: 0.0, envMap: null }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.8, 9);
  const post1 = solid(new THREE.BoxGeometry(0.15, 1.6, 0.15), mat('wood', 1, 1));
  post1.position.set(-0.8, 1.2, 9);
  const post2 = post1.clone(); post2.position.x = 0.8;
  const beam = solid(new THREE.BoxGeometry(1.8, 0.15, 0.15), mat('wood', 2, 1));
  beam.position.set(0, 2, 9);
  scene.add(well, water, post1, post2, beam);
  obstacles.push({ kind: 'circle', x: 0, z: 9, r: 1 });

  return obstacles;
}

export const DUMMY = { x: 3.5, z: -1.5, r: 0.28, yMin: 0.3, yMax: 1.8 };

/** 베기 연습용 짚 허수아비. 맞으면 흔들린다. */
export function buildDummy(scene: THREE.Scene) {
  const root = new THREE.Group();
  root.position.set(DUMMY.x, 0, DUMMY.z);
  const pole = solid(new THREE.CylinderGeometry(0.06, 0.07, 2, 8), mat('wood', 1, 2));
  pole.position.y = 1;
  const sway = new THREE.Group();
  sway.position.y = 0.2;
  const body = solid(new THREE.CylinderGeometry(0.26, 0.3, 1.1, 12), mat('straw', 2, 2));
  body.position.y = 0.9;
  const arms = solid(new THREE.CylinderGeometry(0.07, 0.07, 1.3, 8), mat('straw', 1, 2));
  arms.position.y = 1.25;
  arms.rotation.z = Math.PI / 2;
  const head = solid(new THREE.SphereGeometry(0.2, 14, 10), mat('straw', 2, 2));
  head.position.y = 1.65;
  sway.add(body, arms, head);
  root.add(pole, sway);
  scene.add(root);
  let angle = 0, vel = 0, axisX = 0, axisZ = 1;
  return {
    obstacle: { kind: 'circle' as const, x: DUMMY.x, z: DUMMY.z, r: DUMMY.r },
    /** 맞은 방향(수평 단위 벡터)으로 밀린다 */
    hit(dx: number, dz: number) { axisX = dz; axisZ = -dx; vel += 3.5; },
    update(dt: number) {
      // 용수철처럼 되돌아온다
      vel += (-60 * angle - 4 * vel) * dt;
      angle += vel * dt;
      sway.setRotationFromAxisAngle(new THREE.Vector3(axisX, 0, axisZ).normalize(), angle * 0.25);
    },
  };
}
