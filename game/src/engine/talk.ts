// 대화 상자 (E-2): 주관식 입력 + "말 고르기" 버튼. 규칙은 sim/dialogue, 여기는 화면만 다룬다.
import { t, type StringTable } from '../sim/strings';
import { DialogueState, SceneRunner, type Turn } from '../sim/dialogue/runtime';
import { matchIntent } from '../sim/dialogue/match';
import { CHARACTERS, choiceText, examplesFor, FLAGS, INTENTS, KO } from '../sim/dialogue/data';
import type { Scene } from '../sim/dialogue/types';

const $ = (id: string) => document.getElementById(id)!;

export class TalkUI {
  readonly state = new DialogueState(FLAGS);
  private runner: SceneRunner | null = null;
  private examples: Record<string, string[]>;
  /** 화면에 남은 대사 기록(테스트용: 문장 ID) */
  readonly shown: (string | null)[] = [];

  constructor(private scene: Scene, private S: StringTable, private toast: (id: string, vars?: Record<string, number>) => void) {
    this.examples = examplesFor(scene);
    $('talk-send').textContent = t(S, 'ui.talk.send');
    $('talk-choose').textContent = t(S, 'ui.talk.choose');
    $('talk-close').textContent = t(S, 'ui.talk.close');
    $('talk-rewind').textContent = t(S, 'ui.talk.rewind');
    ($('talk-input') as HTMLInputElement).placeholder = t(S, 'ui.talk.placeholder');
    $('talk-form').addEventListener('submit', (e) => { e.preventDefault(); this.sayTyped(); });
    $('talk-choose').addEventListener('click', () => { $('talk-choices').hidden = !$('talk-choices').hidden; });
    $('talk-close').addEventListener('click', () => this.close());
    $('talk-rewind').addEventListener('click', () => {
      this.state.newLife();
      this.close();
      this.toast('ui.talk.rewound', { life: Number(this.state.get('life')) });
    });
  }

  get isOpen(): boolean { return !$('talk').hidden; }

  open(): void {
    $('talk-log').textContent = '';
    this.shown.length = 0;
    $('talk').hidden = false;
    this.runner = new SceneRunner(this.scene, INTENTS, this.state);
    this.show(this.runner.begin());
    ($('talk-input') as HTMLInputElement).focus();
  }

  close(): void {
    $('talk').hidden = true;
    ($('talk-input') as HTMLInputElement).blur();
    this.runner = null;
  }

  /** 입력한 말 → 임시 매칭기로 의도 하나 (결과는 플레이어에게 숨긴다: docs/08 A안) */
  private sayTyped(): void {
    const input = $('talk-input') as HTMLInputElement;
    const text = input.value.trim();
    if (!this.runner || this.runner.ended) return;
    const ask = this.scene.nodes[this.runner.currentNode].ask!;
    const m = matchIntent(text, this.examples, new Set(this.runner.allowed(ask).keys()));
    input.value = '';
    this.player(text || '…');
    this.show(this.runner.answer(m.intent));
  }

  private choose(intent: string): void {
    if (!this.runner || this.runner.ended) return;
    this.player(choiceText(this.scene, intent));
    this.show(this.runner.answer(intent));
  }

  private player(text: string): void {
    this.line(t(this.S, 'ui.talk.you'), text, 'you');
  }

  private line(who: string, text: string, cls: string): void {
    const p = document.createElement('p');
    p.className = cls;
    const b = document.createElement('b');
    b.textContent = `${who} `;
    p.append(b, text);
    const log = $('talk-log');
    log.append(p);
    log.scrollTop = log.scrollHeight;
  }

  private show(turn: Turn): void {
    for (const l of turn.lines) {
      this.shown.push(l.id);
      const name = CHARACTERS[l.speaker]?.name ?? l.speaker;
      this.line(name, l.id ? KO[l.id]?.text ?? `[${l.id}]` : t(this.S, 'ui.talk.silence'), 'npc');
    }
    const box = $('talk-choices');
    box.textContent = '';
    box.hidden = true;
    for (const id of turn.choices ?? []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = choiceText(this.scene, id);
      b.dataset.intent = id;
      b.addEventListener('click', () => this.choose(id));
      box.append(b);
    }
    ($('talk-form') as HTMLFormElement).hidden = turn.ended;
    if (turn.ended) this.line('', t(this.S, 'ui.talk.ended'), 'sys');
  }

  /** 자동 테스트용 상태 */
  debug() {
    return { open: this.isOpen, node: this.runner?.currentNode ?? null, ended: this.runner?.ended ?? null, shown: [...this.shown],
      life: this.state.get('life'), trust: this.state.trust(this.scene.cast[0]), knows: this.state.get('knows.장로의아들') };
  }
}
