# GitHub PR 조회 계약 검증

조사일 2026-11-17. 티켓 [0012](../tickets/0012-verify-github.md). 스펙 [0001](../spec/0001-phase-1.md) 10절의 GitHub 항목 15, 17, 18, 20을 실제 호출로 확인한다. [research 0002](0002-external-contracts.md) C절을 잇는다.

출처 표기는 research 0002와 같다.

- **[실행]** 실제로 돌린 호출의 결과.
- **[스키마]** GitHub GraphQL introspection.
- **[문서]** 공식 문서 URL.

환경:

- 버리는 테스트 저장소 `<owner>/<repo>` 하나. 기본 브랜치 `main`, PR마다 도는 GitHub Actions 잡 `check` 하나. 17·18·20절은 비공개일 때 돌렸고, 15절은 공개로 바꾼 뒤 돌렸다.
- 17·18·20절의 토큰은 classic 계열의 넓은 권한 토큰이다. 15절은 이 저장소 하나에만 Metadata, Pull requests, Commit statuses 읽기를 준 fine-grained PAT로 돌렸다.
- 티켓 키는 가상 값 `ENG-123` 꼴을 썼다. 저장소 이름과 계정은 `<owner>/<repo>`로, 픽스처에서는 `acme/app`으로 바꿨다. 커밋 SHA도 가상 값으로 바꿨다.

## 요약

| #   | 확인할 사실                                                   | 결과                                                                                                                                                                            |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15  | fine-grained PAT로 `statusCheckRollup`이 check run까지 오는지 | **공개 저장소에서는 온다.** 이름·상태·결론까지 온다. 비공개 저장소는 확인하지 못했다. fine-grained PAT에는 Checks 권한이 없어 비공개에서는 막힐 수 있다. 대안은 Actions 읽기다. |
| 17  | 에이전트가 브랜치를 바꾼 경우 키 보조 검색이 충분한지         | **조건부로 충분하다.** 키가 PR 제목이나 본문에 있으면 찾는다. 브랜치 이름에만 있으면 못 찾는다. 브랜치 이름을 바꾸면 원래 PR이 닫혀 1순위 조회가 닫힌 PR을 돌려준다.            |
| 18  | GraphQL에 ETag/304가 적용되는지                               | **적용되지 않는다.** GraphQL POST 응답에 ETag가 없고 `If-None-Match`를 무시한다. REST PR 목록은 304를 주고 304는 한도에서 빠진다.                                               |
| 20  | 티켓 키로 PR을 찾는 쿼리와 rate limit                         | **정했다.** GraphQL `search(type: ISSUE_ADVANCED)`에 따옴표 친 키. 1점, GraphQL 5,000점/시간 한도를 쓰고 REST 검색 한도(30회/분)를 쓰지 않는다. 받은 뒤 키를 다시 걸러 낸다.    |

## 15. fine-grained PAT와 `statusCheckRollup`

### 결과: 공개 저장소에서는 온다

테스트 저장소 하나에만 Metadata, Pull requests, Commit statuses 읽기를 준 fine-grained PAT로 [스크립트](fixtures/0006/check-status-rollup.sh)를 돌렸다. 대상은 GitHub Actions 잡 `check`가 통과한 PR이다. check run이 이름·상태·결론까지 왔다 **[실행]**. classic 계열 토큰의 응답([`status-check-rollup-classic-token.json`](fixtures/0006/status-check-rollup-classic-token.json))과 모양이 같다.

```json
"statusCheckRollup": {
  "state": "SUCCESS",
  "contexts": {
    "totalCount": 1,
    "nodes": [{ "__typename": "CheckRun", "name": "check", "status": "COMPLETED", "conclusion": "SUCCESS" }]
  }
}
```

전체 응답: [`fixtures/0006/status-check-rollup-fine-grained-pat.json`](fixtures/0006/status-check-rollup-fine-grained-pat.json). GraphQL 응답에는 `x-accepted-github-permissions` 헤더가 없었다 **[실행]**.

### 한계: 권한 때문에 온 것이 아니다

이 결과는 저장소가 공개라서 나왔을 수 있다. 근거:

