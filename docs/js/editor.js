// 아이패드에서도 잘 동작하는 코드 편집기.
//
// 글자 입력은 브라우저 기본 <textarea>가 맡고(그래서 한글 입력, 복사/붙여넣기,
// 되돌리기가 아이패드 그대로 동작해요), 그 뒤에 색칠된 코드를 겹쳐 보여줘요.

import { highlightFor } from "./highlight.js";

const INDENT = "    ";
// 아이패드의 '스마트 구두점'이 바꾼 글자를 파이썬이 이해하는 글자로 되돌려요.
const SMART = { "“": '"', "”": '"', "„": '"', "‘": "'", "’": "'", "—": "--", "…": "..." };
const SMART_RE = /[“”„‘’—…]/g;
const HAS_SMART = /[“”„‘’—…]/;

export class CodeEditor {
  constructor(root, handlers = {}) {
    this.handlers = handlers;
    this.composing = false;
    this.lineCount = 0;
    this.errorLine = null;
    this.lang = "python";
    root.classList.add("ed");
    root.innerHTML = `
      <div class="ed-gutter" aria-hidden="true"><div class="ed-gutter-inner"><div class="ed-gutter-mark" hidden></div><pre class="ed-lines"></pre></div></div>
      <div class="ed-body">
        <div class="ed-layer" aria-hidden="true"><div class="ed-errline" hidden></div><pre class="ed-highlight"></pre></div>
        <textarea class="ed-input" id="code-input" aria-label="파이썬 코드" wrap="off"
          spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off"
          data-gramm="false"></textarea>
      </div>`;
    this.ta = root.querySelector(".ed-input");
    this.hl = root.querySelector(".ed-highlight");
    this.layer = root.querySelector(".ed-layer");
    this.lines = root.querySelector(".ed-gutter-inner");
    this.linesPre = root.querySelector(".ed-lines");
    this.errline = root.querySelector(".ed-errline");
    this.gutterMark = root.querySelector(".ed-gutter-mark");

    const ta = this.ta;
    ta.addEventListener("input", (e) => this.onInput(e));
    ta.addEventListener("scroll", () => this.syncScroll(), { passive: true });
    ta.addEventListener("keydown", (e) => this.onKeyDown(e));
    ta.addEventListener("beforeinput", (e) => this.onBeforeInput(e));
    ta.addEventListener("compositionstart", () => { this.composing = true; });
    ta.addEventListener("compositionend", () => { this.composing = false; this.fixSmartPunctuation(); });
  }

  get value() {
    return this.ta.value;
  }

  set value(code) {
    this.ta.value = code;
    this.ta.setSelectionRange(0, 0);
    this.ta.scrollTop = 0;
    this.ta.scrollLeft = 0;
    this.clearError();
    this.render();
  }

  focus() {
    this.ta.focus({ preventScroll: true });
  }

  /** 언어를 바꿔요 ("python" 또는 "c"). 색칠, 자동 들여쓰기, 주석 기호가 바뀌어요. */
  setLanguage(lang) {
    this.lang = lang;
    this.ta.setAttribute("aria-label", lang === "c" ? "C 코드" : "파이썬 코드");
    this.render();
  }

  // ---------- 그리기 ----------
  render() {
    const code = this.ta.value;
    // 마지막 줄이 비어 있어도 높이가 맞도록 줄바꿈을 하나 더 붙여요.
    this.hl.innerHTML = highlightFor(this.lang, code) + "\n";
    const count = code.split("\n").length;
    if (count !== this.lineCount) {
      this.lineCount = count;
      let text = "";
      for (let i = 1; i <= count; i++) text += i + "\n";
      this.linesPre.textContent = text;
    }
    this.syncScroll();
  }

  syncScroll() {
    const { scrollTop, scrollLeft } = this.ta;
    this.layer.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
    this.lines.style.transform = `translateY(${-scrollTop}px)`;
  }

  lineHeight() {
    return parseFloat(getComputedStyle(this.ta).lineHeight) || 24;
  }

