# 여러 Claude Code 세션·서브에이전트 관리 방법 조사 (T-016)

조사일: 2026-11-08. 검색 8번, 페이지 읽기 3번만 썼다. 공식 문서는 계속 바뀌므로 적용 전에 다시 확인한다.
표시: [클라우드 OK] 이 환경(웹/모바일)에서 됨, [로컬 전용] 터미널·PC 필요, [미확인] 직접 안 해봄.

## 1. 핵심 원칙

1. **지시를 구체적으로 위임한다.** 하위 작업자에게 목표, 결과 형식, 쓸 도구, 작업 경계를 적어 준다. 모호하면 같은 일을 중복하거나 빠뜨린다.
   출처: [Anthropic, How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (2025-06-13)
2. **작업 크기에 맞춰 일꾼 수를 정한다.** 간단한 일은 하나로, 복잡한 일만 나눈다. 멀티에이전트는 토큰을 채팅의 약 15배 쓴다. 병렬이 잘 맞는 일은 "서로 상태를 공유하지 않는 넓은 조사"다.
   출처: 같은 글
3. **계획과 진행 상태를 파일에 저장한다.** 컨텍스트가 길어지면 잘리므로, 총괄이 계획을 밖에 적어 두고 체크포인트에서 이어간다. (우리의 TODO.md가 이 역할)
   출처: 같은 글
4. **서브에이전트는 "냄새나는 큰 출력"을 가두는 용도다.** 테스트 실행, 로그, 넓은 검색처럼 결과를 요약만 받고 싶은 일에 쓴다. 서브에이전트는 대화 기록을 모르므로 **중요한 규칙은 위임 프롬프트에 다시 적는다.** 도구는 필요한 것만 주고(최소 권한), 싼 일은 Haiku/Sonnet에 맡긴다.
   출처: [Claude Code 공식 문서: Subagents](https://code.claude.com/docs/en/sub-agents)
5. **병렬 작업은 각자 체크아웃(worktree)을 준다.** 같은 폴더에서 동시에 고치면 충돌한다. `isolation: worktree`는 기본 브랜치에서 갈라진다. 세션은 이름을 붙여 구분한다.
   출처: [공식 Best practices](https://code.claude.com/docs/en/best-practices), [Subagents](https://code.claude.com/docs/en/sub-agents)
6. **끝났는지 확인할 "검사"를 준다.** 테스트·린트 같은 실행 가능한 확인이 있어야 스스로 고친다. 꼭 지켜야 하는 규칙은 말이 아니라 **hook**(예: Stop hook, PreToolUse hook)이나 권한 규칙으로 강제한다. CLAUDE.md는 "부탁"이고 hook은 "강제"다.
   출처: [공식 Best practices](https://code.claude.com/docs/en/best-practices), [Hooks 문서](https://code.claude.com/docs/en/hooks)
7. **CLAUDE.md는 짧게(약 200줄 이하), 코드로 알 수 없는 것만.** 길면 지시가 무시된다. 절차는 skill로, 폴더별 규칙은 그 폴더 쪽으로 나눈다.
   출처: [공식 Best practices](https://code.claude.com/docs/en/best-practices)
8. **시작 전에 계획을 사람이 본다.** 감독 없는 병렬 에이전트는 구조 실수를 한참 뒤에야 드러낸다. 총괄은 계획 모드/계획 확인을 먼저 한다. (커뮤니티 의견, 개발사 글이라 걸러 읽기)
   출처: [DEV, 병렬 에이전트 가이드](https://dev.to/lainagent_ai/how-to-run-multiple-claude-code-agents-in-parallel-subagents-worktrees-and-a-kanban-board-1l5j)
9. **평가는 작게 시작하고 "결과 상태"를 본다.** 과정이 아니라 최종 결과가 맞는지 확인한다. 실패 재시도와 체크포인트를 둔다.
   출처: Anthropic 멀티에이전트 글

## 2. 우리 체계와 비교

| 원칙 | 이미 하고 있나 | 빠진 점 | 구체적 개선안 | 이 환경에서 가능? |
|---|---|---|---|---|
| 1 구체적 위임 | 예 (5.1 템플릿: 작업ID·레인·파일·완료 기준) | "결과 형식"과 "하지 말 것 목록"은 있으나 "탐색 범위·예상 시간/횟수 상한"이 없음 | 템플릿에 `상한: 도구 호출 N회 / 검색 N번 / 파일 N개` 한 줄 추가 | 가능 |
| 2 규모 맞춤·비용 | 부분 (3.1 개수 한도, 4.3 사용량, Sonnet 사용) | "혼자 하는 게 나은 경우" 기준이 없음. 병렬이 오히려 비쌀 수 있음 | 5.1 앞에 판단표: 한 파일·한 레인·10분 이내면 총괄이 직접. 서로 독립이고 출력이 큰 일만 위임 | 가능 |
| 3 계획·상태 파일 | 예 (TODO.md, 세션 등록부, 4.3 한도 직전 저장) | 작업 도중 체크포인트 규칙이 작업자에게는 없음 | 작업자 템플릿에 "30분 넘는 일은 중간 커밋 + 보고서 초안 먼저 쓰기" | 가능 |
| 4 서브에이전트 최소 권한·규칙 재명시 | 부분 (5.1 템플릿에 규칙 반복 포함) | 도구 제한(읽기 전용 조사용 등)은 안 씀 | 조사·검토 작업은 "읽기 전용: Edit/Write는 지정 파일만"을 프롬프트에 명시. 반복되는 역할은 `.claude/agents/*.md`로 정의(L0 일) | 프롬프트 방식은 가능. 에이전트 파일은 [미확인](클라우드에서 로드되는지 시험 필요) |
| 5 worktree 격리 | 예 (5.1, T-004 확인) | `main`에서 갈라지는 문제는 `--ff-only` 권장만 있고 검증 안 됨(T-015). 새 worktree에는 의존성(node_modules)이 없음 | T-015 검증 후 확정. 게임 작업 시 "worktree에서 `npm ci` 먼저" 한 줄 추가 | 서브에이전트 worktree 가능. `claude -w`, 데스크톱 병렬은 [로컬 전용] |
| 6 검사 + hook 강제 | 약함 (4.2 검증 단계는 있으나 말로만. 금지 명령은 `docs/permissions.md` 제안 상태 U-02) | 완료 조건이 자동 확인되지 않음. 작업자가 "됐다"고 하면 끝 | (a) 완료 기준에 반드시 실행 명령 포함(`npm test` 통과). (b) 총괄이 병합 전에 같은 명령을 직접 실행. (c) hook은 U-02 승인 후 | (a)(b) 가능. hook은 설정 파일 쓰기가 Auto 안전장치에 막혀 사용자 승인 필요 |
| 7 CLAUDE.md 짧게 | 중간 (현재 약 170줄, 한국어 표 많음) | 200줄에 가까워질수록 지시 무시 위험. 환경 실험 결과 표(2장)가 길다 | 2장 상세는 TODO.md/docs로 옮기고 CLAUDE.md에는 "된다/안 된다" 한 줄 요약만. 게임 코드가 생기면 폴더별 `CLAUDE.md`(예: `src/core/CLAUDE.md`) | 가능 |
| 8 계획 먼저 확인 | 약함 (총괄이 바로 배정) | 큰 작업 전 계획 점검 단계 없음 | 위임 전 총괄이 5줄 계획(목표/파일/완료기준/위험)을 TODO.md "진행 중"에 먼저 적기 | 가능 |
| 9 결과 평가·재시도 | 약함 (보고서만 있음) | 보고서를 믿고 병합. 실패 시 재시도 규칙 없음 | 병합 전 체크리스트: 레인 밖 수정 없음(`git diff --stat`) / 테스트 재실행 / 보고서 "남은 일" 확인. 같은 작업 2번 실패하면 쪼개서 재배정 | 가능 |
| (추가) 한 번 더 확인할 큰 작업 | 없음 | 총괄이 모든 것을 직접 검토 | 검토 전용 서브에이전트(읽기 전용, Sonnet)에 diff 리뷰 맡기기 | 가능 |
| (참고) Agent Teams (세션끼리 직접 통신) | 해당 없음 | - | 우리는 `send_message`+총괄 중계 방식. 실험 기능이라 도입 안 함 | [로컬 전용/실험] 이 환경에서 안 됨으로 봄 [미확인] |
| (참고) `claude -p` 반복 실행, `/batch`, 예약 실행 | 일부 (send_later, create_trigger) | - | 큰 기계적 변경은 `/batch` 같은 기능이 PR을 직접 만듦. 우리 규칙(PR은 사용자 요청 시만)과 충돌하므로 쓰지 않음 | 일부 [미확인] |

## 3. 영상 자료 (영상 직접 시청 안 함. 검색 결과의 제목·설명만 근거)

| 제목 | 채널 | URL | 한 줄 요약 | 날짜 |
|---|---|---|---|---|
| Claude Code Subagents Tutorial: Parallel Execution & Custom Agents | 확인 못 함 | https://www.youtube.com/watch?v=wYZU5AUkI-M | 서브에이전트 개념, 병렬 실행, 커스텀 에이전트 | 확인 못 함 |
| How to Use Multi-Agent Workflows in Claude Code: Skills, Subagents & Handoffs (2026) | 확인 못 함 | https://www.youtube.com/watch?v=qiDalcMeBFk | skill, 서브에이전트, 인계(handoff) 조합 | 2026 (제목 기준) |
| How to Create Sub Agents in Claude Code (2026) | 확인 못 함 | https://www.youtube.com/watch?v=ICgTn1JMU9Y | 반복 작업을 서브에이전트로 만드는 법 | 2026 (제목 기준) |
| Claude Code Subagents | 확인 못 함 | https://www.youtube.com/watch?v=oVll5a5vVc8 | 개념 설명, 메인 컨텍스트를 깨끗이 유지 | 확인 못 함 |
| Claude Code Subagents SIMPLIFIED in 7 Minutes! + QUICKSTART Tutorial | 확인 못 함 | https://www.youtube.com/watch?v=239JDMFuGcQ | 초보자용 7분 입문 | 확인 못 함 |
| Claude Code Subagents and Multi Agent Workflows | 확인 못 함 | https://www.youtube.com/watch?v=ivwh7B-M1NA | 큰 개발 작업용 특화 에이전트 | 확인 못 함 |

주의: 일부는 검색에서 약 15개월 전 영상으로 보여 지금 기능과 다를 수 있다. worktree·agent teams 전용 영상은 이번 검색에서 찾지 못했다(다음에 "Claude Code git worktrees"로 따로 검색).

## 4. 참고 링크

| 제목 | URL | 날짜 / 비고 |
|---|---|---|
| How we built our multi-agent research system (Anthropic) | https://www.anthropic.com/engineering/multi-agent-research-system | 2025-06-13 |
| Subagents (공식 문서) | https://code.claude.com/docs/en/sub-agents | 2026-11-08 열람 |
| Best practices (공식 문서) | https://code.claude.com/docs/en/best-practices | 2026-11-08 열람 |
| Claude Code on the web (공식 문서) | https://code.claude.com/docs/en/claude-code-on-the-web | 검색 결과만 확인. 웹 세션은 GitHub 접근·네트워크 제한 있음 |
| Hooks reference (공식 문서) | https://code.claude.com/docs/en/hooks | 검색 결과만 확인 |
| Agent teams (공식 문서, 실험 기능) | https://code.claude.com/docs/en/agent-teams | 검색 결과만 확인. v2.1.32 이상, 기본 꺼짐 |
| Claude Code Swarms (Addy Osmani) | https://addyosmani.com/blog/claude-code-agent-teams/ | 검색 결과만 확인 |
| How to run multiple Claude Code agents in parallel (DEV) | https://dev.to/lainagent_ai/how-to-run-multiple-claude-code-agents-in-parallel-subagents-worktrees-and-a-kanban-board-1l5j | 개발사 글, 걸러 읽기 |
| How to use git worktrees (Inventive HQ) | https://inventivehq.com/knowledge-base/claude/how-to-use-git-worktrees | 검색 결과만 확인 |
