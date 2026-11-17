import { defineConfig } from '@playwright/test';

// 실제 브라우저로 빌드 결과(dist)를 띄워 화면이 그려지는지 확인한다.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:4173', viewport: { width: 1280, height: 720 } },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
  },
});
