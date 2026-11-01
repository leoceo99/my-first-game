"""PyRun이 사용자 코드를 실행할 때 쓰는 시작 스크립트.

별도의 자식 프로세스에서 실행되며, 사용 방법은
    python _bootstrap.py <실행할 파일> <변수 정보를 저장할 json 파일>
입니다. 코드가 끝나면(오류로 끝나도) 전역 변수 목록을 json으로 남겨서
PyRun의 '변수' 패널에 보여줄 수 있게 합니다.
"""

import builtins
import json
import os
import sys
import traceback
import types

_THIS_FILE = os.path.abspath(__file__)


def _describe(namespace):
    result = []
    for name, value in namespace.items():
        if name.startswith("__") or isinstance(value, types.ModuleType):
            continue
        try:
            text = repr(value)
        except Exception as exc:  # 사용자가 만든 이상한 __repr__ 대비
            text = f"<repr 오류: {exc!r}>"
        if len(text) > 200:
            text = text[:197] + "..."
        result.append({"name": name, "type": type(value).__name__, "value": text})
    return result


def main():
    target, var_file = sys.argv[1], sys.argv[2]
    target = os.path.abspath(target)
    sys.argv = [target]
    sys.path[0] = os.path.dirname(target)

    namespace = {"__name__": "__main__", "__file__": target, "__builtins__": builtins}
    exit_code = 0
    try:
        with open(target, encoding="utf-8") as f:
            source = f.read()
        exec(compile(source, target, "exec"), namespace)
    except SystemExit as exc:
        if exc.code is None:
            exit_code = 0
        elif isinstance(exc.code, int):
            exit_code = exc.code
        else:
            print(exc.code, file=sys.stderr)
            exit_code = 1
    except BaseException as exc:
        # 이 시작 스크립트 자체의 줄은 오류 메시지에서 숨깁니다.
        tb = exc.__traceback__
        while tb is not None and os.path.abspath(tb.tb_frame.f_code.co_filename) == _THIS_FILE:
            tb = tb.tb_next
        traceback.print_exception(type(exc), exc, tb)
        exit_code = 1
    finally:
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.flush()
            except Exception:
                pass
        try:
            with open(var_file, "w", encoding="utf-8") as f:
                json.dump(_describe(namespace), f, ensure_ascii=False)
        except Exception:
            pass
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
