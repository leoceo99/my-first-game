import { createSkeletonScene } from './engine/scene';
import { FpsMeter } from './sim/fps';
import { t, type StringTable } from './sim/strings';
import ko from '../data/strings/ko.json';

const strings = ko as StringTable;
const app = document.getElementById('app')!;
document.getElementById('title')!.textContent = t(strings, 'ui.skeleton.title');
const fpsEl = document.getElementById('fps')!;

const view = createSkeletonScene(app);
const meter = new FpsMeter();
let last = performance.now();
let frames = 0;

function loop(now: number) {
  view.render((now - last) / 1000);
  last = now;
  meter.tick(now);
  frames++;
  if (frames % 15 === 0) fpsEl.textContent = t(strings, 'ui.skeleton.fps', { fps: meter.fps });
  // 자동 테스트가 읽는 상태값
  (window as unknown as { __game: object }).__game = { frames, fps: meter.fps };
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
