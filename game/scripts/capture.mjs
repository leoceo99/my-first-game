// 전후 스크린샷·fps 기록용(A-1): 먼저 npx vite build, 그다음 node scripts/capture.mjs <꼬리표>. 소프트웨어 렌더라 fps는 참고값.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
const tag = process.argv[2];
const out = new URL('../../jarvis/reports/art', import.meta.url).pathname;
const srv = spawn('npx', ['vite', 'preview', '--port', '4799', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 3000));
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:4799/');
await p.waitForFunction(() => (window.__game?.frames ?? 0) > 30);
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/${tag}_마을_3인칭.png` });
await p.evaluate(() => window.__dev.setPlayer(0, 14, 0)); // 우물 광장 쪽
await p.keyboard.press('Digit1'); await p.keyboard.press('KeyF').catch(()=>{});
await p.waitForTimeout(1200);
await p.screenshot({ path: `${out}/${tag}_광장.png` });
await p.waitForTimeout(3000);
const fps = await p.evaluate(() => window.__game.fps);
console.log(tag, 'fps(소프트웨어 렌더, 참고값)=', fps, 'errors=', errs);
await b.close(); srv.kill();
