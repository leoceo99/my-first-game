"""사용자 코드를 별도 프로세스에서 실행하고 출력을 실시간으로 전달합니다.

화면(tkinter)과 분리되어 있어서 GUI 없이도 테스트할 수 있어요.
모든 결과는 `events` 큐에 다음 형태로 들어옵니다.
    ("stdout", 텍스트)
    ("stderr", 텍스트)
    ("exit", 종료 코드, 변수 목록)
"""

import codecs
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading

BOOTSTRAP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_bootstrap.py")


class ScriptRunner:
    def __init__(self, python=None):
        self.python = python or sys.executable
        self.events = queue.Queue()
        self._proc = None
        self._active = False
        self.stopped_by_user = False

    @property
    def active(self):
        """프로그램이 실행 중이면 True (출력이 모두 전달되고 'exit'가 올 때까지)."""
        return self._active

    def start(self, path):
        if self._active:
            raise RuntimeError("이미 실행 중인 프로그램이 있어요.")
        path = os.path.abspath(path)
        fd, var_file = tempfile.mkstemp(prefix="pyrun_vars_", suffix=".json")
        os.close(fd)

        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUNBUFFERED"] = "1"
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0

        self._proc = subprocess.Popen(
            [self.python, "-u", BOOTSTRAP, path, var_file],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=os.path.dirname(path),
            env=env,
            creationflags=flags,
        )
        self._active = True
        self.stopped_by_user = False

        readers = [
            threading.Thread(target=self._read, args=(self._proc.stdout, "stdout"), daemon=True),
            threading.Thread(target=self._read, args=(self._proc.stderr, "stderr"), daemon=True),
        ]
        for t in readers:
            t.start()
        threading.Thread(
            target=self._wait, args=(self._proc, readers, var_file), daemon=True
        ).start()

    def _read(self, stream, kind):
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
        while True:
            chunk = stream.read1(4096)
            if not chunk:
                break
            text = decoder.decode(chunk)
            if text:
                self.events.put((kind, text.replace("\r\n", "\n")))
        rest = decoder.decode(b"", final=True)
        if rest:
            self.events.put((kind, rest))

    def _wait(self, proc, readers, var_file):
        for t in readers:
            t.join()
        code = proc.wait()
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            try:
                stream.close()
            except (OSError, ValueError):
                pass
        variables = []
        try:
            with open(var_file, encoding="utf-8") as f:
                variables = json.load(f)
        except (OSError, ValueError):
            pass
        try:
            os.remove(var_file)
        except OSError:
            pass
        self._active = False
        self.events.put(("exit", code, variables))

    def send_input(self, text):
        """실행 중인 프로그램의 input()에 텍스트를 보냅니다."""
        proc = self._proc
        if not self._active or proc is None or proc.stdin is None:
            return False
        try:
            proc.stdin.write(text.encode("utf-8"))
            proc.stdin.flush()
            return True
        except (BrokenPipeError, OSError, ValueError):
            return False

    def stop(self):
        proc = self._proc
        if not self._active or proc is None or proc.poll() is not None:
            return
        self.stopped_by_user = True
        proc.terminate()

        def force_kill():
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()

        threading.Thread(target=force_kill, daemon=True).start()
