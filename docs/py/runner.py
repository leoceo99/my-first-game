"""파이브릿지가 사용자 코드를 실행하는 파이썬 쪽 코드.

브라우저 안의 Pyodide에서 실행되지만, 보통 파이썬(CPython)에서도 그대로
돌아가서 테스트할 수 있어요. 화면과는 `bridge` 객체 하나로만 이야기합니다.

    bridge.post_output(stream, text)   # "stdout" 또는 "stderr" 출력 보내기
    bridge.post_input_request(prompt)  # input()이 답을 기다린다고 알리기
    bridge.wait_for_input(prompt)      # 답이 올 때까지 기다렸다가 돌려받기

input()을 처리하는 방법은 두 가지예요.
- "block": 답이 올 때까지 실제로 기다립니다 (서비스 워커가 있을 때).
- "replay": 답이 필요하면 실행을 멈췄다가, 지금까지 받은 답을 모두 넣어
  처음부터 다시 실행합니다. 이미 화면에 나온 출력은 다시 보내지 않아요.
  random은 같은 씨앗(seed)으로 시작하므로 다시 실행해도 같은 숫자가 나와요.
"""

import builtins
import inspect
import io
import json
import os
import random
import re
import shutil
import sys
import tempfile
import time
import traceback
import types

FILENAME = "main.py"
_SUGGESTION = re.compile(r"Did you mean:? '?([^'?]+)'?\?")


class _NeedInput(BaseException):
    """replay 방식에서 답을 받으려고 실행을 멈출 때 쓰는 신호."""


class _Stream:
    """print() 출력을 모았다가 조금씩 화면으로 보내는 통로."""

    encoding = "utf-8"
    errors = "strict"

    def __init__(self, bridge, name):
        self._bridge = bridge
        self._name = name
        self._parts = []
        self._size = 0
        self._last = time.monotonic()
        self.muted = False

    def write(self, text):
        if not isinstance(text, str):
            raise TypeError(f"write() argument must be str, not {type(text).__name__}")
        if text and not self.muted:
            self._parts.append(text)
            self._size += len(text)
            if self._size >= 4096 or time.monotonic() - self._last >= 0.05:
                self.flush()
        return len(text)

    def flush(self):
        if self._parts:
            self._bridge.post_output(self._name, "".join(self._parts))
            self._parts.clear()
            self._size = 0
        self._last = time.monotonic()

    def writelines(self, lines):
        for line in lines:
            self.write(line)

    def isatty(self):
        return False

    def writable(self):
        return True

    def readable(self):
        return False


def _describe_error(exc):
    tb = exc.__traceback__
    # 실행 도구(이 파일) 쪽 줄은 건너뛰고 사용자 코드부터 보여줍니다.
    while tb is not None and tb.tb_frame.f_code.co_filename != FILENAME:
        tb = tb.tb_next
    text = "".join(traceback.format_exception(type(exc), exc, tb))

    line = None
    if isinstance(exc, SyntaxError) and exc.filename == FILENAME:
        line = exc.lineno
    walker = tb
    while walker is not None:
        if walker.tb_frame.f_code.co_filename == FILENAME:
            line = walker.tb_lineno
        walker = walker.tb_next

    message = exc.msg if isinstance(exc, SyntaxError) else str(exc)
    last_line = text.rstrip().splitlines()[-1] if text.strip() else ""
    match = _SUGGESTION.search(last_line)
    return {
        "type": type(exc).__name__,
        "message": message,
        "line": line,
        "suggestion": match.group(1) if match else None,
        "traceback": text,
    }


def _short_repr(value):
    if isinstance(value, types.FunctionType):
        try:
            return f"def {value.__name__}{inspect.signature(value)}"
        except (TypeError, ValueError):
            return f"def {value.__name__}(...)"
    if isinstance(value, type):
        return f"class {value.__name__}"
    try:
        text = repr(value)
    except Exception as exc:  # 사용자가 만든 __repr__가 오류를 낼 수도 있어요
        text = f"<값을 보여줄 수 없어요: {type(exc).__name__}>"
    return text if len(text) <= 300 else text[:297] + "..."


def _variables(namespace):
    result = []
    for name, value in namespace.items():
        if name.startswith("__") or isinstance(value, types.ModuleType):
            continue
        kind = "function" if isinstance(value, types.FunctionType) else (
            "class" if isinstance(value, type) else type(value).__name__)
        result.append({"name": name, "type": kind, "value": _short_repr(value)})
    return result


# ---------- asyncio: 브라우저 파이썬에서도 asyncio.run()이 되게 ----------
_ASYNC_READY = False


def _install_asyncio():
    """Pyodide의 기본 이벤트 루프는 동기 코드 안에서 기다릴 수 없어요.
    그래서 asyncio.run()과 새 이벤트 루프가 '그냥 차례대로 도는' 루프를 쓰게 바꿔요."""
    global _ASYNC_READY
    if _ASYNC_READY:
        return
    import asyncio

    class _NoSelector:
        def select(self, timeout=None):
            if timeout and timeout > 0:
                time.sleep(timeout)
            return []

        def close(self):
            pass

        def get_map(self):
            return {}

    class _SyncLoop(asyncio.BaseEventLoop):
        def __init__(self):
            super().__init__()
            self._selector = _NoSelector()

        def _process_events(self, event_list):
            pass

        def _write_to_self(self):
            pass

    def run_sync(main, *, debug=None, loop_factory=None):
        loop = (loop_factory or _SyncLoop)()
        if debug is not None:
            loop.set_debug(debug)
        # Pyodide는 자기 루프가 항상 '돌고 있다'고 표시해 둬서, 잠깐 표시를 치워요
        outer = asyncio.events._get_running_loop()
        asyncio.events._set_running_loop(None)
        try:
            asyncio.set_event_loop(loop)
            return loop.run_until_complete(main)
        finally:
            try:
                tasks = [t for t in asyncio.all_tasks(loop) if not t.done()]
                for t in tasks:
                    t.cancel()
                if tasks:
                    loop.run_until_complete(asyncio.gather(*tasks, return_exceptions=True))
                loop.run_until_complete(loop.shutdown_asyncgens())
            finally:
                asyncio.set_event_loop(None)
                loop.close()
                asyncio.events._set_running_loop(outer)

    asyncio.run = run_sync
    asyncio.new_event_loop = _SyncLoop
    _ASYNC_READY = True


