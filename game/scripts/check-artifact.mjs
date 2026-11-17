// 아티팩트용 단일 HTML이 제대로 만들어졌는지 확인한다 (외부 파일 참조 없음, 16MB 이하).
import { readFileSync, statSync } from 'node:fs';
const file = new URL('../dist-artifact/index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
const mb = statSync(file).size / 1024 / 1024;
const external = html.match(/<script[^>]+src=|<link[^>]+href="(?!data:)/g) ?? [];
if (external.length) { console.error('외부 파일 참조가 남아 있음:', external); process.exit(1); }
if (mb > 16) { console.error(`크기 초과: ${mb.toFixed(2)}MB`); process.exit(1); }
console.log(`아티팩트 준비 완료: dist-artifact/index.html (${mb.toFixed(2)}MB)`);
