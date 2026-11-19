import * as THREE from 'three';
import { setMetalEnv } from './materials';

// 사실적 겉모습 설정(A-1): 화면 처리·조명·안개·하늘빛 반사·화면 가장자리 어둡힘.
// 화질 단계(E-1)가 들어오면 `shadowSize`, `vignette` 같은 값을 단계별로 바꿔 부른다.
export interface LookOptions { shadowSize: number; vignette: boolean }
export const LOOK_DEFAULT: LookOptions = { shadowSize: 1024, vignette: true };

export const HAZE = 0x6f7a86; // 안개·배경색 (e2e 테스트의 "그려졌는지" 기준색과 같다)

export function applyLook(renderer: THREE.WebGLRenderer, scene: THREE.Scene, opts: LookOptions = LOOK_DEFAULT) {
  // 화면 처리: 영화 같은 톤 매핑(밝은 곳이 하얗게 날아가지 않게), 부드러운 그림자
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  scene.background = new THREE.Color(HAZE);
  scene.fog = new THREE.Fog(HAZE, 22, 78);

  // 하늘빛 반사: 하늘→지평선→땅 세 빛깔의 큰 공을 한 번 구워 금속 표면에 비춘다
  const sky = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 24, 16);
  const pos = geo.attributes.position, colors: number[] = [];
  const top = new THREE.Color(0x4c6580), mid = new THREE.Color(0x9aa4ac), low = new THREE.Color(0x3a3226), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 50;
    if (y >= 0) c.copy(mid).lerp(top, Math.min(1, y * 1.6)); else c.copy(mid).lerp(low, Math.min(1, -y * 3));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  sky.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pmrem = new THREE.PMREMGenerator(renderer);
  setMetalEnv(pmrem.fromScene(sky, 0.04).texture); // 검·황동 반사용. 먼저 불러야 한다(재질이 만들어질 때 붙임)
  pmrem.dispose();

  // 조명: 하늘빛(차갑게) + 낮게 든 해(따뜻하게) → 긴 그림자
  scene.add(new THREE.HemisphereLight(0xaab8c8, 0x4a3f33, 1.3));
  const sun = new THREE.DirectionalLight(0xffd9a8, 3.2);
  sun.position.set(22, 24, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(opts.shadowSize, opts.shadowSize);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 2;
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -30; sc.right = sc.top = 30; sc.far = 90;
  scene.add(sun);

  // 후처리 대신 가벼운 화면 가장자리 어둡힘(비용 거의 없음)
  if (opts.vignette) {
    const el = document.createElement('div');
    el.id = 'vignette';
    el.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 55%,rgba(8,6,5,0.45) 100%)';
    renderer.domElement.parentElement?.appendChild(el);
  }
}