- 같은 PAT로, PAT의 저장소 선택에 **넣지 않은** 다른 공개 저장소의 PR을 조회해도 check run이 왔다 **[실행]**. 공개 저장소의 check run은 권한 없이도 읽힌다.
- fine-grained PAT의 저장소 권한 목록에 **Checks가 없다** **[문서]** <https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens>. 이 문서는 권한이 비공개 자원에 필요하고 일부 엔드포인트는 공개 자원을 권한 없이 읽는다고 적는다.
- REST `GET /repos/{owner}/{repo}/commits/{ref}/check-runs`는 응답 헤더로 `x-accepted-github-permissions: checks=read`를 요구한다고 알렸다 **[실행]**. 이 PAT에는 없는 권한인데 공개 저장소라 `200`이 왔다.
- Commit statuses 권한으로 읽는 `GET .../commits/{ref}/status`(`statuses=read`)는 같은 커밋에 `total_count: 0`, `state: "pending"`을 돌려줬다 **[실행]**. GitHub Actions 잡은 commit status가 아니라 check run이라 이 경로로는 CI 결과가 보이지 않는다.

그래서 **비공개 저장소에서 fine-grained PAT로 check run이 오는지는 확인하지 못했다.** 비공개에서는 `statusCheckRollup`이 `StatusContext`만 돌려주거나 check run을 빼고 줄 수 있다(추정). 확인하려면 테스트 저장소를 잠시 비공개로 돌리고 같은 스크립트를 다시 돌린다.

### 대안

비공개 저장소에서 check run이 빠지면 다음 순서로 고른다.

1. **Actions 읽기 권한을 더한다.** `GET /repos/{owner}/{repo}/actions/runs?head_sha=<sha>`는 `x-accepted-github-permissions: actions=read`를 요구하고, 워크플로 런의 `status`·`conclusion`을 돌려줬다 **[실행]**. fine-grained PAT 권한 목록에 Actions(`GET /repos/{owner}/{repo}/actions/runs`, read)가 있다 **[문서]**. GitHub Actions 결과만 보이고 외부 CI 앱의 check run은 보이지 않는다.
2. **REST commit status만 쓴다.** 지금 권한(Commit statuses 읽기)으로 된다. 외부 CI가 commit status를 쓰는 경우만 보이고 GitHub Actions는 보이지 않는다.
3. **classic PAT(`repo` 범위)를 쓴다.** check run까지 오지만 권한이 넓다.

판정은 PR 상태만 쓰므로 이 항목은 판정을 막지 않는다. 영향은 화면의 CI 보조 정보와 온보딩의 토큰 권한 안내다(research 0002 C.4). 온보딩은 "비공개 저장소에서 CI 결과를 보려면 Actions 읽기를 더한다"를 안내 후보로 둔다.

## 17. 에이전트가 브랜치를 바꾼 경우

### 시나리오와 결과

오케스트레이터 브랜치를 `factory/<티켓 키>-<런 번호>`(스펙 Q40)로 보고 아래 PR을 만들었다 **[실행]**. "1순위"는 `pullRequests(headRefName: <오케스트레이터 브랜치>)`, "2순위"는 20절의 키 검색이다.

| PR  | 상황                                                  | head 브랜치                            | 제목 / 본문                              | 1순위          | 2순위(키 검색)          |
| --- | ----------------------------------------------------- | -------------------------------------- | ---------------------------------------- | -------------- | ----------------------- |
| #1  | 오케스트레이터 브랜치 그대로                          | `factory/ENG-123-1`                    | `ENG-123: add a` / 키 없음               | 찾음           | 찾음                    |
| #2  | 에이전트가 자기 브랜치를 새로 만듦                    | `fix/login-redirect`                   | `Fix login redirect (ENG-124)` / 키 없음 | 없음           | 찾음                    |
| #3  | 자기 브랜치, 키는 본문에만                            | `agent/refactor`                       | `Refactor helpers` / `Closes ENG-125`    | 없음           | 찾음                    |
| #4  | 자기 브랜치, 키가 어디에도 없음                       | `random-work`                          | `Some work` / 키 없음                    | 없음           | **못 찾음**             |
| #9  | 오케스트레이터 브랜치, 제목·본문에 키 없음            | `factory/ENG-127-1`                    | `Untitled` / 키 없음                     | 찾음           | **못 찾음**             |
| #7  | 오케스트레이터 브랜치로 PR을 연 뒤 브랜치 이름을 바꿈 | `factory/ENG-126-1` → `feat/renamed-g` | `ENG-126: add g` / 키 없음               | 닫힌 PR을 찾음 | 닫힌 PR을 찾음          |
| #6  | 다른 일인데 본문에서 키를 언급                        | `docs/notes`                           | `Docs notes` / `Related to ENG-123, ...` | -              | `ENG-123`에 걸림        |
| #5  | 더 긴 다른 키                                         | `feature/eng-1234-followup`            | `ENG-1234 follow-up` / -                 | -              | `ENG-123`에 안 걸림     |
| #8  | 키를 이루는 낱말이 따로 있음                          | `misc/cleanup`                         | `ENG cleanup for 123 items` / -          | -              | `ISSUE` 검색에서만 걸림 |

