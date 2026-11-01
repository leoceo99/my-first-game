"""PyRun 메인 화면: 코드 편집기 + 실행 결과(셸) + 변수 패널."""

import bisect
import os
import queue
import re
import sys
import tempfile
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from tkinter import font as tkfont

from .highlighter import TAGS, highlight_spans
from .runner import ScriptRunner

APP_NAME = "PyRun"
MOD = "Command" if sys.platform == "darwin" else "Control"
MOD_LABEL = "Cmd" if sys.platform == "darwin" else "Ctrl"
MAX_CONSOLE_LINES = 5000
INDENT = "    "

SAMPLE_CODE = '''# PyRun에 오신 것을 환영해요!
# F5 키 또는 [▶ 실행] 버튼을 눌러 코드를 실행해 보세요.

name = input("이름이 뭐예요? ")
print(f"안녕하세요, {name}님!")

total = 0
for i in range(1, 11):
    total += i
print("1부터 10까지의 합:", total)
'''

COLORS = {
    "bg": "#fdfdfb",
    "fg": "#1f2328",
    "gutter_bg": "#f0f0ec",
    "gutter_fg": "#9a9a92",
    "current_line": "#f3f6fb",
    "comment": "#8a8f98",
    "string": "#2e7d32",
    "keyword": "#7b30d0",
    "builtin": "#0b62c4",
    "number": "#c05800",
    "definition": "#b4235a",
    "decorator": "#a06a00",
    "error_line": "#ffe3e3",
    "console_bg": "#ffffff",
    "stderr": "#c62828",
    "info": "#7a7a7a",
    "input": "#0b62c4",
}

_TRACEBACK_LINE = re.compile(r'File "(.+?)", line (\d+)')


def pick_mono_font(root):
    families = set(tkfont.families(root))
    for name in ("D2Coding", "NanumGothicCoding", "Consolas", "Menlo", "Cascadia Mono", "DejaVu Sans Mono",
                 "Liberation Mono", "Courier New"):
        if name in families:
            return name
    return "TkFixedFont"


def find_error_line(stderr_text, path):
    """오류 메시지에서 실행한 파일의 마지막 오류 줄 번호를 찾습니다."""
    target = os.path.normcase(os.path.abspath(path))
    line = None
    for m in _TRACEBACK_LINE.finditer(stderr_text):
        if os.path.normcase(os.path.abspath(m.group(1))) == target:
            line = int(m.group(2))
    return line


class IndexMapper:
    """파이썬 문자열 위치 → tkinter 'line.col' 위치 변환.

    Tk 8.6은 이모지 같은 문자를 두 칸으로 세기 때문에 그 부분을 보정합니다.
    """

    def __init__(self, text):
        self.text = text
        self.starts = [0] + [m.end() for m in re.finditer("\n", text)]
        self.astral = tk.TkVersion < 8.7 and any(ord(c) > 0xFFFF for c in text)

    def __call__(self, offset):
        row = bisect.bisect_right(self.starts, offset) - 1
        col = offset - self.starts[row]
        if self.astral:
            col = len(self.text[self.starts[row]:offset].encode("utf-16-le")) // 2
        return f"{row + 1}.{col}"


class LineNumbers(tk.Canvas):
    def __init__(self, master, text, font, **kw):
        super().__init__(master, highlightthickness=0, bd=0, bg=COLORS["gutter_bg"], **kw)
        self.text = text
        self.font = font

    def redraw(self):
        self.delete("all")
        digits = len(self.text.index("end-1c").split(".")[0])
        width = self.font.measure("0" * max(3, digits)) + 16
        if int(self.cget("width")) != width:
            self.configure(width=width)
        index = self.text.index("@0,0")
        while True:
            info = self.text.dlineinfo(index)
            if info is None:
                break
            line = index.split(".")[0]
            self.create_text(width - 8, info[1], anchor="ne", text=line,
                             font=self.font, fill=COLORS["gutter_fg"])
            nxt = self.text.index(f"{index}+1line")
            if nxt == index:
                break
            index = nxt


