import { expect, test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const state = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__game);

test('화질 단계가 실제로 적용되고, 버튼으로 바뀌고, 선택이 저장된다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?q=low');
  await page.waitForFunction(() => ((window as any).__game?.frames ?? 0) > 10);
  let s = await state(page);
  expect(s.quality).toBe('low');
  expect(s.shadows).toBe(false);
  expect(s.pixelRatio).toBe(0.75);
  await expect(page.locator('#btn-quality')).toHaveText('화질: 낮음');
  await page.screenshot({ path: 'test-results/quality-low.png' });

  await page.click('#btn-quality'); // → 보통
  await page.waitForTimeout(300);
  s = await state(page);
  expect(s.quality).toBe('medium');
  expect(s.shadows).toBe(true);
  expect(s.pixelRatio).toBe(1);
  await expect(page.locator('#toast')).toContainText('화질을 바꿨습니다');
  await page.keyboard.press('KeyQ'); // → 높음
  await page.waitForTimeout(300);
  expect((await state(page)).quality).toBe('high');
  await page.screenshot({ path: 'test-results/quality-high.png' });

  // 주소에 q가 없으면 저장해 둔 선택(높음)으로 시작
  await page.goto('/');
  await page.waitForFunction(() => ((window as any).__game?.frames ?? 0) > 10);
  expect((await state(page)).quality).toBe('high');
  await expect(page.locator('#perf')).toContainText('화질 높음');
  expect(errors).toEqual([]);
});

test('자동 성능 측정: 화질 3단계 결과가 나오고 원래 화질로 돌아온다', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?q=medium&warm=1&secs=4');
  await page.waitForFunction(() => ((window as any).__game?.frames ?? 0) > 10);
  await page.click('#btn-bench');
  await expect(page.locator('#bench-progress')).toBeVisible();
  await page.waitForFunction(() => !!(window as any).__bench, null, { timeout: 60_000 });
  const bench = await page.evaluate(() => (window as any).__bench);
  expect(bench.results.map((r: any) => r.level)).toEqual(['low', 'medium', 'high']);
  for (const r of bench.results) {
    expect(r.frames).toBeGreaterThan(5);
    expect(r.avgFps).toBeGreaterThan(0);
    expect(r.drawCalls).toBeGreaterThan(0);
  }
  // 그림자를 끈 낮음은 그리기 호출이 더 적다 (그림자 그리기가 빠지므로)
  expect(bench.results[0].drawCalls).toBeLessThan(bench.results[1].drawCalls);
  await expect(page.locator('#bench')).toBeVisible();
  await expect(page.locator('#bench-rows')).toContainText('낮음: 평균');
  await page.screenshot({ path: 'test-results/bench-result.png' });
  const s = await state(page);
  expect(s.quality).toBe('medium');
  expect(s.benching).toBe(false);

  // 단계별 fps 표를 파일로 남긴다 (이 작업 환경은 그래픽 카드가 없어 참고값)
  mkdirSync('test-results', { recursive: true });
  const lines = ['| 화질 | 평균 fps | 1% 저점 fps | 95% 프레임 ms | 그리기 호출 | 삼각형 |', '|---|---|---|---|---|---|',
    ...bench.results.map((r: any) => `| ${r.level} | ${r.avgFps} | ${r.low1Fps} | ${r.p95Ms} | ${r.drawCalls} | ${r.triangles} |`)];
  writeFileSync('test-results/perf-table.md', `그래픽: ${bench.gpu} · 기기 배율 ${bench.dpr}\n\n${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  expect(errors).toEqual([]);
});
