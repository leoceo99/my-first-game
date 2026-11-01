"""파이썬 코드에 색을 입히기 위한 구문 분석기.

tkinter와 무관한 순수 함수라서 따로 테스트할 수 있어요.
작성 중인(문법이 깨진) 코드에서도 멈추지 않도록 정규식으로 처리합니다.
"""

import builtins
import keyword
import re

_KEYWORDS = keyword.kwlist
_BUILTINS = [n for n in dir(builtins) if not n.startswith("_") and n not in _KEYWORDS]


def _words(words):
    alternatives = "|".join(map(re.escape, sorted(words, key=len, reverse=True)))
    return r"(?<![\w.])(?:" + alternatives + r")(?!\w)"


_PATTERN = re.compile(
    r"(?P<comment>#[^\n]*)"
    # 문자열: 삼중 따옴표 먼저, 닫히지 않은 문자열은 줄 끝(또는 파일 끝)까지
    r"|(?P<string>(?<!\w)[rRbBuUfF]{0,2}(?:"
    r"'''(?:\\[\s\S]|[^\\])*?(?:'''|\Z)"
    r'|"""(?:\\[\s\S]|[^\\])*?(?:"""|\Z)'
    r"|'(?:\\[\s\S]|[^'\\\n])*(?:'|(?=\n)|\Z)"
    r'|"(?:\\[\s\S]|[^"\\\n])*(?:"|(?=\n)|\Z)'
    r"))"
    r"|(?P<defkw>\b(?:def|class)\b)[ \t]+(?P<defname>[^\W\d]\w*)"
    r"|(?m:^)[ \t]*(?P<decorator>@[\w.]+)"
    r"|(?P<keyword>" + _words(_KEYWORDS) + r")"
    r"|(?P<builtin>" + _words(_BUILTINS) + r")"
    r"|(?P<number>(?<![\w.])(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+"
    r"|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?[jJ]?)(?!\w))"
)

TAGS = ("comment", "string", "keyword", "builtin", "number", "definition", "decorator")


def highlight_spans(text):
    """(태그, 시작 위치, 끝 위치) 목록을 돌려줍니다. 위치는 문자열 인덱스예요."""
    spans = []
    for m in _PATTERN.finditer(text):
        if m.group("defkw") is not None:
            spans.append(("keyword", m.start("defkw"), m.end("defkw")))
            spans.append(("definition", m.start("defname"), m.end("defname")))
            continue
        for name in ("comment", "string", "decorator", "keyword", "builtin", "number"):
            if m.group(name) is not None:
                spans.append((name, m.start(name), m.end(name)))
                break
    return spans