class Editor(ttk.Frame):
    def __init__(self, master, font, on_change):
        super().__init__(master)
        self.font = font
        self.on_change = on_change
        self._highlight_job = None

        self.text = tk.Text(
            self, wrap="none", undo=True, maxundo=-1, font=font,
            bg=COLORS["bg"], fg=COLORS["fg"], insertbackground=COLORS["fg"],
            selectbackground="#cfe3ff", relief="flat", bd=0, padx=6, pady=4,
        )
        self.lines = LineNumbers(self, self.text, font, width=40)
        yscroll = ttk.Scrollbar(self, orient="vertical", command=self.text.yview)
        xscroll = ttk.Scrollbar(self, orient="horizontal", command=self.text.xview)

        def on_yscroll(first, last):
            yscroll.set(first, last)
            self.lines.redraw()

        self.text.configure(yscrollcommand=on_yscroll, xscrollcommand=xscroll.set)
        self.lines.grid(row=0, column=0, sticky="ns")
        self.text.grid(row=0, column=1, sticky="nsew")
        yscroll.grid(row=0, column=2, sticky="ns")
        xscroll.grid(row=1, column=1, sticky="ew")
        self.rowconfigure(0, weight=1)
        self.columnconfigure(1, weight=1)

        self.text.tag_configure("current_line", background=COLORS["current_line"])
        self.text.tag_configure("error_line", background=COLORS["error_line"])
        for tag in TAGS:
            self.text.tag_configure(tag, foreground=COLORS[tag])
        self.text.tag_configure("comment", font=font)
        self.text.tag_raise("sel")

        self.text.bind("<Return>", self._on_return)
        self.text.bind("<Tab>", self._on_tab)
        self.text.bind("<Shift-Tab>", self._on_shift_tab)
        self.text.bind("<ISO_Left_Tab>", self._on_shift_tab)
        self.text.bind("<BackSpace>", self._on_backspace)
        self.text.bind("<<Modified>>", self._on_modified)
        self.text.bind("<KeyRelease>", lambda e: self._update_current_line())
        self.text.bind("<ButtonRelease-1>", lambda e: self._update_current_line())
        self.text.bind("<Configure>", lambda e: self.lines.redraw())

    # ---- 내용 ----
    def get(self):
        return self.text.get("1.0", "end-1c")

    def set(self, content):
        self.text.delete("1.0", "end")
        self.text.insert("1.0", content)
        self.text.edit_reset()
        self.text.edit_modified(False)
        self.text.mark_set("insert", "1.0")
        self.highlight()
        self._update_current_line()

    # ---- 색칠 ----
    def schedule_highlight(self):
        if self._highlight_job is not None:
            self.after_cancel(self._highlight_job)
        self._highlight_job = self.after(120, self.highlight)

    def highlight(self):
        self._highlight_job = None
        content = self.get()
        to_index = IndexMapper(content)
        for tag in TAGS:
            self.text.tag_remove(tag, "1.0", "end")
        for tag, start, end in highlight_spans(content):
            self.text.tag_add(tag, to_index(start), to_index(end))
        self.lines.redraw()

    def _update_current_line(self):
        self.text.tag_remove("current_line", "1.0", "end")
        self.text.tag_add("current_line", "insert linestart", "insert lineend+1c")
        self.text.tag_lower("current_line")

    def mark_error(self, line):
        self.text.tag_remove("error_line", "1.0", "end")
        if line is None:
            return
        self.text.tag_add("error_line", f"{line}.0", f"{line}.0 lineend+1c")
        self.text.see(f"{line}.0")

    def clear_error(self):
        self.text.tag_remove("error_line", "1.0", "end")

    # ---- 편의 기능 ----
    def _on_modified(self, _event):
        if self.text.edit_modified():
            # Tk는 이 표시가 바뀔 때만 알려주므로, 다음 변경도 알 수 있게 바로 되돌립니다.
            self.text.edit_modified(False)
            self.schedule_highlight()
            self.clear_error()
            self.lines.redraw()
            self.on_change()

    def _on_return(self, _event):
        line = self.text.get("insert linestart", "insert")
        indent = re.match(r"[ \t]*", line).group(0)
        stripped = line.rstrip()
        if stripped.endswith(":"):
            indent += INDENT
        elif re.match(r"\s*(return|pass|break|continue|raise)\b", stripped):
            indent = indent[:-len(INDENT)] if indent.endswith(INDENT) else ""
        if self.text.tag_ranges("sel"):
            self.text.delete("sel.first", "sel.last")
        self.text.insert("insert", "\n" + indent)
        self.text.see("insert")
        self._update_current_line()
        return "break"

    def _selected_lines(self):
        if self.text.tag_ranges("sel"):
            first = int(self.text.index("sel.first").split(".")[0])
            last_index = self.text.index("sel.last")
            last = int(last_index.split(".")[0])
            if last_index.endswith(".0") and last > first:
                last -= 1
            return first, last
        return None

    def _on_tab(self, _event):
        lines = self._selected_lines()
        if lines and lines[0] != lines[1]:
            for n in range(lines[0], lines[1] + 1):
                self.text.insert(f"{n}.0", INDENT)
        else:
            self.text.insert("insert", INDENT)
        return "break"

    def _on_shift_tab(self, _event):
        lines = self._selected_lines() or (int(self.text.index("insert").split(".")[0]),) * 2
        for n in range(lines[0], lines[1] + 1):
            head = self.text.get(f"{n}.0", f"{n}.{len(INDENT)}")
            count = len(head) - len(head.lstrip(" "))
            if count:
                self.text.delete(f"{n}.0", f"{n}.{count}")
        return "break"

    def _on_backspace(self, _event):
        if self.text.tag_ranges("sel"):
            return None
        before = self.text.get("insert linestart", "insert")
        if before and before.strip(" ") == "":
            remove = len(before) % len(INDENT) or len(INDENT)
            self.text.delete(f"insert-{remove}c", "insert")
            return "break"
        return None

    def toggle_comment(self):
        lines = self._selected_lines() or (int(self.text.index("insert").split(".")[0]),) * 2
        rows = range(lines[0], lines[1] + 1)
        texts = [self.text.get(f"{n}.0", f"{n}.end") for n in rows]
        uncomment = all(t.lstrip().startswith("#") for t in texts if t.strip())
        for n, t in zip(rows, texts):
            if not t.strip():
                continue
            pos = len(t) - len(t.lstrip())
            if uncomment:
                width = 2 if t[pos:pos + 2] == "# " else 1
                self.text.delete(f"{n}.{pos}", f"{n}.{pos + width}")
            else:
                self.text.insert(f"{n}.{pos}", "# ")