  // ---------- 오류 줄 표시 ----------
  markError(line) {
    this.errorLine = line;
    if (!line) return this.clearError();
    const top = `calc(var(--ed-pad-y) + ${(line - 1) * this.lineHeight()}px)`;
    for (const el of [this.errline, this.gutterMark]) {
      el.style.top = top;
      el.hidden = false;
    }
    this.goToLine(line);
  }

  clearError() {
    this.errorLine = null;
    this.errline.hidden = true;
    this.gutterMark.hidden = true;
  }

  goToLine(line) {
    const target = (line - 1) * this.lineHeight() - this.ta.clientHeight / 3;
    this.ta.scrollTop = Math.max(0, target);
    this.ta.scrollLeft = 0;
    this.syncScroll();
  }

  // ---------- 입력 처리 ----------
  onInput() {
    if (!this.composing) this.fixSmartPunctuation();
    if (this.errorLine) this.clearError();
    this.render();
    this.handlers.onChange?.(this.ta.value);
  }

  onBeforeInput(e) {
    if (e.inputType === "insertText" && e.data && HAS_SMART.test(e.data)) {
      e.preventDefault();
      this.insertText(e.data.replace(SMART_RE, (c) => SMART[c]));
    }
  }

  fixSmartPunctuation() {
    const ta = this.ta;
    if (ta.selectionStart !== ta.selectionEnd) return;
    const pos = ta.selectionStart;
    const start = Math.max(0, pos - 3);
    const recent = ta.value.slice(start, pos);
    if (!HAS_SMART.test(recent)) return;
    ta.setSelectionRange(start, pos);
    this.insertText(recent.replace(SMART_RE, (c) => SMART[c]));
  }

