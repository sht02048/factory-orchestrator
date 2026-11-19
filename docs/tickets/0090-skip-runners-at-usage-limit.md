---
status: done
blocked_by: [0086]
---

# 0090 공급자 한도에 닿은 러너는 자동 할당에서 건너뛰기

## 목표

런이 쓸 에이전트의 공급자 한도(100%)에 닿은 러너에는 자동으로 런을 보내지 않는다. 한도가 풀리면 다시 후보로 본다. 모든 후보가 한도면 런은 Queued로 남고 그 이유를 보인다.

## 배경

0086이 러너별 공급자 사용량(`runners.provider_usage`, `provider_usage_read_at`)을 저장하고 화면에 보인다. 자동 할당은 아직 한도를 보지 않아, 한도에 닿은 러너에 런을 보내면 에이전트가 바로 멈춘다. 0086 「후속」의 첫 항목이다.

## 범위

- **에이전트 → 공급자(`packages/core` `providerOfAgent`).** Mapping의 에이전트 이름이 곧 공급자 키다: `claude` → `claude`, `codex` → `codex`. 웹 Settings가 고를 수 있는 에이전트(`KNOWN_AGENTS`)가 이 둘이다. 모르는 에이전트는 공급자가 없어 한도로 막지 않는다.
- **한도 판단(`packages/core` `usageLimitsAt`, 순수 함수).** 러너의 사용량 스냅샷과 지금 시각으로 공급자별 한도를 낸다.
  - `ok` 공급자의 어느 창이든 `usedPercent`가 100 이상이고 `resetsAt`이 지금보다 뒤면 그 공급자는 한도다. 풀리는 시각은 그 공급자의 한도 창 중 가장 늦은 `resetsAt`이다(Dashboard와 같은 규칙).
  - `resetsAt`이 지나면 다시 후보다. `resetsAt`을 모르는 창, 100% 미만인 창은 막지 않는다.
  - 읽지 못함(`unreadable`), 값 없음, `unavailable`·`error`·`signed-out` 공급자는 막지 않는다.
  - 읽은 지 30분(`USAGE_READING_FRESH_MS`)이 넘은 값은 막지 않는다. Online 러너는 5분마다 다시 읽어(0086) 보통은 새 값이고, 오래된 값은 사용량이 공개 계약이 아니라 할당을 막는 근거로 약하다.
- **러너 고르기.** `RunnerSnapshot`에 `usageLimits`를 더하고 `listRunnerSnapshots(db, now)`가 채운다. `pickRunner`는 런의 에이전트(`agent`)를 받아 그 공급자 한도에 닿은 러너를 건너뛴다. 자동 할당(webhook·폴링, `assignRun`의 러너 자동 고르기)과 Queued 런의 러너 고르기(`planQueue`)가 이 함수를 쓴다. `QueuedRun`에 `agent`를 더했다.
- **이미 러너를 정한 Queued 런은 그대로 둔다.** 운영자가 고른 러너와 자동으로 고른 러너를 저장소에서 가를 수 없어, 수동 할당을 막지 않으려고 러너를 비우지 않는다. 러너를 정할 때 한도를 보므로 새로 정하는 런은 한도 러너로 가지 않는다.
- **대기 사유.** 맞는 러너(프로젝트가 있고 Online이고 인증이 멀쩡한 러너)가 모두 런의 공급자 한도에 닿아 러너를 정하지 못하면 `planQueue`가 `usage-limit` 이유와 가장 빨리 풀리는 한도를 남긴다. Runs 패널·Run 상세·Dashboard In progress에 "모든 러너가 Claude 한도에 닿아 1시간 8분 뒤 풀려요"를 보인다(`domain.json` `queuedReason.usage-limit`, 문장 만들기는 `labels.ts`의 `useQueuedReasonText` 하나로 모았다).
- **수동 할당(Tickets).** 막지 않는다. 할당 대화상자의 러너 목록에서, 고른 에이전트의 공급자 한도에 닿은 Online 러너 이름 뒤에 "runner-a · Claude 한도에 닿았어요. 1시간 8분 뒤 풀려요"를 붙인다(기존 "· Offline" 방식). 자동 고르기 안내 문장에 한도 러너를 건너뛴다는 말을 더했다.
- **Dashboard 문구.** 0086에서 미룬 "한도가 풀려요"를 "한도가 풀리면 다시 런을 받아요"로 맞췄다(머리 문장, Runners 문제 상자). Runners 화면에는 이 문구가 없다.

## 완료 조건

- 한도 판단 단위 시험: 한도, 풀린 뒤, 읽지 못함·값 없음·ok가 아닌 공급자, 오래된 값, 여러 창, 에이전트 → 공급자(`packages/core/src/usage-limit.test.ts`).
- 러너 고르기·대기열 시험: 한도 러너 건너뛰기, 다른 공급자 한도는 보지 않음, 모두 한도면 가장 빨리 풀리는 한도를 이유로, 이미 정한 러너는 바꾸지 않음(`assignment.test.ts`, `queue.test.ts`).
- `assignRun` 시험: 자동으로 고르지 않고, 운영자는 고를 수 있고, 풀린 뒤 다시 고른다(`packages/db/src/runs.test.ts`).
- 대기 사유 시험(`apps/web/src/runs/queue-reasons.test.ts`, `run-detail-screen.test.tsx`), 할당 대화상자 경고 시험(`tickets-screen.test.tsx`), Dashboard 문구 시험(`home-screen.test.tsx`).
- 대기 사유가 보이는 Run 상세 1280px 스크린숏.

## 후속

- 한도 러너로 이미 정해져 capacity를 기다리는 Queued 런을 다른 러너로 옮기려면 수동·자동 할당을 저장해 갈라야 한다.
