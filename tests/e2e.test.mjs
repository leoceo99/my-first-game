// 실제 브라우저로 앱을 띄워서 확인하는 테스트.
//
// 준비: docs/vendor/pyodide/ 에 pyodide 패키지 파일을 넣어 두세요 (npm pack pyodide@314.0.7).
// 실행: node --test tests/e2e.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8765;
const URL_ = `http://localhost:${PORT}/?engine=local`;
const SHOTS = process.env.SHOTS_DIR;
const IPAD = { viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 1 };

const haveEngine = existsSync(path.join(ROOT, "docs/vendor/pyodide/pyodide.asm.wasm"));
let server;
let browser;

before(async () => {
  if (!haveEngine) return;
  server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
    cwd: path.join(ROOT, "docs"), stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 800));
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

async function openApp(options = {}) {
  const context = await browser.newContext({ ...IPAD, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL_);
  await page.waitForFunction(() => window.pybridge?.engine.state === "ready", null, { timeout: 60000 });
  return { context, page, errors };
}

async function setCode(page, code) {
  await page.evaluate((c) => {
    const { editor } = window.pybridge;
    editor.ta.value = c;
    editor.ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, code);
}

const consoleText = (page) => page.locator("#console").innerText();
const waitIdle = (page) => page.waitForFunction(() => {
  const s = window.pybridge.engine.state;
  return s === "ready" || s === "failed";
}, null, { timeout: 30000 });
const waitAsk = (page) => page.waitForFunction(() => window.pybridge.engine.state === "waiting", null, { timeout: 30000 });

async function answer(page, text) {
  await waitAsk(page);
  await page.fill("#answer-input", text);
  await page.click(".btn-send");
}

test("기본 실행, input 대화, 변수 (replay 방식)", { skip: !haveEngine }, async () => {
  const { context, page, errors } = await openApp({ serviceWorkers: "block" });
  assert.match(await page.locator("#engine-text").innerText(), /Python 3\.\d+ 준비됨/);

  // 처음 열면 '첫 만남' 예제가 들어 있어요.
  assert.match(await page.locator("#file-name-text").innerText(), /첫 만남/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-start.png` });

  await page.click("#btn-run");
  await answer(page, "지민");
  await answer(page, "12");
  await waitIdle(page);
  const text = await consoleText(page);
  assert.match(text, /이름이 뭐예요\?/);
  assert.match(text, /반가워요, 지민님!/);
  assert.match(text, /10년 뒤에는 22살이 되겠네요\./);
  assert.equal((text.match(/반가워요/g) || []).length, 1, "replay해도 출력은 한 번만");
  assert.match(text, /끝났어요/);

  await page.click("#tab-vars");
  const vars = await page.locator("#vars").innerText();
  assert.match(vars, /name[\s\S]*str[\s\S]*'지민'/);
  assert.match(vars, /age[\s\S]*int[\s\S]*12/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-vars.png` });
  assert.deepEqual(errors, []);
  await context.close();
});

test("서비스 워커가 켜진 앱에서도 반복문 속 input이 잘 돼요", { skip: !haveEngine }, async () => {
  const { context, page, errors } = await openApp();
  // 서비스 워커가 페이지를 맡은 상태(홈 화면 앱과 같은 상태)로 다시 열어요.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  await page.reload();
  await page.waitForFunction(() => window.pybridge?.engine.state === "ready", null, { timeout: 60000 });

  await setCode(page, [
    "import random",
    "secret = random.randint(1, 10**9)",
    "print('시작', secret)",
    "total = 0",
    "passed = 0",
    "for i in range(5):",
    "    score = int(input('점수 입력: '))",
    "    total = total + score",
    "    if score >= 60:",
    "        passed = passed + 1",
    "print('합계', total, '통과', passed, secret)",
  ].join("\n"));
  await page.click("#btn-run");
  await waitAsk(page);
  await page.waitForTimeout(20000); // 답을 늦게 해도 오류가 나지 않아야 해요
  assert.equal(await page.locator(".error-card").count(), 0);
  for (const score of ["80", "50", "90", "70", "40"]) await answer(page, score);
  await waitIdle(page);
  const text = await consoleText(page);
  const secret = text.match(/시작 (\d+)/)[1];
  assert.match(text, new RegExp(`합계 330 통과 3 ${secret}`));
  assert.equal((text.match(/시작/g) || []).length, 1);
  assert.equal(await page.locator(".ask").count(), 5);
  assert.equal(await page.locator(".reply").count(), 5);
  assert.deepEqual(errors, []);
  await context.close();
});

test("오류 안내와 오류 줄 표시", { skip: !haveEngine }, async () => {
  const { context, page } = await openApp({ serviceWorkers: "block" });
  await setCode(page, "age = input('나이? ')\nnext_year = age + 1\nprint(next_year)\n");
  await page.click("#btn-run");
  await answer(page, "13");
  await waitIdle(page);
  const card = page.locator(".error-card");
  assert.match(await card.locator("h3").innerText(), /값의 종류가 맞지 않아요/);
  assert.match(await card.innerText(), /\+ 로 바로 붙일 수 없어요/);
  assert.match(await card.innerText(), /2번째 줄 보기/);
  assert.equal(await page.locator(".ed-errline").isVisible(), true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-error.png` });

  await setCode(page, "print('안녕'\n");
  await page.click("#btn-run");
  await waitIdle(page);
  assert.match(await page.locator(".error-card h3").innerText(), /문법이 맞지 않아요/);
  await context.close();
});

test("무한 반복을 멈추고 다시 실행할 수 있어요", { skip: !haveEngine }, async () => {
  const { context, page } = await openApp({ serviceWorkers: "block" });
  await setCode(page, "n = 0\nwhile True:\n    n += 1\n    if n % 100000 == 0:\n        print(n)\n");
  await page.click("#btn-run");
  await page.waitForFunction(() => document.querySelector("#console").innerText.includes("300000"), null, { timeout: 30000 });
  assert.equal(await page.isDisabled("#btn-stop"), false);
  await page.click("#btn-stop");
  assert.match(await consoleText(page), /멈췄어요/);
  await page.waitForFunction(() => window.pybridge.engine.state === "ready", null, { timeout: 60000 });
  await setCode(page, "print(6 * 7)");
  await page.click("#btn-run");
  await waitIdle(page);
  assert.match(await consoleText(page), /42/);
  await context.close();
});

test("기호 키, 자동 들여쓰기, 스마트 따옴표 고치기", { skip: !haveEngine }, async () => {
  const { context, page } = await openApp({ serviceWorkers: "block" });
  await setCode(page, "");
  await page.click(".ed-input");
  await page.keyboard.type("for i in range");
  await page.click(".keybar .key:text-is('( )')");
  await page.keyboard.type("3");
  await page.click(".keybar .key:text-is(')')"); // 닫는 괄호 위를 지나가요
  await page.click(".keybar .key:text-is(':')");
  await page.keyboard.press("Enter");
  await page.keyboard.type("print(i)");
  assert.equal(await page.evaluate(() => window.pybridge.editor.value), "for i in range(3):\n    print(i)");

  await page.keyboard.press("Enter");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("print(“끝”)");
  assert.equal(await page.evaluate(() => window.pybridge.editor.value), 'for i in range(3):\n    print(i)\nprint("끝")');

  await page.click("#btn-run");
  await waitIdle(page);
  assert.match(await consoleText(page), /0\n1\n2\n끝/);
  await context.close();
});

test("코드는 이 기기에 저장되고 예제로 새 코드를 만들 수 있어요", { skip: !haveEngine }, async () => {
  const { context, page } = await openApp({ serviceWorkers: "block" });
  await setCode(page, "print('저장 테스트')");
  await page.click("#btn-drawer");
  await page.click(".example-list button:has-text('구구단')");
  assert.match(await page.locator("#file-name-text").innerText(), /구구단/);
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => window.pybridge?.engine, null, { timeout: 30000 });
  assert.match(await page.locator("#file-name-text").innerText(), /구구단/);
  await page.click("#btn-drawer");
  await page.locator("#file-list .item-name").first().waitFor({ state: "visible" });
  const names = await page.locator("#file-list .item-name").allInnerTexts();
  assert.deepEqual(names, ["구구단", "첫 만남"]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-drawer.png` });
  await page.click("#file-list button:has-text('첫 만남')");
  assert.equal(await page.evaluate(() => window.pybridge.editor.value), "print('저장 테스트')");
  await context.close();
});

test("세로 화면", { skip: !haveEngine || !SHOTS }, async () => {
  const { context, page } = await openApp({ serviceWorkers: "block", viewport: { width: 820, height: 1180 } });
  await page.click("#btn-drawer");
  await page.click(".example-list button:has-text('성적표')");
  await page.click("#btn-run");
  await waitIdle(page);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/5-portrait.png` });
  }
  await context.close();
});