class Console(ttk.Frame):
    """프로그램 출력이 나오고, input()에 답을 입력하는 창."""

    NAV_KEYS = {"Left", "Right", "Up", "Down", "Home", "End", "Prior", "Next",
                "Shift_L", "Shift_R", "Control_L", "Control_R", "Alt_L", "Alt_R",
                "Meta_L", "Meta_R", "Super_L", "Super_R", "Caps_Lock", "Escape"}

    def __init__(self, master, font, on_input):
        super().__init__(master)
        self.on_input = on_input
        self.accepting = False
        self.text = tk.Text(self, wrap="char", font=font, bg=COLORS["console_bg"],
                            fg=COLORS["fg"], relief="flat", bd=0, padx=6, pady=4,
                            insertbackground=COLORS["fg"], undo=False)
        scroll = ttk.Scrollbar(self, orient="vertical", command=self.text.yview)
        self.text.configure(yscrollcommand=scroll.set)
        self.text.grid(row=0, column=0, sticky="nsew")
        scroll.grid(row=0, column=1, sticky="ns")
        self.rowconfigure(0, weight=1)
        self.columnconfigure(0, weight=1)

        self.text.tag_configure("stderr", foreground=COLORS["stderr"])
        self.text.tag_configure("info", foreground=COLORS["info"])
        self.text.tag_configure("input", foreground=COLORS["input"])
        self.text.mark_set("out_end", "end-1c")
        self.text.mark_gravity("out_end", "left")

        self.text.bind("<Key>", self._on_key)
        self.text.bind("<<Paste>>", self._on_paste)
        self.text.bind("<<Cut>>", self._on_cut)

    def clear(self):
        self.text.delete("1.0", "end")
        self.text.mark_set("out_end", "1.0")

    def write(self, content, tag=None):
        # out_end 앞에 출력을 넣어서, 사용자가 입력 중인 글자는 항상 맨 뒤에 남게 합니다.
        self.text.mark_set("_tmp", "out_end")
        self.text.mark_gravity("_tmp", "right")
        self.text.insert("out_end", content, tag or ())
        self.text.mark_set("out_end", "_tmp")
        self.text.mark_unset("_tmp")
        self._trim()
        self.text.see("end")

    def _trim(self):
        lines = int(self.text.index("end-1c").split(".")[0])
        if lines > MAX_CONSOLE_LINES:
            self.text.delete("1.0", f"{lines - MAX_CONSOLE_LINES + 1}.0")

    def set_accepting(self, value):
        self.accepting = value

    def _protected(self, index):
        return self.text.compare(index, "<", "out_end")

    def _move_to_input_area(self):
        if self.text.tag_ranges("sel") and self._protected("sel.first"):
            self.text.tag_remove("sel", "1.0", "end")
        if self._protected("insert"):
            self.text.mark_set("insert", "end-1c")

    def _on_key(self, event):
        if event.keysym in self.NAV_KEYS:
            return None
        if event.state & 0x4 or event.state & 0x8:  # Ctrl / Cmd 조합키(복사 등)는 그대로
            return None
        is_char = bool(event.char) and event.char.isprintable()
        edits = is_char or event.keysym in ("BackSpace", "Delete", "Return", "KP_Enter", "Tab")
        if not edits:
            return None
        if not self.accepting:
            return "break"
        if event.keysym in ("Return", "KP_Enter"):
            self._submit()
            return "break"
        if event.keysym == "BackSpace":
            if self.text.tag_ranges("sel"):
                if self._protected("sel.first"):
                    return "break"
            elif not self.text.compare("insert", ">", "out_end"):
                return "break"
            return None
        if event.keysym == "Delete":
            if self._protected("insert") or (self.text.tag_ranges("sel") and self._protected("sel.first")):
                return "break"
            return None
        self._move_to_input_area()
        return None

    def _on_paste(self, _event):
        if not self.accepting:
            return "break"
        self._move_to_input_area()
        return None

    def _on_cut(self, _event):
        if not self.accepting or (self.text.tag_ranges("sel") and self._protected("sel.first")):
            return "break"
        return None

    def _submit(self):
        line = self.text.get("out_end", "end-1c")
        self.text.tag_add("input", "out_end", "end-1c")
        self.text.insert("end-1c", "\n")
        self.text.mark_set("out_end", "end-1c")
        self.text.mark_set("insert", "end-1c")
        self.text.see("end")
        self.on_input(line + "\n")


