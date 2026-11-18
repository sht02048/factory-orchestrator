---
status: todo
blocked_by: [0050]
---

# 0056 Runs·레일 셸 UI 리뷰 후속

## 목표

런이 쌓여도 Runs가 무겁지 않고, 좁은 창에서 목록이 무너지지 않으며, 레일의 Runner Issue 점을 읽을 수 있게 한다.

## 배경

UI 리뷰 판정은 Approve with changes였다. 4번은 `packages/ui/src/components/layout.tsx`를 고쳐 0050(7번 `pageHead`)과 겹치므로 0050 뒤에 한다.

## 범위

### 고칠 것(Should fix)

1. **Runner Issue 점 대비.** `shell/app-shell.tsx`의 점이 `colors.problem` 바탕에 `colors.textOnAccent` 11px 글자라 대비가 약 2.8:1이다. 글자를 어두운 색으로 바꾸거나 바탕을 더 어두운 빨강으로 바꿔 4.5:1을 넘긴다(색은 토큰으로).
2. **런 목록 상한.** `runs/load.ts`가 `listRuns(db, { workspaceId })`로 Workspace의 모든 런을 읽고(상한 없음, `packages/db/src/runs.ts`), 런마다 `getRunWithRecords`로 다시 읽으며(N+1), 가상화 없이 모두 그린다. 진행 중인 런은 모두 보이고 끝난 런은 최근 N개와 "더 보기"로 자르거나 페이지를 나눈다. 기록은 이미 읽은 행에서 만든다.
3. **"자세히 보기" 내비게이션.** 패널의 "자세히 보기"가 일반 `<a href>`라 문서 전체를 다시 읽는다. Enter·두 번 누르기는 클라이언트 내비게이션이다. 수정키 없는 클릭은 `onOpen(id)`로 보내거나 라우터 `Link`를 쓴다.
4. **좁은 창.** `SplitView`가 `minmax(0,1fr) 384px` 하나뿐이라 창이 약 830px보다 좁으면 티켓 열이 0px가 된다. 좁은 폭에서 패널을 아래로 내리거나 숨긴다. `SplitView`를 쓰는 다른 화면(Tickets, Settings)도 함께 확인한다.

### 하면 좋은 것(Nits)

- 패널의 러너 Offline을 회색 meta 글 대신 `<StatusPill status="offline">`로 보인다(ADR 0010 4·5번).
- 필터 결과가 0개면 오른쪽 패널에 빈 면만 남는다. 빈 상태 한 줄을 둔다.
- 레일 `navName`에 `whiteSpace: "nowrap"`이 없어 말줄임이 걸리지 않는다.
- 진행 중인 런의 경과 시간이 패널 머리 줄과 정의 목록에 두 번 나온다.

## 완료 조건

- Runner Issue 점의 글자·바탕 대비가 4.5:1 이상이라는 확인.
- 끝난 런이 많아도 Runs 로더가 상한만큼만 읽는다는 시험.
- "자세히 보기"가 문서를 다시 읽지 않는다는 시험.
- 800px 폭 Runs 스크린숏을 PR에 붙인다.
