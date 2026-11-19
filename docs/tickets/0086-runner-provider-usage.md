---
status: doing
blocked_by: []
---

# 0086 러너의 공급자 사용량 보이기

## 목표

러너마다 에이전트 공급자(Claude, Codex 등)의 사용량을 읽어 Runners 화면과 Dashboard에 보인다. 한도에 닿아 런이 멈춘 러너를 운영자가 바로 알게 한다.

## 배경

운영자와 정했다(2026-11-19, 시안 U1·U2). 러너는 Orca이고, 러너 맥에서 `orca account list --json`의 `result.rateLimits`에 공급자별 사용량이 있다.

- 공급자 키(claude, codex, gemini, cursor, grok, kimi, minimax, opencodeGo, antigravity, zcode)마다 `status`('ok'|'unavailable'|'error'), `error`(문장), `updatedAt`, `session`·`weekly`·`fableWeekly`·`monthly`(없으면 null) 각각 `usedPercent`, `windowMinutes`, `resetsAt`(ms), `resetDescription`.
- 같은 결과에 계정 이메일·조직 이름·홈 경로, 다른 계정(`inactiveClaudeAccounts` 등)의 사용량이 들어 있다.
- 공개 계약이 아니다.

## 범위

- **읽기(`packages/runner-orca`).** `Runner`에 선택 메서드 `readProviderUsage()`를 더하고, Orca 러너가 ssh로 `orca account list --json`을 부른다. `rateLimits`의 알려진 공급자 키만 zod로 느슨하게 파싱한다. 모르는 공급자와 필드는 버리고, 창 하나가 깨져도 나머지는 읽는다. 결과의 다른 부분(계정 이메일, 조직 이름, 홈 경로, 다른 계정의 사용량)은 스키마에 없어 읽는 순간 버린다. 파싱 실패, ssh 실패, 시간 초과는 오류를 던지지 않고 "읽지 못함"을 돌려준다. 원래 출력은 오류 내용이나 로그에 넣지 않는다.
- **상태 나누기.** `ok`는 쓰는 공급자, `unavailable` 중 자격 증명이 없거나(`usageMetadata.failureKind: missing-credentials`) 오류 문장이 로그인 안 함을 뜻하면 `signed-out`, 그 밖의 `unavailable`은 `unavailable`, 나머지 값은 `error`다. 오류 문장 자체는 저장하지 않는다.
- **점검(`apps/worker`).** 러너 점검(1분 간격)이 Online 러너에서만, 마지막으로 읽은 지 5분이 지났을 때 사용량을 읽는다. 읽기가 실패해도 경고 한 줄만 남기고 러너 상태(Online, 할당 막힘, 점검 오류)는 바꾸지 않는다. Offline 러너는 묻지 않고 전에 읽은 값을 남긴다.
- **저장(`packages/db`).** `runners` 표에 `provider_usage`(JSON)와 `provider_usage_read_at`(읽은 시각) 칸을 더한다. 값은 `{kind: "read", providers: [{provider, status, windows: [{kind, usedPercent, resetsAt}]}]}` 또는 `{kind: "unreadable"}`이다. 읽을 때 zod로 다시 검사하고, 깨진 값은 "읽지 못함"으로 본다.
  - **JSON 한 칸을 고른 이유.** 사용량은 늘 러너 하나의 스냅샷을 통째로 바꾸고 통째로 읽는다. 공급자·창으로 걸러 묻는 쿼리가 없고, 공급자와 창의 종류는 Orca가 바꿀 수 있는 공개되지 않은 계약이다. 정규화 표(러너 × 공급자 × 창)는 표 하나와 지우고 다시 넣는 트랜잭션이 더 필요하지만 얻는 것이 없다. 같은 표의 `prerequisites`도 같은 이유로 JSON 칸이다.
  - 칸에 `json_valid` CHECK를 걸면 drizzle-kit이 `runners` 표를 통째로 다시 만들어서, CHECK 없이 `ADD COLUMN` 두 줄로 두었다. 읽을 때의 zod 검사가 대신한다.
  - 저장 형식을 바꾸는 one-way 변경이라 사람이 병합한다.
