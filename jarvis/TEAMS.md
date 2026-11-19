# 팀과 팀 세션 (11-19 디렉터 지시로 확대)

> 디렉터: "우리 팀은 13명이라매. 인원 더 충당해. 각각 세션 따로 만들어서 동시 작업 가능하도록."
> → **26명**(자비스 + 에이전트 25)으로 늘리고, **팀 세션 4개**가 동시에 일한다. 대화 창구는 「자비스 총괄」 하나.

## 1. 조직도
| 팀 | 팀 세션(팀장) | 팀원(에이전트) | 하는 일 |
|---|---|---|---|
| 총괄 | **자비스 총괄** (`session_01BfrX51dXWaNKuWw2fGatYw`) | 오상 회의 5인(council-*) | 디렉터와 대화, 계획, 배정, 검수, 병합, 보고 |
| 스토리팀 (5) | 팀 세션 「스토리팀」 | story-writer · plot-architect · dialogue-writer · lore-keeper · story-critic | 세계관·출신·엔딩·인물·대사·비평 |
| 디자인팀 (6) | 팀 세션 「디자인팀」 | game-designer · experience-designer · player-advocate · **combat-designer** · **level-designer** · **quest-designer** | 시스템·전투·공간·퀘스트·감정 곡선·플레이어 시선 |
| 개발팀 (7) | 팀 세션 「개발팀」 | programmer(리드) · **engine-programmer** · **gameplay-programmer** · **tools-programmer** · **ai-dialogue-engineer** · qa-tester · localizer | 엔진·규칙 코드·도구·의도 매칭·검사·번역 |
| 아트·사운드팀 (7) | 팀 세션 「아트·사운드팀」 | art-sound-director(리드) · **technical-artist** · **environment-artist** · **character-artist** · **animator** · **sound-designer** · **composer** | 사실적 그래픽·배경·인물·동작·소리·음악 |
| 야간 | 「자비스 야간 작업」(`session_01BfrX53b4yqTFnb7FLjmAvw`) | — | 새벽 브리핑, 비어 있는 작업 1개, 스토리 방 |
**굵은 글씨** = 11-19 새로 들어온 13명. 역할 파일: `.claude/agents/<이름>.md`.

## 2. 팀 세션 규칙
1. **항상 한국어**(설정으로 고정). 영어 문장으로 보고하지 않는다.
2. 시작할 때 읽기: `CLAUDE.md` → `jarvis/TEAMS.md`(이 파일) → `jarvis/TASKS.md` A절의 **자기 팀 줄** → `jarvis/LESSONS.md` 최근 → 관련 문서.
3. A절에서 자기 팀 줄을 위에서부터 하나씩 한다. 일은 팀원 에이전트에게 맡기되 **동시에 2명 이하**. 작은 일은 팀장이 직접.
4. 브랜치: `claude/team-<팀>`에만 커밋·푸시한다. 통합 브랜치(`claude/friendly-wozniak-1bd340`)와 main에 직접 쓰지 않는다. 시작할 때와 작업 사이에 통합 브랜치를 자기 브랜치로 병합해 최신으로 유지한다.
5. 파일 범위: 자기 팀 작업에 적힌 파일만 고친다. `CLAUDE.md`, `TODO.md`, `jarvis/TASKS.md` 구조, `jarvis/TEAMS.md`는 총괄만 고친다(팀은 TASKS의 **자기 줄 상태**만 바꾼다).
6. 작업 하나가 끝날 때마다: `jarvis/handoff/<작업ID>.md`, `jarvis/shared/운영일지.md` 오늘 칸에 "<팀>:" 한 줄, 커밋·푸시, 총괄에게 `send_message`로 3줄 보고(한 일·확인 방법·결정 필요).
7. 디렉터 결정이 필요한 것은 묻지 말고 **총괄에게 올린다**(디렉터와 직접 대화하지 않는다. 디렉터가 그 세션에 직접 말을 걸면 따른다).
8. 사용량: 시작 전 `get_session()`의 `rate_limit_info.status`. `allowed_warning`이면 Sonnet 팀원만·한 명씩, `rejected`면 멈추고 운영 일지에 적는다.
9. 금지: 기획 방향 확정, 비용 발생(유료 에셋·서비스), 외부 공개, 파일 삭제, 강제 푸시, 다른 작품의 이름·설정·그림·음악 사용.

## 3. 세션 등록부
| 팀 | 세션 ID | 브랜치 | 만든 날 |
|---|---|---|---|
| 스토리팀 | (생성 후 기록) | `claude/team-story` | 11-19 |
| 디자인팀 | (생성 후 기록) | `claude/team-design` | 11-19 |
| 개발팀 | (생성 후 기록) | `claude/team-dev` | 11-19 |
| 아트·사운드팀 | (생성 후 기록) | `claude/team-art` | 11-19 |
