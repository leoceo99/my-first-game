// docs/13(공통 의도 사전 초안)의 표를 게임 데이터로 옮긴다 (E-2).
// 출력: data/dialogue/intents.json (뜻·계열·등급) + locales/ko/intents.json (예문, 첫 예문 = "말 고르기" 버튼 글)
// 사용: node scripts/build-intents.mjs   — docs/13을 고친 뒤 다시 실행한다. 손으로 두 JSON을 고치지 않는다.
import { readFileSync, writeFileSync } from 'node:fs';
const doc = readFileSync(new URL('../../docs/13_공통의도사전_초안.md', import.meta.url), 'utf8');
const FAMILY = { '1': '믿는다', '2': '따진다', '3': '떠본다', '4': '숨긴다' };
const intents = [];
const ko = {};
let family = null;
for (const line of doc.split('\n')) {
  const h = line.match(/^## ([1-4])\. /);
  if (h) { family = FAMILY[h[1]]; continue; }
  if (/^## /.test(line)) { family = null; continue; }
  if (!family) continue;
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length < 8 || !/^\d+$/.test(cells[1])) continue;
  const [, num, rawId, name, desc, pairs, examples] = cells;
  const important = rawId.includes('★');
  const id = rawId.replace('★', '').trim();
  const ex = [...examples.matchAll(/"([^"]*)"|\(([^)]*)\)/g)]
    .filter((m) => m[1] !== undefined || /^[^가-힣]*$|^(빈 칸|고개를|돌아선다)/.test(m[2] ?? ''))
    .map((m) => (m[1] !== undefined ? m[1] : `(${m[2]})`));
  intents.push({ id, family, tier: important ? 'important' : 'common', name, desc, confusable: pairs.split(',').map((s) => s.trim()).filter(Boolean), no: Number(num) });
  ko[`intent.${id}`] = { text: ex[0] ?? name, examples: ex, context: `의도 '${name}'(${family})의 대표 문장. "말 고르기" 버튼 글로 쓰인다. 플레이어(주인공)가 NPC에게 하는 말. 출처 docs/13.` };
}
if (intents.length !== 60) { console.error(`의도가 60개가 아님: ${intents.length}`); process.exit(1); }
writeFileSync(new URL('../data/dialogue/intents.json', import.meta.url), JSON.stringify(intents, null, 2) + '\n');
writeFileSync(new URL('../locales/ko/intents.json', import.meta.url), JSON.stringify(ko, null, 2) + '\n');
console.log(`의도 ${intents.length}개 (중요 ${intents.filter((i) => i.tier === 'important').length}개) 저장`);