  onKeyDown(e) {
    if (this.composing || e.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      this.handlers.onRunShortcut?.();
    } else if (mod && e.key === "/") {
      e.preventDefault();
      this.toggleComment();
    } else if (e.key === "Tab" && !mod && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) this.outdent();
      else this.indent();
    } else if (e.key === "Enter" && !mod && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      this.newline();
    } else if (e.key === "Backspace" && !mod && !e.altKey) {
      if (this.smartBackspace()) e.preventDefault();
    } else if (e.key === "}" && this.lang === "c" && !mod) {
      if (this.closeBrace()) e.preventDefault();
    }
  }

  /** C: 빈 줄에서 } 를 치면 한 단계 내어 써요. */
  closeBrace() {
    const ta = this.ta;
    if (ta.selectionStart !== ta.selectionEnd) return false;
    const s = ta.selectionStart;
    const lineStart = ta.value.lastIndexOf("\n", s - 1) + 1;
    const before = ta.value.slice(lineStart, s);
    if (!before || /[^ ]/.test(before)) return false;
    const keep = Math.max(0, before.length - INDENT.length);
    ta.setSelectionRange(lineStart, s);
    this.insertText(" ".repeat(keep) + "}");
    return true;
  }

  /** 커서 위치에 글자를 넣어요. 아이패드의 되돌리기 기록도 함께 남아요. */
  insertText(text) {
    const ta = this.ta;
    if (document.activeElement !== ta) ta.focus({ preventScroll: true });
    let ok = false;
    try {
      ok = text === "" ? document.execCommand("delete") : document.execCommand("insertText", false, text);
    } catch {
      ok = false;
    }
    if (!ok) {
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  /** 여는 기호와 닫는 기호를 함께 넣고 커서를 그 사이에 둬요. 선택한 글자가 있으면 감싸요. */
  insertPair(open, close) {
    const ta = this.ta;
    const { selectionStart: s, selectionEnd: e } = ta;
    const selected = ta.value.slice(s, e);
    this.insertText(open + selected + close);
    const caret = s + open.length + selected.length;
    ta.setSelectionRange(selected ? s + open.length : caret, caret);
  }

  /** 기호 버튼: 다음 글자가 이미 같은 닫는 기호면 넘어가기만 해요. */
  typeSymbol(symbol) {
    const ta = this.ta;
    if (ta.selectionStart === ta.selectionEnd && ")]}".includes(symbol) &&
        ta.value[ta.selectionStart] === symbol) {
      this.moveCaret(1);
      return;
    }
    this.insertText(symbol);
  }

  moveCaret(delta) {
    const ta = this.ta;
    if (document.activeElement !== ta) ta.focus({ preventScroll: true });
    const pos = Math.min(ta.value.length, Math.max(0, (delta < 0 ? ta.selectionStart : ta.selectionEnd) + delta));
    ta.setSelectionRange(pos, pos);
  }

  undo() {
    this.focus();
    document.execCommand("undo");
  }

  redo() {
    this.focus();
    document.execCommand("redo");
  }

  newline() {
    const ta = this.ta;
    const v = ta.value;
    const s = ta.selectionStart;
    const lineStart = v.lastIndexOf("\n", s - 1) + 1;
    const before = v.slice(lineStart, s);
    let indent = before.match(/^[ \t]*/)[0];
    const trimmed = before.trimEnd();
    if (this.lang === "c") {
      if (trimmed.endsWith("{")) {
        // { 와 } 사이에서 엔터를 치면 } 를 다음 줄로 내리고 가운데 줄로 들어가요.
        if (v[s] === "}") {
          this.insertText("\n" + indent + INDENT + "\n" + indent);
          const caret = s + 1 + indent.length + INDENT.length;
          ta.setSelectionRange(caret, caret);
          return;
        }
        indent += INDENT;
      }
      this.insertText("\n" + indent);
      return;
    }
    if (trimmed.endsWith(":")) indent += INDENT;
    else if (/^\s*(return|pass|break|continue|raise)\b/.test(trimmed)) {
      indent = indent.slice(0, Math.max(0, indent.length - INDENT.length));
    }
    this.insertText("\n" + indent);
  }

  selectedLines() {
    const ta = this.ta;
    const v = ta.value;
    const s = ta.selectionStart;
    let e = ta.selectionEnd;
    if (e > s && v[e - 1] === "\n") e -= 1;
    const start = v.lastIndexOf("\n", s - 1) + 1;
    let end = v.indexOf("\n", e);
    if (end < 0) end = v.length;
    return [start, end];
  }

  replaceLines(transform) {
    const ta = this.ta;
    const [start, end] = this.selectedLines();
    const { selectionStart: s, selectionEnd: e } = ta;
    const block = ta.value.slice(start, end);
    const lines = block.split("\n");
    const changed = lines.map(transform);
    const result = changed.join("\n");
    if (result === block) return;
    ta.setSelectionRange(start, end);
    this.insertText(result);
    if (s === e) {
      const shift = changed[0].length - lines[0].length;
      const caret = Math.max(start, s + shift);
      ta.setSelectionRange(caret, caret);
    } else {
      ta.setSelectionRange(start, start + result.length);
    }
  }

  indent() {
    const ta = this.ta;
    const multiLine = ta.value.slice(ta.selectionStart, ta.selectionEnd).includes("\n");
    if (!multiLine) {
      this.insertText(INDENT);
      return;
    }
    this.replaceLines((line) => (line.trim() ? INDENT + line : line));
  }

  outdent() {
    this.replaceLines((line) => line.replace(/^(?: {1,4}|\t)/, ""));
  }

  toggleComment() {
    const [start, end] = this.selectedLines();
    const lines = this.ta.value.slice(start, end).split("\n");
    const filled = lines.filter((l) => l.trim());
    const mark = this.lang === "c" ? "//" : "#";
    const uncomment = filled.length > 0 && filled.every((l) => l.trimStart().startsWith(mark));
    const strip = new RegExp(`^${mark} ?`);
    this.replaceLines((line) => {
      if (!line.trim()) return line;
      const pad = line.match(/^\s*/)[0];
      const rest = line.slice(pad.length);
      if (uncomment) return pad + rest.replace(strip, "");
      return `${pad}${mark} ${rest}`;
    });
  }

  smartBackspace() {
    const ta = this.ta;
    if (ta.selectionStart !== ta.selectionEnd) return false;
    const s = ta.selectionStart;
    const lineStart = ta.value.lastIndexOf("\n", s - 1) + 1;
    const before = ta.value.slice(lineStart, s);
    if (!before || /[^ ]/.test(before)) return false;
    const remove = before.length % INDENT.length || INDENT.length;
    ta.setSelectionRange(s - remove, s);
    this.insertText("");
    return true;
  }
}
