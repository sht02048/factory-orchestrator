/**
 * GitHub GraphQL 쿼리. 모양은 research 0002 C.2(`RunPr`)와 research 0006 20절(`FindRunPrByTicketKey`)을
 * 따르고, core `PullRequestSnapshot`을 채우려고 필드를 더했다. 모두 1점 쿼리다.
 */

const PULL_REQUEST_FIELDS = `
  number
  url
  title
  body
  state
  createdAt
  mergedAt
  headRefName
  headRefOid
  baseRefName
  isCrossRepository
  headRepository {
    nameWithOwner
  }
`;

const RATE_LIMIT = `
  rateLimit {
    limit
    cost
    remaining
    resetAt
  }
`;

/** 브랜치로 PR 찾기(1순위). 최신순이다. */
export const PULL_REQUESTS_BY_BRANCH = `query PullRequestsByBranch($owner: String!, $repo: String!, $branch: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(headRefName: $branch, first: 10, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes {${PULL_REQUEST_FIELDS}}
    }
  }${RATE_LIMIT}}`;

/** 티켓 키로 PR 찾기(2순위). `$q`는 `searchQuery`로 만든다. */
export const PULL_REQUESTS_BY_SEARCH = `query PullRequestsBySearch($q: String!) {
  search(query: $q, type: ISSUE_ADVANCED, first: 20) {
    issueCount
    nodes {
      __typename
      ... on PullRequest {${PULL_REQUEST_FIELDS}}
    }
  }${RATE_LIMIT}}`;

/** PR 번호로 하나 조회. 이후 PR 상태와 CI 상태 폴링에 쓴다. */
export const PULL_REQUEST_BY_NUMBER = `query PullRequestByNumber($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {${PULL_REQUEST_FIELDS}}
  }${RATE_LIMIT}}`;

/** 연결 확인. 토큰이 맞으면 viewer가 온다. */
export const VIEWER = `query Viewer {
  viewer {
    login
  }${RATE_LIMIT}}`;

/** 남은 요청 예산. */
export const RATE_LIMIT_ONLY = `query RateLimit {${RATE_LIMIT}}`;