### 알게 된 것

- **`headRefName`은 정확히 일치해야 한다** **[실행]**. 에이전트가 오케스트레이터 브랜치를 push하지 않고 다른 브랜치로 PR을 열면(#2~#4) 1순위는 빈 목록이다.
- **키 검색은 PR 제목과 본문만 본다** **[실행]**. 키가 브랜치 이름에만 있으면(#9의 `ENG-127`) 검색 결과가 없다. 브랜치는 `head:` 한정자로 따로 찾을 수 있지만 접두어 일치다(`head:factory`가 `factory/...` 셋을, `head:factory/ENG-123`이 `factory/ENG-123-1`을 찾았다). 접두어 일치라 `head:factory/ENG-12`가 `ENG-123`도 찾게 되므로 키 검색에 쓰지 않는다.
- **브랜치 이름을 바꾸면 원래 PR이 닫힌다** **[실행]**. API(`POST /repos/{owner}/{repo}/branches/{branch}/rename`)로 head 브랜치 이름을 바꾸자 PR #7에 `HeadRefDeletedEvent`와 `ClosedEvent`가 붙고 `state: CLOSED`, `merged: false`가 됐다. `headRefName`은 옛 이름으로 남아, 옛 이름으로 조회하면 닫힌 PR이 나오고 새 이름으로는 아무것도 안 나온다. 응답: [`fixtures/0006/pr-by-branch-after-rename.json`](fixtures/0006/pr-by-branch-after-rename.json). 이 픽스처는 research 0002 C.2 `RunPr` 응답이 아니라, 닫힌 까닭을 보려고 따로 보낸 아래 쿼리의 응답이다. `commits`·`mergeStateStatus`·`rateLimit`은 묻지 않았다.

```graphql
query PrByBranchAfterRename($owner: String!, $repo: String!, $branch: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(headRefName: $branch, first: 5, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes {
        number
        url
        state
        merged
        mergedAt
        closedAt
        headRefName
        headRefOid
        baseRefName
        isCrossRepository
        headRepository {
          nameWithOwner
        }
        timelineItems(last: 2, itemTypes: [CLOSED_EVENT, HEAD_REF_DELETED_EVENT]) {
          nodes {
            __typename
            ... on HeadRefDeletedEvent {
              headRefName
            }
          }
        }
      }
    }
  }
}
```

로컬에서 `git branch -m` 후 새 이름을 push하고 옛 브랜치를 지워도 head 브랜치가 지워지는 것은 같으므로 같은 결과로 본다(이 경로는 따로 돌리지 않았다).

- **본문 언급은 거짓 양성이 된다** **[실행]**. 다른 일을 하는 PR이 본문에서 키를 언급하면(#6) 검색에 걸린다. 제목에 키가 있는 PR과 본문에만 있는 PR은 검색 결과만으로 구분할 수 없다.

### 충분한가

에이전트가 PR 제목이나 본문에 티켓 키를 쓰는 한 충분하다. 쓰지 않으면(#4) 런과 PR을 잇지 못해 "PR 없음"이 된다. 에이전트는 티켓 자체만 지시로 받으므로(GLOSSARY Agent) 오케스트레이터가 키를 쓰라고 시킬 수 없다. 이 위험은 남는다.

0037(core 인터페이스 맞추기)에 넘길 판정 규칙 제안:

1. 1순위 결과가 `OPEN` 또는 `MERGED`면 그것을 쓴다.
2. 1순위 결과가 없거나 `CLOSED`(병합 안 됨)뿐이면 2순위 검색도 돌린다. #7처럼 브랜치 이름을 바꿔 원래 PR이 닫히고 새 브랜치로 PR을 다시 연 경우, 1순위만 보면 "PR이 닫힘"으로 잘못 판정한다.
3. 2순위 후보는 런 시작 이후에 만든 PR로 좁힌다(20절 `created:>=`). 그중 제목에 키가 있는 PR을 본문에만 있는 PR보다 먼저 고르고, 같은 순위 안에서는 가장 최근 PR을 쓴다.
4. 둘 다 없으면 "PR 없음"이다.

## 18. GraphQL과 ETag/304

### GraphQL: 적용되지 않는다

- `POST /graphql` 응답에 `ETag`·`Last-Modified` 헤더가 없다 **[실행]**.
- 같은 요청에 `If-None-Match: *`를 붙여도 `200`과 본문 전체가 온다. 점수도 매번 깎인다 **[실행]**.
- `GET /graphql?query=...`은 `ETag`와 `cache-control: private, max-age=60`을 주지만, `query`를 무시하고 스키마 introspection 결과를 돌려준다 **[실행]**. 쿼리를 조건부로 보내는 수단이 아니다.

그래서 GraphQL 폴링 예산은 research 0002 C.5대로 요청마다 점수를 센다.

### REST: PR 목록은 적용된다, 검색은 안 된다

- `GET /repos/{owner}/{repo}/pulls?state=all&head=<owner>:<branch>`는 약한 ETag(`W/"..."`)를 준다. 그 값으로 `If-None-Match`를 세 번 보내자 세 번 다 `304`였고 `x-ratelimit-used`(resource `core`)가 그대로였다 **[실행]**. 304는 한도에서 빠진다.
- PR 제목을 바꾼 뒤 옛 ETag로 보내자 `200`이 왔다 **[실행]**. PR이 바뀌면 ETag가 바뀐다.
- `GET /search/issues`는 ETag를 주지 않는다. `If-None-Match`를 보내도 `200`이고 검색 한도가 매번 1씩 깎였다 **[실행]**.

런 진행 중 PR 링크를 화면에 보이려고 자주 폴링해야 한다면, REST `pulls?head=`를 ETag와 함께 쓰면 바뀌지 않은 동안 한도를 쓰지 않는다. 판정(런 종료 때 한 번)은 GraphQL 1점 쿼리로 충분하다.

### 덧붙임: `rateLimit` 값이 오락가락한다

연달아 보낸 GraphQL 요청의 `rateLimit.used`와 `x-ratelimit-used`가 `174, 175, 176, 177, 39, 40`처럼 두 계열을 오갔다 **[실행]**. 요청이 서로 다른 계수기에 닿는 것으로 보인다(원인은 확인하지 않았다). 어댑터는 두 응답 사이의 차로 점수를 계산하지 말고, 응답마다 `remaining`과 `x-ratelimit-reset`만 보고 판단한다.

## 20. 티켓 키로 PR을 찾는 쿼리

### 정한 쿼리

```graphql
query FindRunPrByTicketKey($q: String!) {
  search(query: $q, type: ISSUE_ADVANCED, first: 20) {
    issueCount
    nodes {
      ... on PullRequest {
        number
        url
        title
        body
        state
        merged
        createdAt
        headRefName
        baseRefName
        isCrossRepository
        headRepository {
          nameWithOwner
        }
      }
    }
  }
  rateLimit {
    limit
    cost
    remaining
    resetAt
  }
}
```

`$q`는 다음과 같다.

```text
repo:<owner>/<repo> is:pr "<티켓 키>" in:title,body created:>=<런 시작 시각 ISO 8601>
```

받은 뒤 어댑터가 할 일:

1. 제목·본문에서 키를 낱말 경계로 다시 찾는다. 예: 대소문자 무시 `(?<![A-Za-z0-9])ENG-123(?![A-Za-z0-9])`. 검색 문법이 바뀌거나 `ISSUE` 검색으로 돌아가도 거짓 양성(#8)이 판정까지 들어오지 않는다.
2. research 0002 C.2처럼 `isCrossRepository: false`, `headRepository.nameWithOwner`, `baseRefName`을 확인한다.
3. 검색 결과는 관련도 순이므로 `createdAt`으로 다시 정렬한 뒤 17절 규칙대로 고른다.

응답 예: [`fixtures/0006/search-by-key-advanced.json`](fixtures/0006/search-by-key-advanced.json).

### 근거

- `SearchType`에는 `ISSUE`, `ISSUE_ADVANCED`, `ISSUE_SEMANTIC`, `ISSUE_HYBRID`가 있고 모두 deprecated가 아니다 **[스키마]**.
- `ISSUE`는 키를 낱말로 쪼개 찾는다. `ENG-123`은 `ENG cleanup for 123 items`(#8)에도 걸렸고, 따옴표를 쳐도 같았다. `123`만으로도 같은 PR들이 걸렸다 **[실행]**. 응답: [`fixtures/0006/search-by-key-issue-token-match.json`](fixtures/0006/search-by-key-issue-token-match.json).
- `ISSUE_ADVANCED`에 따옴표 친 `"ENG-123"`은 #1, #6만 돌려줘 #8을 뺐다 **[실행]**. REST `/search/issues`도 `advanced_search=true`를 주면 같은 결과였고, 주지 않으면 #8까지 왔다 **[실행]**.
- 두 방식 모두 `ENG-123`이 `ENG-1234`(#5)에 걸리지 않았고, `ENG-12`는 아무것도 찾지 않았다. 대소문자는 가리지 않았다 **[실행]**.
- `created:>=2026-11-17T12:37:10Z`처럼 초 단위 시각으로 좁힐 수 있다. 그보다 먼저 만든 #1이 빠졌다 **[실행]**.
- `in:title`, `in:body`, `in:title,body`가 각각 그 위치만 찾았다 **[실행]**.

### 반영 지연

- 새 PR은 만든 지 3초 안에 검색됐다 **[실행]**.
- PR 제목에 키를 새로 넣은 뒤 검색에 걸리기까지 약 6초 걸렸다 **[실행]**.

에이전트가 PR을 열자마자 끝나면 판정 때 검색이 아직 못 찾을 수 있다. 2순위 검색이 빈 결과면 10~30초 뒤 한 번 더 찾고 "PR 없음"으로 판정한다.

### Rate limit

| 경로                                        | 한도                             | 한 번에 드는 양 | 근거                                                                                                                                      |
| ------------------------------------------- | -------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GraphQL `search` (`ISSUE`·`ISSUE_ADVANCED`) | GraphQL 5,000점/시간             | 1점             | `rateLimit.cost: 1`, 응답 헤더 `x-ratelimit-resource: graphql` **[실행]**. 40번 연달아 보내도 실패하지 않았다 **[실행]**.                 |
| REST `GET /search/issues`                   | 검색 30회/분(`resource: search`) | 1회             | 헤더 `x-ratelimit-limit: 30` **[실행]**. 31번째 요청이 `403`, `x-ratelimit-remaining: 0`, `retry-after` 없음 **[실행]**. ETag 없음(18절). |

GraphQL 검색 10번 전후로 REST 검색 한도의 `used`가 그대로였다 **[실행]**. GraphQL 검색은 REST 검색 한도와 따로 센다.

GraphQL을 고른 이유:

- 판정 쿼리(research 0002 C.2)와 같은 한도·같은 클라이언트를 쓴다.
- REST 검색은 분당 30회라, 런이 여럿 동시에 끝나거나 재시도가 겹치면 쉽게 닿는다. 닿으면 `403`이라 다른 권한 오류와 헤더로 구분해야 한다.
- 2순위 검색은 1순위가 비었거나 닫힌 PR뿐일 때만 돌므로 GraphQL 예산에 미치는 영향은 작다.

GraphQL에도 분당 2,000점 secondary limit이 있다(research 0002 C.5). 이 조사의 호출량으로는 닿지 않았다.

## 픽스처

`docs/research/fixtures/0006/`에 둔다. 값은 가상 값으로 바꿨다.

| 파일                                        | 내용                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `search-by-key-advanced.json`               | 20절 쿼리 응답. 진짜 대상(#1)과 본문 언급 거짓 양성(#6)                             |
| `search-by-key-issue-token-match.json`      | `ISSUE` 검색 응답. 낱말 일치 거짓 양성(#8)까지 포함                                 |
| `pr-by-branch-after-rename.json`            | 브랜치 이름을 바꾼 뒤 옛 이름으로 조회한 닫힌 PR. 17절 `PrByBranchAfterRename` 응답 |
| `status-check-rollup-classic-token.json`    | classic 계열 토큰의 `statusCheckRollup` 응답(15절 비교 기준)                        |
| `status-check-rollup-fine-grained-pat.json` | 읽기 권한만 준 fine-grained PAT의 `statusCheckRollup` 응답(15절, 공개 저장소)       |
| `check-status-rollup.sh`                    | 15절 확인 스크립트. 토큰은 `GITHUB_TOKEN` 환경 변수로 받는다                        |

## 남은 것

- 15: 비공개 저장소에서 fine-grained PAT로 check run이 오는지. 테스트 저장소를 잠시 비공개로 돌리고 같은 스크립트로 확인한다.
- 17의 위험: 에이전트가 PR 제목·본문에 키를 쓰지 않으면 "PR 없음"이 된다. 막을 방법은 core 판정과 함께 0037에서 정한다.

테스트 저장소의 PR은 모두 닫고 이 조사에서 만든 브랜치는 지웠다. 15절에서 만든 PR도 확인 뒤 닫고 브랜치를 지웠다.
