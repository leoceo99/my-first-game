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

test('점프, 바닥별 발소리 횟수', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => ((window as any).__game?.frames ?? 0) > 10);
  // 흙길을 걸으면 흙 발소리가 늘어난다
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
  let s = await state(page);
  expect(s.steps.dirt).toBeGreaterThanOrEqual(2);
  expect(s.steps.grass).toBe(0);
  // 풀밭으로 옮겨 걷기
  await page.evaluate(() => (window as any).__dev.setPlayer(10, 30, 0));
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
  s = await state(page);
  expect(s.steps.grass).toBeGreaterThanOrEqual(2);
  // 광장 돌바닥 (우물 남쪽)
  await page.evaluate(() => (window as any).__dev.setPlayer(-3, 9.5, Math.PI));
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1200); await page.keyboard.up('KeyW');
  expect((await state(page)).steps.stone).toBeGreaterThanOrEqual(1);
  // 점프
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  s = await state(page);
  expect(s.player.y).toBeGreaterThan(0.3);
  expect(s.player.onGround).toBe(false);
  await page.waitForTimeout(800);
  expect((await state(page)).player.onGround).toBe(true);
});

test('롱소드 베기 3종이 허수아비를 맞힌다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => ((window as any).__game?.frames ?? 0) > 10);
  // 허수아비(3.5, -1.5) 앞 1.3m에서 마주 본다
  await page.evaluate(() => (window as any).__dev.setPlayer(3.5, -0.2, 0));
  const shots: string[] = [];
  for (const [key, id] of [['Digit1', 'oberhau'], ['Digit2', 'mittelhau'], ['Digit3', 'unterhau']]) {
    const before = (await state(page)).hits;
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
    const mid = await state(page);
    expect(mid.attack).toBe(id);
    expect(mid.swordDrawn).toBe(true);
    await page.screenshot({ path: `test-results/cut-${id}.png` });
    shots.push(id);
    await page.waitForTimeout(900);
    expect((await state(page)).hits).toBe(before + 1);
  }
  // 멀리서 휘두르면 맞지 않는다
  await page.evaluate(() => (window as any).__dev.setPlayer(3.5, 3, 0));
  const h = (await state(page)).hits;
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(1100);
  expect((await state(page)).hits).toBe(h);
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
