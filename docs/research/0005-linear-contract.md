# Linear webhook과 API 계약 검증

2026-11-17에 스펙 10절 10~14번([`docs/spec/0001-phase-1.md`](../spec/0001-phase-1.md))을 실제 Linear 워크스페이스에서 확인한 결과다. 티켓은 [`docs/tickets/0011-verify-linear.md`](../tickets/0011-verify-linear.md), 사전 조사는 [research 0002 B절](0002-external-contracts.md#b-linear)이다.

## 방법

- 워크스페이스 관리자의 개인 API 키로 GraphQL API(`https://api.linear.app/graphql`)를 불렀다.
- 팀 하나에 webhook을 만들었다(`resourceTypes: ["Issue", "IssueLabel", "Comment"]`, `secret` 지정). 받는 쪽은 로컬 수신 서버였고, 계정 없는 임시 터널(`cloudflared tunnel --url`)로 공개 주소를 열었다. 수신 서버는 원문 본문 바이트와 헤더, 받은 시각을 파일로 남기고 200을 돌려줬다.
- 검증용 라벨 둘(아래에서 `auto-assign`, `bug`로 부른다)과 검증용 티켓 하나를 새로 만들고, 아래 순서로 바꾸며 받은 이벤트를 기록했다. 끝난 뒤 티켓은 보관하고 라벨과 webhook은 지웠다.

| 단계 | 한 일                                                       | 받은 이벤트(`type` `action`, `updatedFrom` 키)                                                                      |
| ---- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 0    | 라벨 둘 만들기, 티켓 만들기                                 | `IssueLabel create` ×2, `Issue create`                                                                              |
| A    | `issueAddLabel`(`auto-assign`)                              | `Issue update` `updatedAt, labelIds` / `IssueLabel update` `lastAppliedAt`                                          |
| B    | `issueUpdate(input: { stateId })`(backlog → started)        | `Issue update` `updatedAt, sortOrder, startedAt, stateId`                                                           |
| C    | `issueUpdate(input: { stateId, addedLabelIds: [bug] })`     | `Issue update` `updatedAt, sortOrder, labelIds, stateId, startedAt` / `IssueLabel update` `lastAppliedAt`           |
| D    | `issueRemoveLabel`(`bug`)                                   | `Issue update` `updatedAt, labelIds`                                                                                |
| E    | `issueUpdate(input: { labelIds: [bug] })`(라벨 전체 바꾸기) | `Issue update` `updatedAt, labelIds`                                                                                |
| F    | `commentCreate`                                             | `Comment create`                                                                                                    |
| G    | `issueUpdate(input: { title })`                             | `Issue update` `updatedAt, title`                                                                                   |
| H    | `issueAddLabel`(`auto-assign`, 다시)                        | `Issue update` `updatedAt, labelIds` / `IssueLabel update` `lastAppliedAt`                                          |
| 정리 | `issueArchive`, `issueLabelDelete` ×2                       | `Comment remove`, `Issue remove` / `IssueLabel remove` ×2, `Issue update` `updatedAt, labelIds` ×2(보관한 티켓에도) |

이벤트 20건이 모두 `linear-delivery`가 서로 다른 한 번씩만 왔고, 재전송은 없었다.

## 결론

| #   | 질문                                                                          | 결과                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | `Issue` update의 `updatedFrom`에 `labelIds`·`stateId`가 담기는가, `data` 필드 | 담긴다. 바뀐 필드의 이전 값만 담기고, `labelIds`는 이전 배열 전체다. `data` 필드는 아래 목록                                                          |
| 11  | 라벨 추가가 `Issue` update로 오는가, `IssueLabel` 이벤트로도 오는가           | `Issue` update로 언제나 온다. `IssueLabel` update도 올 때가 있지만 티켓을 가리키지 않고, 라벨을 바꾼 방법에 따라 오지 않는다. 할당 판단에 쓰지 않는다 |
| 12  | 최대 페이지 크기                                                              | `first`·`last` 모두 1~250. 벗어나면 `INVALID_INPUT` 오류                                                                                              |
| 13  | 개인 API 키 변경과 Linear GitHub 연동 자동 상태 전환의 충돌                   | 확인하지 못했다. 운영자 준비 후 확인                                                                                                                  |
| 14  | `attachmentLinkGitHubPR`와 Linear GitHub 연동 링크의 중복                     | 확인하지 못했다. 운영자 준비 후 확인                                                                                                                  |

## 10. `Issue` update 본문

### 최상위 필드와 헤더

본문 최상위 필드는 `action`, `actor`, `createdAt`, `updatedFrom`, `url`, `type`, `organizationId`, `data`, `webhookTimestamp`, `webhookId`다. 문서(research 0002 B.2)와 같다.

- `actor`는 사용자가 바꿨으면 `{ id, name, email, url, type: "user" }`다. `IssueLabel update`(`lastAppliedAt`)에서는 `null`이었다.
- `createdAt`은 이벤트가 생긴 시각이고, `webhookTimestamp`는 보낸 시각(Unix ms, 숫자)이다.

헤더는 `content-type: application/json; charset=utf-8`, `user-agent: Linear-Webhook`, `linear-delivery`(UUID), `linear-event`(본문 `type`과 같다), `linear-signature`, `linear-timestamp`다.

- `linear-signature`는 원문 본문 바이트를 signing secret으로 HMAC-SHA256 한 hex 64자다. 받은 20건 모두 맞았다.
- `linear-timestamp` 헤더는 본문 `webhookTimestamp`와 20건 모두 같은 값이었다.
- `webhookTimestamp`에서 수신 서버가 받기까지 0.1~0.6초 걸렸다(로컬 시계 기준). 문서의 1분 재전송 허용 범위 안이다.

### `updatedFrom`

문서대로 바뀐 필드의 이전 값만 담긴다. 실제로 본 키는 다음과 같다.

- 라벨만 바뀌면 `updatedAt`, `labelIds`.
- 상태가 바뀌면 `updatedAt`, `stateId`와, 상태 종류에 따라 `sortOrder`, `startedAt`.
- 라벨과 상태를 한 요청에서 바꾸면 이벤트 하나에 `labelIds`와 `stateId`가 함께 담긴다(단계 C).
- `labelIds`는 추가·제거한 차이가 아니라 이전 라벨 배열 전체다. 라벨이 없었으면 `[]`이다(`null`이 아니다).

단계 A의 값을 줄이면 다음과 같다.

```json
{
  "updatedFrom": { "updatedAt": "…", "labelIds": [] },
  "data": {
    "labelIds": ["<auto-assign>"],
    "labels": [{ "id": "<auto-assign>", "name": "auto-assign", "color": "…" }]
  }
}
```

### `data` 필드(`Issue`)

`create`, `update`, `remove` 모두 같은 필드 목록이었다.

`addedToTeamAt`, `botActor`, `createdAt`, `creatorId`, `description`, `descriptionData`, `id`, `identifier`, `inheritsSharedAccess`, `labelIds`, `labels`, `number`, `previousIdentifiers`, `priority`, `priorityLabel`, `prioritySortOrder`, `reactionData`, `releases`, `slaType`, `sortOrder`, `state`, `stateId`, `subscriberIds`, `team`, `teamId`, `title`, `updatedAt`, `url`.

- `labels`는 `{ id, color, name }` 배열, `state`는 `{ id, color, name, type }`, `team`은 `{ id, key, name }`이다. 라벨 이름과 상태 `type`을 따로 조회하지 않아도 된다.
- `projectId`·`project`는 이번 티켓이 Tracker Project에 속하지 않아 본문에 없었다. 값이 없는 필드는 빠지는 것으로 보이며, Tracker Project에 속한 티켓의 필드는 확인하지 않았다. 매핑이 Tracker Project 기준이므로 어댑터는 `projectId`가 없을 수 있다고 보고 파싱해야 한다.
- `description`은 마크다운 문자열이고, `descriptionData`는 에디터 문서를 JSON 문자열로 한 번 더 감싼 값이다.
- 보관(`issueArchive`)은 `Issue remove`로 왔고, `data`에 `archivedAt`이 없었다. 보관과 삭제를 본문으로 가르지 못한다. 그 티켓의 댓글은 `Comment remove`로 함께 왔다.

다른 모델의 `data` 필드도 기록해 둔다.

- `IssueLabel`: `color`, `createdAt`, `creatorId`, `groupType`, `id`, `isGroup`, `name`, `organizationId`, `teamId`, `updatedAt`, `lastAppliedAt`(update에서만 봤다).
- `Comment`: `body`, `botActor`, `createdAt`, `id`, `isArtificialAgentSessionRoot`, `issue`, `issueId`, `reactionData`, `updatedAt`, `user`, `userId`.

## 11. 라벨 추가 이벤트

라벨을 붙이는 세 방법(`issueAddLabel`, `issueUpdate`의 `addedLabelIds`, `issueUpdate`의 `labelIds`) 모두 `Issue update`가 왔고, `updatedFrom.labelIds`에 이전 배열이 담겼다. 라벨을 뗄 때(`issueRemoveLabel`)도 `Issue update`만 왔다.

`IssueLabel update`는 라벨의 `lastAppliedAt`이 바뀌었다는 이벤트다.

- `issueAddLabel`과 `addedLabelIds`로 붙일 때는 왔다(단계 A, C, H). `labelIds`로 바꿔 붙일 때는 오지 않았다(단계 E).
- `data`는 라벨 자신이라 어느 티켓에 붙었는지 알 수 없고, `actor`가 `null`이다.

라벨을 지우면(`issueLabelDelete`) `IssueLabel remove`와 함께, 그 라벨이 붙어 있던 티켓마다 `Issue update`(`labelIds`)가 왔다. 보관한 티켓에도 왔다.

## 12. 페이지 크기

`issues`, `issueLabels`, 중첩 `comments`에서 `first`를 바꿔 불렀다.

- `first: 250`은 된다. `first: 251`과 `first: 1000`은 오류다. `last`도 251에서 같은 오류다.
- `first: 0`, `first: -1`도 오류다(`first must not be less than 1`).
- 오류는 HTTP 200에 `data: null`과 다음 `errors[]`로 온다.

```json
{
  "message": "Argument Validation Error",
  "extensions": {
    "code": "INVALID_INPUT",
    "validationErrors": [
      {
        "property": "first",
        "value": 251,
        "constraints": { "max": "first must not be greater than 250" }
      }
    ],
    "userError": true
  }
}
```

- 응답 헤더 `x-ratelimit-requests-limit: 2500`, `x-ratelimit-complexity-limit: 3000000`은 research 0002 B.4와 같다.
- 쿼리 하나의 복잡도 상한(10,000점)은 확인하지 못했다. 이 워크스페이스는 티켓이 적어, `issues(first: 250) { nodes { comments(first: 250) … } }`도 통과했고 `issues(first: 250)` 목록 쿼리의 `x-complexity`는 5였다. 복잡도가 `first` 값이 아니라 실제로 돌려준 노드 수로 매겨지는 것으로 보이나, 티켓이 많은 워크스페이스에서는 다시 볼 일이다.

## 13·14. Linear GitHub 연동

확인하지 못했다. Linear 워크스페이스에 GitHub 연동을 켜고 테스트 저장소를 이어야 하는데, 이번에는 그 준비가 없었다. 운영자가 준비한 뒤 확인한다.

- 13: 개인 API 키로 상태를 바꾸거나 댓글을 쓴 티켓의 PR을 병합했을 때, Linear 연동의 자동 상태 전환(예: Done)과 순서가 엇갈리거나 서로 덮어쓰는지 본다.
- 14: Linear 연동이 PR 링크를 붙인 티켓에 `attachmentLinkGitHubPR`로 같은 PR을 붙였을 때 첨부가 둘이 되는지 본다.

확인 전까지 worker는 Linear 연동이 켜져 있을 수 있다고 보고, PR 링크를 붙이기 전에 그 티켓의 첨부에 같은 URL이 있는지 먼저 보는 편이 안전하다.

## 설계에 주는 뜻

- **Auto-assign Label 감지(0014, 0027).** `type: "Issue"`, `action: "update"`에서 `updatedFrom`에 `labelIds` 키가 있고, Auto-assign Label이 `data.labelIds`에는 있고 `updatedFrom.labelIds`에는 없으면 "방금 붙었다"다. `IssueLabel` 이벤트는 쓰지 않는다. research 0002의 "`data.labelIds`에 있고 진행 중인 런이 없다" 조건은 폴링 보정에 그대로 쓴다. 다른 필드(예: 제목)만 바뀐 update에서도 `data.labelIds`에는 라벨이 남아 있으므로, webhook 경로는 `updatedFrom` 차이로 거르는 편이 런 중복 생성을 덜 부른다.
- **상태 변경 감지.** 같은 방법으로 `updatedFrom.stateId`가 있으면 상태가 바뀐 것이고, 새 상태의 `type`은 `data.state.type`에서 바로 읽는다.
- **보관·삭제.** `Issue remove`는 보관과 삭제를 가르지 못한다. 둘 다 "더 이상 할당 대상이 아님"으로 다룬다.
- **서명 검증.** 원문 바이트로 HMAC을 계산한다(research 0002 B.2). 재전송 검사(1분)는 본문 `webhookTimestamp`로 한다. 관측값은 헤더 `linear-timestamp`와 같았지만, 서명은 본문 바이트만 덮어 헤더는 서명되지 않는다. 헤더 시각으로 검사하면 가로챈 본문을 헤더만 바꿔 다시 보낼 수 있다.
- **목록 조회.** 페이지 크기는 250까지 쓸 수 있다. 다만 중첩 connection은 복잡도를 키우므로 목록에서는 중첩을 빼고, 필요한 티켓만 따로 조회한다.

## 픽스처

[`fixtures/0005/`](fixtures/0005/)에 실제로 받은 본문 넷을 가상 값으로 바꿔 두었다. 파일마다 본문(`<이름>.json`)과 헤더(`<이름>.headers.json`)가 한 쌍이다.

| 이름                           | 단계 | 내용                                                     |
| ------------------------------ | ---- | -------------------------------------------------------- |
| `issue-update-label-added`     | A    | 라벨 없는 티켓에 `auto-assign` 라벨 추가(`Issue update`) |
| `issue-update-state-and-label` | C    | 한 요청으로 상태 변경과 `bug` 라벨 추가                  |
| `issuelabel-update-applied`    | A    | 같은 라벨 추가로 함께 온 `IssueLabel update`             |
| `issue-remove-archived`        | 정리 | 보관으로 온 `Issue remove`                               |

- 바꾼 값: 모든 UUID(`00000000-0000-4000-8000-00000000000N`로, 파일끼리 같은 대상은 같은 값), 사람 이름·이메일·프로필 URL, 워크스페이스 URL 조각(`acme`), 팀 키·이름(`ENG`, `Engineering`), 티켓 번호·제목·본문, 라벨 이름. 시각, 필드 순서, 그 밖의 값은 받은 그대로다.
- 바꾼 본문을 signing secret `fixture-signing-secret`으로 다시 서명해 `linear-signature`에 넣었다. `linear-timestamp`는 원래 값이라, 테스트는 시각을 고정하거나 1분 검사를 따로 다뤄야 한다.
- 본문 파일은 서명한 바이트 그대로다. 줄 끝 개행이 없고, 포매터가 고치지 않게 `.oxfmtrc.json`에서 이 폴더를 뺐다. 파일을 고치면 서명이 맞지 않는다.

## 정리 기록

검증에 쓴 것은 모두 치웠다. 만든 티켓 하나는 보관했고, 만든 라벨 둘과 webhook 하나는 지웠다. 지운 뒤 `webhooks`와 `issueLabels(filter: { name: { startsWith: … } })` 조회가 빈 목록인 것을 확인했다. 기존 티켓·라벨·상태는 읽기만 했다. 터널과 수신 서버는 껐다.
