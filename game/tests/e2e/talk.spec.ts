import { expect, test, type Page } from '@playwright/test';

const talk = (page: Page) => page.evaluate(() => (window as any).__dev.talk());
const goNearElder = async (page: Page) => {
  await page.evaluate(() => (window as any).__dev.setPlayer(-1.2, 5.2, -2.3 + Math.PI));
  await page.waitForTimeout(200);
};

test('장로에게 말 걸기: 글로 쓰기 → 되묻기, 말 고르기 → 끝까지, 되감기 후 대사가 바뀐다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?q=low');
  await page.waitForFunction(() => ((window as any).__game?.frames ?? 0) > 10);

  // 멀리서는 안내가 없다
  await expect(page.locator('#talk-prompt')).toBeHidden();
  await goNearElder(page);
  await expect(page.locator('#talk-prompt')).toHaveText('E: 말 걸기');
  await page.keyboard.press('KeyE');
  await expect(page.locator('#talk')).toBeVisible();
  await expect(page.locator('#talk-log')).toContainText('우물물은 늘 차갑지');
  await expect(page.locator('#talk-log')).toContainText('무엇을 보았느냐');

  // 입력 칸에 글을 쓰는 동안 W·1 같은 조작 키가 움직이거나 베지 않는다
  const before = await page.evaluate(() => (window as any).__game.player);
  await page.locator('#talk-input').fill('');
  await page.locator('#talk-input').pressSequentially('양자역학 컴퓨터 주식 1w');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => (window as any).__game);
  expect(after.player.x).toBeCloseTo(before.x, 3);
  expect(after.attack).toBeNull();
  // 엉뚱한 말 → 되묻기
  await page.keyboard.press('Enter');
  await expect(page.locator('#talk-log')).toContainText('다시, 똑똑히 말해라');
  expect((await talk(page)).node).toBe('q1');

  // 글로 사실대로 → 의도별 반응 + 신뢰가 올라 다른 질문
  await page.locator('#talk-input').fill('봤어요. 그대로 말할게요.');
  await page.keyboard.press('Enter');
  await expect(page.locator('#talk-log')).toContainText('바로 말해 주니 고맙구나');
  await expect(page.locator('#talk-log')).toContainText('하나는 얼굴을 보았느냐');
  expect((await talk(page)).trust).toBe(1);
  await page.screenshot({ path: 'test-results/talk-q2.png' });

  // 말 고르기 → 7~10개 버튼, 위로(믿는다) 고르기 → 따뜻한 끝
  await page.click('#talk-choose');
  const n = await page.locator('#talk-choices button').count();
  expect(n).toBeGreaterThanOrEqual(7);
  expect(n).toBeLessThanOrEqual(10);
  await page.click('#talk-choices button[data-intent="truth"]');
  await expect(page.locator('#talk-log')).toContainText('하나는 내 아들이다');
  await expect(page.locator('#talk-form')).toBeHidden();
  let s = await talk(page);
  expect(s.ended).toBe(true);
  expect(s.knows).toBe(true);
  await page.screenshot({ path: 'test-results/talk-end.png' });

  // 되감기 → 2번째 삶: 장로는 잊었지만 주인공 기억 때문에 첫 대사가 바뀐다
  await page.click('#talk-rewind');
  await expect(page.locator('#toast')).toContainText('2번째 삶');
  await expect(page.locator('#talk')).toBeHidden();
  await page.keyboard.press('KeyE');
  await expect(page.locator('#talk-log')).toContainText('우물물은 늘 차갑지'); // 세 삶 반복 대사
  await expect(page.locator('#talk-log')).toContainText('이미 아는 것처럼');
  s = await talk(page);
  expect(s.life).toBe(2);
  expect(s.trust).toBe(0);
  // 숨긴다 → 둘째 질문 → 장면 전용 의도(아들 지목)를 글로
  await page.locator('#talk-input').fill('글쎄요, 날씨가 춥군요.');
  await page.keyboard.press('Enter');
  await page.locator('#talk-input').fill('그중 하나는 장로님 아들이었소');
  await page.keyboard.press('Enter');
  await expect(page.locator('#talk-log')).toContainText('그 이름을 어디서 들었느냐');
  await page.screenshot({ path: 'test-results/talk-life2.png' });

  // Esc로 닫으면 다시 움직일 수 있다
  await page.keyboard.press('Escape');
  await expect(page.locator('#talk')).toBeHidden();
  await page.keyboard.down('KeyW'); await page.waitForTimeout(500); await page.keyboard.up('KeyW');
  const moved = await page.evaluate(() => (window as any).__game.player);
  expect(Math.hypot(moved.x - after.player.x, moved.z - after.player.z)).toBeGreaterThan(0.3);
  expect(errors).toEqual([]);
});
