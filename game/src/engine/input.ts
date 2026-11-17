import type { MoveInput } from '../sim/player';

/** 키보드(WASD·방향키·Shift) + 마우스 끌기/포인터 잠금 + 터치(왼쪽 반=이동, 오른쪽 반=시점). */
export class Input {
  private keys = new Set<string>();
  lookDX = 0;
  lookDY = 0;
  private touchMove: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  private touchLook: { id: number; x: number; y: number } | null = null;
  private dragging = false;
  onToggleCamera: () => void = () => {};
  onSave: () => void = () => {};
  onLoad: () => void = () => {};
  onJump: () => void = () => {};
  onAttack: (id: string) => void = () => {};
  onToggleSword: () => void = () => {};
  /** 첫 입력 때 한 번 (소리 켜기용) */
  onFirstInput: () => void = () => {};

  constructor(private el: HTMLElement) {
    const first = () => this.onFirstInput();
    window.addEventListener('pointerdown', first);
    window.addEventListener('touchstart', first, { passive: true });
    window.addEventListener('keydown', (e) => {
      first();
      if (e.code === 'Space') e.preventDefault();
      if (e.repeat) return this.keys.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'Space') this.onJump();
      if (e.code === 'Digit1') this.onAttack('oberhau');
      if (e.code === 'Digit2') this.onAttack('mittelhau');
      if (e.code === 'Digit3') this.onAttack('unterhau');
      if (e.code === 'KeyR') this.onToggleSword();
      if (e.code === 'KeyV') this.onToggleCamera();
      if (e.code === 'F5' || e.code === 'KeyK') { e.preventDefault(); this.onSave(); }
      if (e.code === 'F9' || e.code === 'KeyL') { e.preventDefault(); this.onLoad(); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    el.addEventListener('mousedown', () => { this.dragging = true; });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    el.addEventListener('dblclick', () => { el.requestPointerLock?.()?.catch?.(() => {}); });
    window.addEventListener('mousemove', (e) => {
      if (this.dragging || document.pointerLockElement === el) { this.lookDX += e.movementX; this.lookDY += e.movementY; }
    });

    el.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < window.innerWidth / 2 && !this.touchMove)
          this.touchMove = { id: t.identifier, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY };
        else if (!this.touchLook) this.touchLook = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (this.touchMove?.id === t.identifier) { this.touchMove.x = t.clientX; this.touchMove.y = t.clientY; }
        if (this.touchLook?.id === t.identifier) {
          this.lookDX += (t.clientX - this.touchLook.x) * 1.5;
          this.lookDY += (t.clientY - this.touchLook.y) * 1.5;
          this.touchLook.x = t.clientX; this.touchLook.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (this.touchMove?.id === t.identifier) this.touchMove = null;
        if (this.touchLook?.id === t.identifier) this.touchLook = null;
      }
    };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  move(): MoveInput {
    const k = (c: string) => (this.keys.has(c) ? 1 : 0);
    let forward = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown');
    let strafe = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft');
    let run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (this.touchMove) {
      const dx = (this.touchMove.x - this.touchMove.x0) / 60;
      const dy = (this.touchMove.y - this.touchMove.y0) / 60;
      strafe = Math.max(-1, Math.min(1, dx));
      forward = Math.max(-1, Math.min(1, -dy));
      run = Math.hypot(dx, dy) > 1.6;
    }
    return { forward, strafe, run };
  }

  consumeLook(): [number, number] {
    const r: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = this.lookDY = 0;
    return r;
  }
}
