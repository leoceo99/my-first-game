import { defineConfig } from '@playwright/test';

// 실제 브라우저로 빌드 결과(dist)를 띄워 화면이 그려지는지 확인한다.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  // 한 번에 하나씩: 성능 측정 테스트가 다른 테스트와 계산 자원을 나눠 쓰면 fps가 흐트러지고
  // 걷기 거리 같은 시간 기반 검사가 실패한다 (E-1에서 확인).
  workers: 1,
  use: { baseURL: 'http://localhost:4173', viewport: { width: 1280, height: 720 } },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
  },
});
