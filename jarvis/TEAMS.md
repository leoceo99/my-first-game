# 팀과 팀 세션 (11-19 디렉터 지시로 확대)

> 디렉터: "우리 팀은 13명이라매. 인원 더 충당해. 각각 세션 따로 만들어서 동시 작업 가능하도록."
> → **30명**(자비스 + 에이전트 29)으로 늘리고, **팀 세션 4개**가 동시에 일한다. 대화 창구는 「자비스 총괄」 하나.

## 1. 조직도
| 팀 | 팀 세션(팀장) | 팀원(에이전트) | 하는 일 |
|---|---|---|---|
| 총괄 | **자비스 총괄** (`session_01BfrX532rVVZCmEf5539R2x`, 11-19 교대. 옛 `session_01BfrX51dXWaNKuWw2fGatYw`는 은퇴) | 오상 회의 5인(council-*) | 디렉터와 대화, 계획, 배정, 검수, 병합, 보고 |
| 스토리팀 (6) | 팀 세션 「스토리팀」 | story-writer · plot-architect · dialogue-writer · lore-keeper · story-critic · **story-steward(도우미)** | 세계관·출신·엔딩·인물·대사·비평 |
| 디자인팀 (7) | 팀 세션 「디자인팀」 | game-designer · experience-designer · player-advocate · **combat-designer** · **level-designer** · **quest-designer** · **design-steward(도우미)** | 시스템·전투·공간·퀘스트·감정 곡선·플레이어 시선 |
| 개발팀 (8) | 팀 세션 「개발팀」 | programmer(리드) · **engine-programmer** · **gameplay-programmer** · **tools-programmer** · **ai-dialogue-engineer** · qa-tester · localizer · **dev-steward(도우미)** | 엔진·규칙 코드·도구·의도 매칭·검사·번역 |
| 아트·사운드팀 (8) | 팀 세션 「아트·사운드팀」 | art-sound-director(리드) · **technical-artist** · **environment-artist** · **character-artist** · **animator** · **sound-designer** · **composer** · **art-steward(도우미)** | 사실적 그래픽·배경·인물·동작·소리·음악 |
| 야간 | 「자비스 야간 작업」(`session_01BfrX53b4yqTFnb7FLjmAvw`) | — | 새벽 브리핑, 비어 있는 작업 1개, 스토리 방 |
**굵은 글씨** = 11-19 새로 들어온 13명. 역할 파일: `.claude/agents/<이름>.md`.

## 2. 팀 세션 규칙
1. **항상 한국어**(설정으로 고정). 영어 문장으로 보고하지 않는다.
2. 시작할 때 읽기: `CLAUDE.md` → `jarvis/TEAMS.md`(이 파일) → `jarvis/TASKS.md` A절의 **자기 팀 줄** → `jarvis/LESSONS.md` 최근 → 관련 문서.
3. A절에서 자기 팀 줄을 위에서부터 하나씩 한다. 일은 팀원 에이전트에게 맡기되 **동시에 2명 이하**. 작은 일은 팀장이 직접.
4. 브랜치: `claude/team-<팀>`에만 커밋·푸시한다. 통합 브랜치(`claude/friendly-wozniak-1bd340`)와 main에 직접 쓰지 않는다. 시작할 때와 작업 사이에 통합 브랜치를 자기 브랜치로 병합해 최신으로 유지한다.
5. 파일 범위: 자기 팀 작업에 적힌 파일만 고친다. `CLAUDE.md`, `TODO.md`, `jarvis/TASKS.md` 구조, `jarvis/TEAMS.md`는 총괄만 고친다(팀은 TASKS의 **자기 줄 상태**만 바꾼다).
6. 작업 하나가 끝날 때마다 **먼저 팀 도우미(`<팀>-steward`, 가벼운 모델)를 불러 결과 정리·인수인계 초안을 맡긴다.** 그다음: `jarvis/handoff/<작업ID>.md`, `jarvis/shared/운영일지.md` 오늘 칸에 "<팀>:" 한 줄, 커밋·푸시, 총괄(`session_01BfrX532rVVZCmEf5539R2x`)에게 `send_message`로 3줄 보고(한 일·확인 방법·결정 필요).
7. 디렉터 결정이 필요한 것은 묻지 말고 **총괄에게 올린다**(디렉터와 직접 대화하지 않는다. 디렉터가 그 세션에 직접 말을 걸면 따른다).
8. 사용량: 시작 전 `get_session()`의 `rate_limit_info.status`. `allowed_warning`이면 Sonnet 팀원만·한 명씩, `rejected`면 멈추고 운영 일지에 적는다.
9. 금지: 기획 방향 확정, 비용 발생(유료 에셋·서비스), 외부 공개, 파일 삭제, 강제 푸시, 다른 작품의 이름·설정·그림·음악 사용.

## 3. 세션 등록부
| 팀 | 세션 ID | 브랜치 | 만든 날 |
|---|---|---|---|
| 스토리팀 | `session_01BfrX53LyQZ5wVfni94VvZy` | `claude/team-story` | 11-19 |
| 디자인팀 | `session_01BfrX4zZ1NUVH1au1HDMLW4` | `claude/team-design` | 11-19 |
| 개발팀 | `session_01BfrX4ysZoMGvD8HxoHVvLc` | `claude/team-dev` | 11-19 |
| 아트·사운드팀 | `session_01BfrX4zFeLs8LaUZjWysPKn` | `claude/team-art` | 11-19 |

- 모델: 스토리팀·개발팀은 Opus, 디자인팀·아트·사운드팀은 Sonnet(사용량 절약).

## 4. 팀 도우미 (11-19 디렉터 지시, 4명)
- story-steward · design-steward · dev-steward · art-steward: 팀 일(정리·검토·인수인계 초안)을 돕는다. 가벼운 모델(Haiku)로 돌아 사용량을 적게 쓴다.
- 총괄 직속으로 **사용량 낭비를 조용히 점검**해 `jarvis/shared/효율기록.md`에 3줄 이내로 남긴다(역할 파일 참고). 총괄이 하루 한 번 읽고 조치한다.

## 4. 작업 흐름 규칙 (11-19 디렉터: "작업 순서에 맞춰 서로 유기적으로, 필요할 때만")
1. **팀 세션은 총괄의 '시작 신호'를 받았을 때만 일한다.** 신호에는 작업 ID·선행 작업 결과 위치·완료 기준이 들어 있다. 신호 없이 A절의 다음 줄로 넘어가지 않는다.
2. 총괄은 작업의 **선행 작업이 끝나고 병합된 뒤에만** 그 작업의 시작 신호를 보낸다(TASKS의 "선행" 칸 기준). 선행이 없는 작업도 디렉터가 정한 순서대로만 보낸다.
3. 작업이 끝나면 팀은 보고하고 **대기**한다. 빈 시간에 조사·초안·정리를 스스로 만들지 않는다(사용량 낭비 방지).
4. 다른 팀의 결과가 필요하면 직접 요청하지 않고 총괄에게 올린다. 총괄이 그 팀에 신호를 보낸다.
5. 야간 세션도 같은 규칙: 총괄이 "야간에 맡김"으로 적은 작업만 한다. 예약은 디렉터가 재개를 지시할 때 다시 켠다.
6. **지금 상태(11-19~)**: 디렉터 지시로 전 팀 중단. 다음 주 디렉터가 재개를 말하면 첫 작업은 "전수 조사·순서·체크리스트"(TASKS 맨 위)다.