class PyRunApp:
    def __init__(self, root, python=None):
        self.root = root
        self.runner = ScriptRunner(python)
        self.path = None
        self.modified = False
        self.run_path = None
        self._stderr = []
        self._restart = False

        root.title(APP_NAME)
        root.geometry("1100x720")
        root.minsize(640, 400)
        style = ttk.Style(root)
        if "clam" in style.theme_names():
            style.theme_use("clam")
        style.configure("Run.TButton", foreground="#1b7a2f")
        style.configure("Stop.TButton", foreground="#b42318")
        style.configure("Treeview", rowheight=22)

        family = pick_mono_font(root)
        self.font = tkfont.Font(root, family=family, size=12) if family != "TkFixedFont" \
            else tkfont.nametofont("TkFixedFont").copy()
        if family == "TkFixedFont":
            self.font.configure(size=12)

        self._build_menu()
        self._build_toolbar()
        self._build_body()
        self._build_statusbar()
        self._bind_keys()

        self.editor.set(SAMPLE_CODE)
        self._set_modified(False)
        self._set_running(False)
        self.editor.text.focus_set()
        root.protocol("WM_DELETE_WINDOW", self.quit)
        root.after(30, self._poll)

    # ---------- 화면 구성 ----------
    def _build_menu(self):
        menu = tk.Menu(self.root)
        file_menu = tk.Menu(menu, tearoff=False)
        file_menu.add_command(label="새 파일", accelerator=f"{MOD_LABEL}+N", command=self.new_file)
        file_menu.add_command(label="열기...", accelerator=f"{MOD_LABEL}+O", command=self.open_file)
        file_menu.add_command(label="저장", accelerator=f"{MOD_LABEL}+S", command=self.save_file)
        file_menu.add_command(label="다른 이름으로 저장...", accelerator=f"{MOD_LABEL}+Shift+S",
                              command=self.save_file_as)
        file_menu.add_separator()
        file_menu.add_command(label="끝내기", command=self.quit)
        menu.add_cascade(label="파일", menu=file_menu)

        edit_menu = tk.Menu(menu, tearoff=False)
        edit_menu.add_command(label="실행 취소", accelerator=f"{MOD_LABEL}+Z",
                              command=lambda: self.editor.text.event_generate("<<Undo>>"))
        edit_menu.add_command(label="다시 실행", accelerator=f"{MOD_LABEL}+Y",
                              command=lambda: self.editor.text.event_generate("<<Redo>>"))
        edit_menu.add_separator()
        edit_menu.add_command(label="주석 넣기/빼기", accelerator=f"{MOD_LABEL}+/",
                              command=self.editor_toggle_comment)
        edit_menu.add_separator()
        edit_menu.add_command(label="글자 크게", accelerator=f"{MOD_LABEL}++",
                              command=lambda: self.zoom(1))
        edit_menu.add_command(label="글자 작게", accelerator=f"{MOD_LABEL}+-",
                              command=lambda: self.zoom(-1))
        menu.add_cascade(label="편집", menu=edit_menu)

        run_menu = tk.Menu(menu, tearoff=False)
        run_menu.add_command(label="실행", accelerator="F5", command=self.run)
        run_menu.add_command(label="중지", accelerator=f"{MOD_LABEL}+F2", command=self.stop)
        menu.add_cascade(label="실행", menu=run_menu)
        self.root.configure(menu=menu)

    def _build_toolbar(self):
        bar = ttk.Frame(self.root, padding=(6, 4))
        bar.pack(side="top", fill="x")
        ttk.Button(bar, text="📄 새 파일", command=self.new_file).pack(side="left", padx=2)
        ttk.Button(bar, text="📂 열기", command=self.open_file).pack(side="left", padx=2)
        ttk.Button(bar, text="💾 저장", command=self.save_file).pack(side="left", padx=2)
        ttk.Separator(bar, orient="vertical").pack(side="left", fill="y", padx=8)
        self.run_button = ttk.Button(bar, text="▶ 실행 (F5)", style="Run.TButton", command=self.run)
        self.run_button.pack(side="left", padx=2)
        self.stop_button = ttk.Button(bar, text="■ 중지", style="Stop.TButton", command=self.stop)
        self.stop_button.pack(side="left", padx=2)

    def _build_body(self):
        vertical = ttk.PanedWindow(self.root, orient="vertical")
        vertical.pack(side="top", fill="both", expand=True)
        horizontal = ttk.PanedWindow(vertical, orient="horizontal")

        self.editor = Editor(horizontal, self.font, on_change=lambda: self._set_modified(True))
        horizontal.add(self.editor, weight=4)

        var_frame = ttk.Frame(horizontal)
        ttk.Label(var_frame, text="변수", padding=(6, 3)).pack(side="top", anchor="w")
        self.variables = ttk.Treeview(var_frame, columns=("type", "value"), show="tree headings")
        self.variables.heading("#0", text="이름")
        self.variables.heading("type", text="타입")
        self.variables.heading("value", text="값")
        self.variables.column("#0", width=90, stretch=False)
        self.variables.column("type", width=60, stretch=False)
        self.variables.column("value", width=140)
        self.variables.pack(side="top", fill="both", expand=True)
        horizontal.add(var_frame, weight=1)

        console_frame = ttk.Frame(vertical)
        ttk.Label(console_frame, text="실행 결과", padding=(6, 3)).pack(side="top", anchor="w")
        self.console = Console(console_frame, self.font, on_input=self._send_input)
        self.console.pack(side="top", fill="both", expand=True)

        vertical.add(horizontal, weight=3)
        vertical.add(console_frame, weight=2)

    def _build_statusbar(self):
        bar = ttk.Frame(self.root, padding=(8, 2))
        bar.pack(side="bottom", fill="x")
        self.status = ttk.Label(bar, text="")
        self.status.pack(side="left")
        self.position = ttk.Label(bar, text="")
        self.position.pack(side="right")
        ttk.Label(bar, text=f"Python {sys.version.split()[0]}   ").pack(side="right")
        self.editor.text.bind("<KeyRelease>", self._update_position, add="+")
        self.editor.text.bind("<ButtonRelease-1>", self._update_position, add="+")

    def _bind_keys(self):
        r = self.root
        r.bind("<F5>", lambda e: self._shortcut(self.run))
        r.bind(f"<{MOD}-F2>", lambda e: self._shortcut(self.stop))
        r.bind(f"<{MOD}-n>", lambda e: self._shortcut(self.new_file))
        r.bind(f"<{MOD}-o>", lambda e: self._shortcut(self.open_file))
        r.bind(f"<{MOD}-s>", lambda e: self._shortcut(self.save_file))
        r.bind(f"<{MOD}-S>", lambda e: self._shortcut(self.save_file_as))
        r.bind(f"<{MOD}-slash>", lambda e: self._shortcut(self.editor_toggle_comment))
        r.bind(f"<{MOD}-equal>", lambda e: self._shortcut(lambda: self.zoom(1)))
        r.bind(f"<{MOD}-plus>", lambda e: self._shortcut(lambda: self.zoom(1)))
        r.bind(f"<{MOD}-minus>", lambda e: self._shortcut(lambda: self.zoom(-1)))
        self.editor.text.bind(f"<{MOD}-y>", lambda e: self._shortcut(
            lambda: self.editor.text.event_generate("<<Redo>>")))

    @staticmethod
    def _shortcut(action):
        action()
        return "break"

    # ---------- 상태 ----------
    def _update_title(self):
        name = os.path.basename(self.path) if self.path else "제목 없음"
        star = "*" if self.modified else ""
        self.root.title(f"{star}{name} - {APP_NAME}")

    def _set_modified(self, value):
        self.modified = value
        if not value:
            self.editor.text.edit_modified(False)
        self._update_title()

    def _set_running(self, running):
        self.stop_button.state(["!disabled"] if running else ["disabled"])
        self.console.set_accepting(running)
        self.status.configure(text="실행 중... (input()이 있으면 아래 창에 입력하세요)" if running else "준비")

    def _update_position(self, _event=None):
        line, col = self.editor.text.index("insert").split(".")
        self.position.configure(text=f"줄 {line}, 칸 {int(col) + 1}")

    def zoom(self, step):
        size = max(8, min(36, self.font.cget("size") + step))
        self.font.configure(size=size)
        self.editor.lines.redraw()

    def editor_toggle_comment(self):
        self.editor.toggle_comment()

    # ---------- 파일 ----------
    def _confirm_discard(self):
        if not self.modified:
            return True
        answer = messagebox.askyesnocancel(APP_NAME, "변경 내용을 저장할까요?", parent=self.root)
        if answer is None:
            return False
        if answer:
            return self.save_file()
        return True

    def new_file(self):
        if not self._confirm_discard():
            return
        self.path = None
        self.editor.set("")
        self._set_modified(False)

    def open_file(self, path=None):
        if not self._confirm_discard():
            return
        if path is None:
            path = filedialog.askopenfilename(
                parent=self.root, filetypes=[("파이썬 파일", "*.py"), ("모든 파일", "*.*")])
        if not path:
            return
        try:
            with open(path, encoding="utf-8") as f:
                content = f.read()
        except (OSError, UnicodeDecodeError) as exc:
            messagebox.showerror(APP_NAME, f"파일을 열 수 없어요.\n{exc}", parent=self.root)
            return
        self.path = os.path.abspath(path)
        self.editor.set(content)
        self._set_modified(False)

    def save_file(self):
        if self.path is None:
            return self.save_file_as()
        return self._write(self.path)

    def save_file_as(self):
        path = filedialog.asksaveasfilename(
            parent=self.root, defaultextension=".py",
            filetypes=[("파이썬 파일", "*.py"), ("모든 파일", "*.*")])
        if not path:
            return False
        self.path = os.path.abspath(path)
        return self._write(self.path)

    def _write(self, path):
        try:
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(self.editor.get())
        except OSError as exc:
            messagebox.showerror(APP_NAME, f"저장하지 못했어요.\n{exc}", parent=self.root)
            return False
        self._set_modified(False)
        self.status.configure(text=f"저장됨: {path}")
        return True

    # ---------- 실행 ----------
    def _file_to_run(self):
        if self.path:
            if self.modified and not self._write(self.path):
                return None
            return self.path
        folder = os.path.join(tempfile.gettempdir(), "pyrun")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "untitled.py")
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(self.editor.get())
        return path

    def run(self):
        if self.runner.active:
            self._restart = True
            self.runner.stop()
            return
        path = self._file_to_run()
        if path is None:
            return
        self.run_path = path
        self._stderr = []
        self.editor.clear_error()
        self.variables.delete(*self.variables.get_children())
        self.console.clear()
        name = os.path.basename(self.path) if self.path else "제목 없음"
        self.console.write(f"▶ {name} 실행\n", "info")
        try:
            self.runner.start(path)
        except OSError as exc:
            self.console.write(f"실행할 수 없어요: {exc}\n", "stderr")
            return
        self._set_running(True)
        self.console.text.focus_set()

    def stop(self):
        self._restart = False
        self.runner.stop()

    def _send_input(self, line):
        self.runner.send_input(line)

    def _poll(self):
        pending = []  # 같은 종류의 출력은 묶어서 한 번에 화면에 씁니다.
        try:
            for _ in range(500):
                event = self.runner.events.get_nowait()
                if event[0] in ("stdout", "stderr") and pending and pending[-1][0] == event[0]:
                    pending[-1] = (event[0], pending[-1][1] + event[1])
                else:
                    pending.append(event)
        except queue.Empty:
            pass
        for event in pending:
            kind = event[0]
            if kind == "stdout":
                self.console.write(event[1])
            elif kind == "stderr":
                self._stderr.append(event[1])
                self.console.write(event[1], "stderr")
            elif kind == "exit":
                self._on_exit(event[1], event[2])
        self.root.after(30, self._poll)

    def _on_exit(self, code, variables):
        self._set_running(False)
        if self.runner.stopped_by_user:
            self.console.write("\n■ 중지되었어요.\n", "info")
        else:
            self.console.write(f"\n■ 프로그램이 끝났어요 (종료 코드 {code})\n", "info")
        for var in variables:
            self.variables.insert("", "end", text=var["name"], values=(var["type"], var["value"]))
        if code != 0 and not self.runner.stopped_by_user:
            line = find_error_line("".join(self._stderr), self.run_path)
            if line is not None:
                self.editor.mark_error(line)
                self.status.configure(text=f"{line}번째 줄에서 오류가 났어요")
        if self._restart:
            self._restart = False
            self.root.after(10, self.run)

    def quit(self):
        if not self._confirm_discard():
            return
        self.runner.stop()
        self.root.destroy()


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    root = tk.Tk()
    app = PyRunApp(root)
    if argv:
        app.open_file(argv[0])
    root.mainloop()
