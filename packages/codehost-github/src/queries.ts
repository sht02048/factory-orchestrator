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

export const PULL_REQUESTS_BY_BRANCH = `query PullRequestsByBranch($owner: String!, $repo: String!, $branch: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(headRefName: $branch, first: 10, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes {${PULL_REQUEST_FIELDS}}
    }
  }${RATE_LIMIT}}`;

export const PULL_REQUESTS_BY_SEARCH = `query PullRequestsBySearch($q: String!) {
  search(query: $q, type: ISSUE_ADVANCED, first: 20) {
    issueCount
    nodes {
      __typename
      ... on PullRequest {${PULL_REQUEST_FIELDS}}
    }
  }${RATE_LIMIT}}`;

export const PULL_REQUEST_BY_NUMBER = `query PullRequestByNumber($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {${PULL_REQUEST_FIELDS}}
  }${RATE_LIMIT}}`;

export const VIEWER = `query Viewer {
  viewer {
    login
  }${RATE_LIMIT}}`;

export const RATE_LIMIT_ONLY = `query RateLimit {${RATE_LIMIT}}`;