- **Runners 화면(시안 U2).**
  - 목록에 "사용량(가장 높은 값)" 열: 공급자·창 이름("Claude 5시간") + 막대 + %. 읽지 않았거나 읽지 못했으면 그 문장을 보인다.
  - 상세 패널의 "공급자 사용량" 구역: 쓰는 공급자마다 있는 창(5시간·주간·Fable 주간·월간)만 막대·%·초기화 시각, 로그인 안 한 공급자는 "로그인하지 않았어요: Kimi, Cursor" 한 줄, 그 밖의 unavailable 공급자는 "쓰지 않는 공급자 N개"로 접어 둔다. "N분 전 읽었어요"와 계정 정보를 저장하지 않는다는 안내를 둔다.
  - 막대 색: 90% 미만 중립 회색, 90% 이상 problem 빨강. 노랑은 쓰지 않는다(ADR 0010 5번).
  - 막대는 `packages/ui`에 새로 더한 `UsageBar`(값 글 "72%")를 쓰고, 열 너비는 새 `size.usageColumn`이다(코디네이터 결정 2026-11-19: `CapacityBar`는 값 글이 "n/m"이라 % 를 보일 수 없고, 같은 값이어도 다른 뜻의 토큰을 빌리지 않는다). `/ds` 미리보기에 `UsageBar`를 더했다.
- **Dashboard.** 0085(Dashboard Runners 칸 다시 그리기)가 머지된 뒤에, 러너 행 아래 사용량 숫자 줄("Claude 주간 72%", 90% 이상 빨강 글자), 100%에 닿은 러너는 기존 문제 상자에 "Claude 5시간 한도에 닿았어요: runner-c · 1시간 12분 뒤 풀려요" 한 줄, 머리 문장에 한도로 멈춘 러너가 있으면 언제 다시 받는지. 0085가 머지되기 전에는 Dashboard 파일을 고치지 않는다. core의 `reachedUsageLimits`가 100%에 닿은 창을 고른다.
- **데모 시드(`pnpm dev`).** runner-a는 정상(Claude 주간 72%, Codex, 로그인 안 한 Kimi·Cursor, 쓰지 않는 Gemini·Antigravity), runner-b는 Claude 5시간 100%·주간 93%, runner-c(Offline)는 47분 전에 읽은 값이다.
- 화면 문구는 `apps/web/messages/ko/runners.json`(Runners)과 `ds.json`(미리보기)에 둔다. 용어 "공급자 사용량"을 GLOSSARY에 더했다.

## 완료 조건

- rateLimits 파싱 시험: 정상, 모르는 공급자·필드, 깨진 창·공급자, 깨진 JSON·오류 봉투, 계정 정보가 결과에 남지 않음(`packages/runner-orca/src/provider-usage.test.ts`).
- 점검이 사용량을 저장하고, 몇 분에 한 번만 읽고, 실패해도 러너 상태를 바꾸지 않고, Offline 러너는 묻지 않는다는 시험(`apps/worker/src/runner-check.test.ts`).
- 저장·읽기 시험과 마이그레이션 시험(기존 DB 올리기)(`packages/db/src/settings.test.ts`, `migrate.test.ts`).
- Runners 목록·패널 시험(`apps/web/src/runners/runners-screen.test.tsx`), `UsageBar` 시험, 데모 시드 시험.
- Runners 목록·패널, Dashboard 1280px 스크린숏.

## 후속

- 자동 할당에 반영(한도에 닿은 러너를 건너뛰기, 초기화 시각 뒤 다시 넣기)은 하지 않았다. 한도에 닿은 러너도 지금은 새 런을 받는다.
- Orca 말고 다른 러너 어댑터의 사용량 읽기.
