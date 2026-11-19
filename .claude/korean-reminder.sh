#!/bin/sh
# 디렉터 지시(11-19): 모든 세션은 항상 한국어로 답한다. 매 메시지마다 이 알림을 덧붙인다.
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"[디렉터 고정 규칙] 모든 답변·보고·요약·질문·생각 정리는 반드시 한국어로 쓴다. 영어 문장을 한 줄도 디렉터 화면에 남기지 않는다. 할 말이 없을 때도 한국어로 짧게 쓴다(예: '진행 중입니다'). 보내기 전에 한국어인지 확인한다."}}
JSON
