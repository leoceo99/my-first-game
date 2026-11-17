import { expect, test, type Page } from '@playwright/test';

const state = (page: Page) => page.evaluate(() => (window as any).__game);

/** 화면을 축소 복사해 하늘색과 다른 픽셀 비율을 잰다 = 땅·집 등이 실제로 그려졌는지 */
const drawnRatio = (page: Page) => page.evaluate(() => {
  const src = document.querySelector('canvas')!;
  const c = document.createElement('canvas'); c.width = 160; c.height = 90;
  const ctx = c.getContext('2d')!; ctx.drawImage(src, 0, 0, 160, 90);
  const d = ctx.getImageData(0, 0, 160, 90).data; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 0x6f) + Math.abs(d[i + 1] - 0x7a) + Math.abs(d[i + 2] - 0x86) > 30) n++;
  return n / (160 * 90);
});

test('마을이 그려지고, 걷고, 시점을 바꾸고, 저장·불러오기가 된다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => ((window as any).__game?.frames ?? 0) > 30);
  expect(await drawnRatio(page)).toBeGreaterThan(0.3);
  await page.screenshot({ path: 'test-results/third.png' });

  // 걷기: W를 1초 누르면 -z로 이동
  const s0 = await state(page);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1000); await page.keyboard.up('KeyW');
  const s1 = await state(page);
  expect(s1.player.z).toBeLessThan(s0.player.z - 1);

  // 1인칭 전환
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(500);
  expect((await state(page)).camera).toBe('first');
  await expect(page.locator('#camera')).toHaveText('시점: 1인칭');
  await page.screenshot({ path: 'test-results/first.png' });

  // 저장 → 이동 → 불러오기 하면 저장한 자리로
  await page.keyboard.press('KeyK');
  await expect(page.locator('#toast')).toHaveText('저장했습니다');
  const saved = (await state(page)).player;
  await page.keyboard.down('KeyD'); await page.waitForTimeout(800); await page.keyboard.up('KeyD');
  expect(Math.abs((await state(page)).player.x - saved.x)).toBeGreaterThan(0.5);
  await page.keyboard.press('KeyV'); // 3인칭으로 바꿔 둠
  await page.click('#btn-load');
  await expect(page.locator('#toast')).toHaveText('불러왔습니다');
  const back = await state(page);
  expect(back.player.x).toBeCloseTo(saved.x, 3);
  expect(back.player.z).toBeCloseTo(saved.z, 3);
  expect(back.camera).toBe('first'); // 저장 당시 시점도 복원

  // 새로 고침 후에도 저장이 남아 있다
  await page.reload();
  await page.waitForFunction(() => ((window as any).__game?.frames ?? 0) > 10);
  await page.keyboard.press('KeyL');
  await expect(page.locator('#toast')).toHaveText('불러왔습니다');
  expect((await state(page)).player.x).toBeCloseTo(saved.x, 3);

  // 성능: 5초 평균 fps 기록 (이 환경은 그래픽 카드가 없어 참고값)
  await page.waitForTimeout(5000);
  console.log('측정 fps:', (await state(page)).fps);
  expect(errors).toEqual([]);
});

test('집을 뚫고 들어가지 못한다', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => ((window as any).__game?.frames ?? 0) > 10);
  // 시작점(0,2)에서 오른쪽(+x)으로 달리면 x=8 집(폭 5, 왼쪽 벽 x=5.5)에 막힌다
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyD');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyD'); await page.keyboard.up('ShiftLeft');
  const s = await state(page);
  expect(s.player.x).toBeLessThan(5.5);
  expect(s.player.x).toBeGreaterThan(4.5);
});
