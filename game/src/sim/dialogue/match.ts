// 임시 의도 매칭기 (E-2). 기기 안 매칭 모델(E-3에서 후보 조사)이 들어오기 전까지 쓰는 "글자 겹침" 방식.
// 입력과 각 의도 예문의 두 글자 묶음이 얼마나 겹치는지(Dice 계수)를 잰다. 인터넷·모델 파일 없음.
// 정확도는 낮다: 뜻이 같아도 낱말이 다르면 못 알아듣는다. 그때는 NPC가 되묻는다(docs/08 0절 4).

export interface MatchResult { intent: string | null; score: number; second: number }

const normalize = (s: string) => s.toLowerCase().replace(/[\s.,!?…~"'“”‘’·()\-]/g, '');

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = normalize(s);
  if (t.length === 1) m.set(t, 1);
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
}

export function similarity(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  for (const [g, v] of A) inter += Math.min(v, B.get(g) ?? 0);
  return na + nb === 0 ? 0 : (2 * inter) / (na + nb);
}

/**
 * examples: 의도 ID → 예문들. allowed가 있으면 그 의도만 본다.
 * 빈 입력·한 글자 입력은 바로 침묵(silence)으로 본다 (docs/13 5절 4).
 */
export function matchIntent(input: string, examples: Record<string, string[]>, allowed?: Set<string>, threshold = 0.34): MatchResult {
  const text = normalize(input);
  if (text.length <= 1 && (!allowed || allowed.has('silence'))) return { intent: 'silence', score: 1, second: 0 };
  let best: string | null = null, top = 0, second = 0;
  for (const [id, exs] of Object.entries(examples)) {
    if (allowed && !allowed.has(id)) continue;
    let s = 0;
    for (const ex of exs) s = Math.max(s, similarity(input, ex));
    if (s > top) { second = top; top = s; best = id; } else if (s > second) second = s;
  }
  return { intent: top >= threshold ? best : null, score: top, second };
}