# ---------- 파일: C와 함께 쓰는 가상 파일들 ----------
WORK_DIR = os.path.join(tempfile.gettempdir(), "pybridge_work")


def _prepare_files(files):
    """실행할 때마다 작업 폴더를 저장된 파일들로 새로 채워요 (다시 실행해도 두 번 써지지 않게)."""
    shutil.rmtree(WORK_DIR, ignore_errors=True)
    os.makedirs(WORK_DIR, exist_ok=True)
    for name, text in files.items():
        path = os.path.join(WORK_DIR, name)
        os.makedirs(os.path.dirname(path) or WORK_DIR, exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(text)


def _collect_files():
    found = {}
    for root, _dirs, names in os.walk(WORK_DIR):
        for name in names:
            path = os.path.join(root, name)
            rel = os.path.relpath(path, WORK_DIR).replace(os.sep, "/")
            if rel == FILENAME:
                continue
            with open(path, "rb") as f:
                found[rel] = f.read().decode("utf-8", errors="replace")
    return found


class _Stdin(io.TextIOBase):
    """sys.stdin.readline() 같은 읽기도 input()과 같은 말풍선으로 받아요."""

    def __init__(self, ask):
        self._ask = ask

    def readable(self):
        return True

    def readline(self, size=-1):
        value = self._ask("")
        return "" if value is None else value + "\n"

    def read(self, size=-1):
        lines = []
        while True:
            line = self.readline()
            if not line:
                return "".join(lines)
            lines.append(line)

    def readlines(self, hint=-1):
        return self.read().splitlines(keepends=True)

    def __iter__(self):
        return self

    def __next__(self):
        line = self.readline()
        if not line:
            raise StopIteration
        return line


def run(code, answers_json, seed, mode, bridge, files_json="{}"):
    """사용자 코드를 실행하고 결과를 JSON 문자열로 돌려줍니다.

    status: "ok" 정상 종료 / "exit" sys.exit() / "error" 오류 /
            "waiting" (replay 방식에서) 답을 기다리느라 멈춤
    """
    answers = list(json.loads(answers_json))
    out = _Stream(bridge, "stdout")
    err = _Stream(bridge, "stderr")
    # replay 방식에서 이미 받은 답이 있으면, 그 답을 다 쓸 때까지는 이미 본 출력이에요.
    out.muted = err.muted = bool(answers) and mode == "replay"

    def ask(prompt):
        """답 하나를 받아요. 입력 끝(EOF)이면 None."""
        out.flush()
        err.flush()
        prompt = str(prompt)
        if mode == "replay":
            if answers:
                value = answers.pop(0)
                if not answers:
                    out.muted = err.muted = False
                return value
            bridge.post_input_request(prompt)
            out.muted = err.muted = True
            raise _NeedInput()
        value = bridge.wait_for_input(prompt)
        return None if value is None else str(value)

    def patched_input(prompt=""):
        value = ask(prompt)
        if value is None:  # 화면에서 "입력 끝(EOF)"을 보냈어요
            raise EOFError("EOF when reading a line")
        return value

    if "asyncio" in code:
        _install_asyncio()
    saved = (sys.stdout, sys.stderr, sys.stdin, builtins.input, sys.argv, os.getcwd())
    _prepare_files(json.loads(files_json))
    modules_before = set(sys.modules)
    namespace = {"__name__": "__main__", "__file__": FILENAME, "__builtins__": builtins}
    status, error, exit_code = "ok", None, 0
    started = time.perf_counter()

    sys.stdout, sys.stderr, sys.stdin, builtins.input, sys.argv = out, err, _Stdin(ask), patched_input, [FILENAME]
    os.chdir(WORK_DIR)
    random.seed(seed)
    try:
        exec(compile(code, FILENAME, "exec"), namespace)
    except _NeedInput:
        status = "waiting"
    except SystemExit as exc:
        status = "exit"
        if exc.code is None:
            exit_code = 0
        elif isinstance(exc.code, int):
            exit_code = exc.code
        else:
            err.muted = False
            err.write(f"{exc.code}\n")
            exit_code = 1
    except BaseException as exc:
        status = "error"
        error = _describe_error(exc)
    finally:
        out.flush()
        err.flush()
        sys.stdout, sys.stderr, sys.stdin, builtins.input, sys.argv = saved[:5]
        os.chdir(saved[5])
        # 사용자 코드가 불러온 모듈은 지워서, 다음 실행이 깨끗하게 시작하게 해요.
        for name in set(sys.modules) - modules_before:
            sys.modules.pop(name, None)

    return json.dumps({
        "status": status,
        "error": error,
        "exitCode": exit_code,
        "seconds": round(time.perf_counter() - started, 3),
        "variables": [] if status == "waiting" else _variables(namespace),
        "files": None if status == "waiting" else _collect_files(),
    }, ensure_ascii=False)
