# Linear webhook과 API 계약 검증

2026-11-17에 스펙 10절 10~14번([`docs/spec/0001-phase-1.md`](../spec/0001-phase-1.md))을 실제 Linear 워크스페이스에서 확인한 결과다. 티켓은 [`docs/tickets/0011-verify-linear.md`](../tickets/0011-verify-linear.md), 사전 조사는 [research 0002 B절](0002-external-contracts.md#b-linear)이다.

## 방법

- Linear 워크스페이스 관리자의 개인 API 키로 GraphQL API(`https://api.linear.app/graphql`)를 불렀다.
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

| #   | 질문                                                                          | 결과                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 10  | `Issue` update의 `updatedFrom`에 `labelIds`·`stateId`가 담기는가, `data` 필드 | 담긴다. 바뀐 필드의 이전 값만 담기고, `labelIds`는 이전 배열 전체다. `data` 필드는 아래 목록                                                           |
| 11  | 라벨 추가가 `Issue` update로 오는가, `IssueLabel` 이벤트로도 오는가           | `Issue` update로 언제나 온다. `IssueLabel` update도 올 때가 있지만 티켓을 가리키지 않고, 라벨을 바꾼 방법에 따라 오지 않는다. 할당 판단에 쓰지 않는다  |
| 12  | 최대 페이지 크기                                                              | `first`는 1~250, `last`는 최대 250. 벗어나면 `INVALID_INPUT` 오류                                                                                      |
| 13  | 개인 API 키 변경과 Linear GitHub 연동 자동 상태 전환의 충돌                   | 충돌하지 않는다. API로 바꾼 In Progress와 댓글은 연동의 Done 전환을 막거나 덮어쓰지 않았다. 연동은 PR을 `closes`로 붙였을 때만 병합 뒤 Done으로 옮긴다 |
| 14  | `attachmentLinkGitHubPR`와 Linear GitHub 연동 링크의 중복                     | 중복되지 않는다. 같은 URL이면 `INPUT_ERROR` 오류가 오고 첨부는 하나다. 순서가 반대여도 연동이 같은 첨부를 고친다                                       |

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

`create`, `update`, `remove`에서 늘 온 필드는 다음과 같다. 값이 있을 때만 오는 필드는 그 아래에 따로 적었다.

`addedToTeamAt`, `botActor`, `createdAt`, `creatorId`, `description`, `descriptionData`, `id`, `identifier`, `inheritsSharedAccess`, `labelIds`, `labels`, `number`, `previousIdentifiers`, `priority`, `priorityLabel`, `prioritySortOrder`, `reactionData`, `releases`, `slaType`, `sortOrder`, `state`, `stateId`, `subscriberIds`, `team`, `teamId`, `title`, `updatedAt`, `url`.

- `labels`는 `{ id, color, name }` 배열, `state`는 `{ id, color, name, type }`, `team`은 `{ id, key, name }`이다. 라벨 이름과 상태 `type`을 따로 조회하지 않아도 된다.
- 값이 있을 때만 온 필드: `startedAt`(started 상태일 때), `archivedAt`(보관한 티켓의 update). `projectId`·`project`는 이번 티켓이 Tracker Project에 속하지 않아 본문에 없었다. 값이 없는 필드는 빠지는 것으로 보이며, Tracker Project에 속한 티켓의 필드는 확인하지 않았다. 매핑이 Tracker Project 기준이므로 어댑터는 `projectId`가 없을 수 있다고 보고 파싱해야 한다.
- `description`은 마크다운 문자열이고, `descriptionData`는 에디터 문서를 JSON 문자열로 한 번 더 감싼 값이다.
- 보관(`issueArchive`)은 `Issue remove`로 왔고, 그 `data`에는 `archivedAt`이 없었다(뒤이어 온 그 티켓의 update에는 있었다). 보관과 삭제를 본문으로 가르지 못한다. 그 티켓의 댓글은 `Comment remove`로 함께 왔다.

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
- `first: 0`, `first: -1`도 오류다(`first must not be less than 1`). `last`의 하한은 시험하지 않았다.
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
- 쿼리 하나의 복잡도 상한(10,000점)은 확인하지 못했다. 이 Linear 워크스페이스는 티켓이 적어, `issues(first: 250) { nodes { comments(first: 250) … } }`도 통과했고 `issues(first: 250)` 목록 쿼리의 `x-complexity`는 5였다. 복잡도가 `first` 값이 아니라 실제로 돌려준 노드 수로 매겨지는 것으로 보이나, 티켓이 많은 Linear 워크스페이스에서는 다시 볼 일이다.

## 13·14. Linear GitHub 연동

2026-11-17에 10~12번과 다른 Linear 워크스페이스에서 확인했다. 이 Linear 워크스페이스에는 워크스페이스 GitHub 연동(`integrations`의 `service: "github"`)이 켜져 있고, 공개 테스트 저장소 하나를 보고 있었다. 팀 키는 아래에서 `ENG`로 쓴다.

### 방법

- 관리자의 개인 API 키로 GraphQL API를 불렀다. GitHub 쪽은 같은 사람의 GitHub 계정(`gh` 로그인)으로 브랜치를 push하고 PR을 열고 병합했다. 연동은 이 GitHub 계정을 같은 Linear 사용자로 잇고 있었다.
- 연동 설정은 읽기만 했다. API로 읽을 수 있는 것은 팀의 `gitAutomationStates`였고(`Integration`에는 설정 필드가 없다), 값은 다음과 같았다. `branchPattern`과 `targetBranch`는 모두 `null`이었다.

  | `event`  | 옮길 상태(`type`)      |
  | -------- | ---------------------- |
  | `start`  | In Progress(`started`) |
  | `review` | In Review(`started`)   |
  | `merge`  | Done(`completed`)      |

- 제목이 `[fo-verify]`로 시작하는 검증 티켓 다섯(A~E)을 새로 만들어 아래 순서로 바꿨다. 오케스트레이터 동작(런 시작 때 In Progress, 끝날 때 결과 댓글)은 API 호출로 흉내 냈다.

| 티켓   | PR 브랜치 / 제목                               | 한 일(순서대로)                                                                                                          | 결과                                                                                                                       |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| A      | `factory/ENG-1-1` / `ENG-1: …`                 | API로 Todo → In Progress, PR 열기, API 댓글, `attachmentLinkGitHubPR`·`attachmentLinkURL`(같은 URL), 병합, API 결과 댓글 | 연동이 PR을 6초쯤 뒤 붙였다(`linkKind: "closes"`). API 링크 둘은 오류. 병합 3초 뒤 Done. 결과 댓글 뒤에도 Done             |
| B      | 키 없는 브랜치 / 키 없는 제목                  | API로 In Progress, PR 열기, `attachmentLinkGitHubPR`(`linkKind` 생략), 병합                                              | 연동은 붙이지 않았다. API 링크는 `linkKind: "links"`. 병합해도 In Progress 그대로                                          |
| C      | `factory/ENG-3-1` / `Untitled`                 | API로 In Progress, PR 열기, 병합                                                                                         | 키가 브랜치 이름에만 있어도 연동이 붙였다(`closes`). 병합 뒤 Done                                                          |
| D      | 키 없는 브랜치 / 키 없는 제목                  | API로 In Progress, PR 열기, `attachmentLinkGitHubPR(linkKind: closes)`, 병합                                             | 병합 뒤 Done                                                                                                               |
| E      | 키 없는 브랜치 / 키 없는 제목 → 제목에 키 넣기 | API로 In Progress, PR 열기, `attachmentLinkGitHubPR`(`links`), PR 제목에 `ENG-5:` 넣기, 병합                             | 연동이 새 첨부를 만들지 않고 API가 만든 첨부(같은 `id`)의 `linkKind`를 `closes`로, 제목을 새 제목으로 바꿨다. 병합 뒤 Done |
| B 다시 | `factory/ENG-2-2` / `ENG-2: …`(만든 지 7분 뒤) | 새 PR 열기, 병합, 20초 뒤 API 결과 댓글                                                                                  | 연동이 붙이고 병합 3초 뒤 Done. 결과 댓글 뒤에도 Done. 이 티켓은 상태 이력이 남았다(아래)                                  |

### 13. 상태 변경·댓글과 자동 상태 전환

**충돌하지 않는다.** API로 바꾼 In Progress와 연동의 Done 전환은 서로 덮어쓰지 않았고, 순서도 엇갈리지 않았다.

- 런 시작에 해당하는 API 상태 변경(Todo → In Progress)은 PR이 열리기 전에 일어나므로, 연동이 끼어들 틈이 없다. PR을 연 뒤에도 연동은 상태를 바꾸지 않았다(이미 In Progress였다).
- 리뷰를 요청하지 않은 일반 PR을 열었을 때 In Review로 가지 않았다. `review` 전환은 이번 순서로는 일어나지 않았고, 무엇이 그것을 일으키는지는 확인하지 않았다.
- 연동이 PR을 붙인 티켓은 PR 병합 3초쯤 뒤 Done이 됐다(A·C·E·B 다시). 그 사이와 그 뒤에 쓴 API 댓글은 상태를 바꾸지 않았다. 런 종료 결과 댓글은 대개 병합 뒤에 달리므로 Done인 티켓에 댓글만 더하는 셈이다.
- 연동은 Linear 티켓에도 GitHub PR에도 댓글을 쓰지 않았다. 결과 댓글이 연동 댓글과 겹치지 않는다.
- 연동이 PR을 붙일 때 담당자가 없던 티켓을 PR 작성자에 이어진 Linear 사용자에게 할당했다(A·C·E·B 다시. API로만 링크한 D는 할당되지 않았다). 이번에는 webhook을 걸지 않아 확인하지 않았지만, 담당자 변경이므로 `Issue update`(`updatedFrom.assigneeId`)로 올 것으로 본다.
- 연동의 Done 전환은 상태 이력에 봇이 아니라 사람으로 남았다. B 다시의 이력은 `fromState: In Progress → toState: Done`, `actorId`가 GitHub 계정에 이어진 Linear 사용자, `botActor: null`이었다. PR을 붙인 기록만 `botActor: { type: "workflow", name: "Linear" }`였다. 그래서 actor로는 오케스트레이터(같은 사람의 API 키일 때)가 바꾼 것과 연동이 바꾼 것을 가르지 못한다.
- 티켓을 만든 지 몇 분 안에 일어난 상태 변경은 이력(`history`)에 남지 않았다. A·C·D·E는 만든 뒤 1~2분 안에 In Progress와 Done을 거쳤는데, 몇 분 뒤에 다시 봐도 이력에는 첨부 기록만 있었다. 이 티켓들의 Done 시각은 `completedAt`으로 확인했다. 만든 지 7분 뒤에 일어난 B 다시의 Done 전환은 남았다.

### 14. `attachmentLinkGitHubPR`와 연동 링크의 중복

**중복되지 않는다. 대신 오류가 온다.** 연동이 이미 붙인 PR URL을 다시 붙이면 첨부가 둘이 되지 않고 HTTP 200에 `data: null`과 다음 오류가 온다.

| mutation                 | `message`                                | `extensions.userPresentableMessage`               |
| ------------------------ | ---------------------------------------- | ------------------------------------------------- |
| `attachmentLinkGitHubPR` | `Duplicate attachment for duplicate url` | `An attachment with the same URL already exists.` |
| `attachmentLinkURL`      | `Unable to create issue attachment`      | `This URL has already been linked with ENG-1.`    |

두 오류 모두 `extensions.code`는 `INPUT_ERROR`, `type`은 `invalid input`, `statusCode`는 400, `userError`는 `true`다.

순서가 반대여도(E: API로 먼저 붙이고 연동이 나중에 알아봄) 연동은 첨부를 새로 만들지 않고 같은 첨부를 고쳤다. 어느 순서든 같은 PR의 첨부는 하나다.

`linkKind`가 상태 전환을 가른다. `GitGitHubPR`의 `linkKind`는 `closes`, `contributes`, `links` 셋이다(`GitLinkKind`).

- 연동이 키로 알아본 PR은 `closes`였고, 병합하면 Done이 됐다.
- `attachmentLinkGitHubPR`에서 `linkKind`를 빼면 `links`였고, 병합해도 상태가 바뀌지 않았다(B). `closes`를 주면 Done이 됐다(D). `contributes`는 시험하지 않았다.
- 연동은 PR 제목과 브랜치 이름에서 키를 찾았다. 본문만의 키는 시험하지 않았다.

### Q41 방식에 대한 결론

Q41(런 시작 때 In Progress, 끝날 때 결과 댓글, 그 뒤 상태는 연동에 맡김)은 **그대로 써도 된다.** 오케스트레이터의 두 갱신은 연동의 자동 상태 전환과 부딪히지 않았다. 다음 조건과 함께 둔다.

- Done 전환은 연동이 그 PR을 `closes`로 붙였을 때만 일어난다. 오케스트레이터 브랜치 `factory/<티켓 키>-<런 번호>`(Q40)에는 키가 있으므로 그 브랜치로 연 PR은 제목에 키가 없어도 연동이 붙인다(C). 에이전트가 키 없는 브랜치에 키 없는 제목으로 PR을 열면 연동도 붙이지 않아 Done이 되지 않는다. 이 경우는 research 0006 17절 #4처럼 오케스트레이터도 PR을 찾지 못하는 경우와 같다.
- 오케스트레이터가 PR을 첨부로 붙일 필요는 없다. 결과 댓글에 PR 링크가 들어가고, 오케스트레이터가 찾는 PR(브랜치나 제목·본문의 키로 찾은 PR)은 연동이 이미 붙인다. 붙이더라도 첨부가 둘이 되지는 않는다.
- 연동은 PR 작성자에게 티켓을 할당하고, 그 전환을 사람 actor로 남긴다. Auto-assign Label 감지는 `updatedFrom.labelIds` 차이로 하므로(10번) 이 update에 걸리지 않는다.
- In Review는 이번에 일어나지 않았다. "In Review로 간다"를 런 결과 판정이나 화면에서 기대하지 않는다.

운영자가 정할 제안(결정하지 않았다).

- 첨부를 붙이기로 한다면 `INPUT_ERROR`의 같은 URL 오류를 성공으로 다룬다. `linkKind`를 무엇으로 줄지도 정해야 한다. `closes`를 주면 연동이 못 알아본 PR(키 없는 브랜치·제목)도 병합 때 Done이 되지만, 그것은 Q41이 연동에 맡긴 상태 전환을 오케스트레이터가 일으키는 셈이다. 생략하면(`links`) 상태에 손대지 않는다.
- 연동의 상태 전환 규칙은 팀 `gitAutomationStates`로 읽을 수 있다. Settings나 온보딩에서 "In Progress" 상태를 고를 때 이 값을 함께 보여 줄 수 있다.

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

- 바꾼 값: 모든 UUID(`00000000-0000-4000-8000-` 뒤 12자리에 1부터 매긴 번호로, 파일끼리 같은 대상은 같은 값), 사람 이름·이메일·프로필 URL, Linear 워크스페이스 URL 조각(`acme`), 팀 키·이름(`ENG`, `Engineering`), 티켓 번호·제목·본문, 라벨 이름. 시각, 필드 순서, 그 밖의 값은 받은 그대로다.
- 바꾼 본문을 signing secret `fixture-signing-secret`으로 다시 서명해 `linear-signature`에 넣었다. `linear-timestamp`는 원래 값이라, 테스트는 시각을 고정하거나 1분 검사를 따로 다뤄야 한다.
- 본문 파일은 서명한 바이트 그대로다. 줄 끝 개행이 없고, 포매터가 고치지 않게 `.oxfmtrc.json`에서 이 폴더를 뺐다. 파일을 고치면 서명이 맞지 않는다.

## 정리 기록

검증에 쓴 것은 모두 치웠다. 만든 티켓 하나는 보관했고, 만든 라벨 둘과 webhook 하나는 지웠다. 지운 뒤 `webhooks`와 `issueLabels(filter: { name: { startsWith: … } })` 조회가 빈 목록인 것을 확인했다. 기존 티켓·라벨·상태는 읽기만 했다. 터널과 수신 서버는 껐다.

13·14번 검증에서는 만든 티켓 다섯을 모두 보관했고, `issues(filter: { title: { startsWith: "[fo-verify]" } })`가 빈 목록인 것을 확인했다. 테스트 저장소의 PR 여섯은 모두 병합으로 닫혔고, 그 head 브랜치 여섯은 지웠다. 병합 커밋은 테스트 저장소 기본 브랜치에 남았다. 연동 설정과 기존 티켓·라벨·상태는 읽기만 했다(목록 조회로 다른 티켓의 상태 이력을 읽은 것 포함).
