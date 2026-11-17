import { expect, test } from '@playwright/test';

test('게임 화면이 뜨고 3D 장면이 실제로 그려진다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#title')).toHaveText('개발 골격 점검 화면');
  await page.waitForFunction(() => ((window as any).__game?.frames ?? 0) > 30);

  // 캔버스를 2D로 복사해 배경색과 다른 픽셀 비율을 잰다 (물체가 그려졌는지)
  const ratio = await page.evaluate(() => {
    const src = document.querySelector('canvas')!;
    const c = document.createElement('canvas');
    c.width = 160; c.height = 90;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - 0x1a) + Math.abs(d[i + 1] - 0x18) + Math.abs(d[i + 2] - 0x20) > 30) n++;
    }
    return n / (c.width * c.height);
  });
  const differs = ratio > 0.02;
  expect(differs).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/smoke.png' });
});
