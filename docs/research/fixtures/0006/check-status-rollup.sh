#!/usr/bin/env bash
# 티켓 0012 항목 15: fine-grained PAT로 GraphQL statusCheckRollup이 check run 결과까지 오는지 확인한다.
#
# 쓰는 법:
#   GITHUB_TOKEN=<fine-grained PAT> ./check-status-rollup.sh <owner> <repo> <pr-number>
#
# PAT 권한: Metadata, Pull requests, Commit statuses 읽기만 준다(research 0002 C.4).
# 대상 PR은 GitHub Actions 같은 check run이 끝난 커밋을 head로 가져야 한다.
# 토큰 값은 출력하지 않는다.
set -euo pipefail

if [ $# -ne 3 ] || [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "usage: GITHUB_TOKEN=... $0 <owner> <repo> <pr-number>" >&2
  exit 2
fi

owner="$1" repo="$2" number="$3"

query='query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number
      state
      commits(last: 1) {
        nodes {
          commit {
            oid
            statusCheckRollup {
              state
              contexts(first: 20) {
                totalCount
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion }
                  ... on StatusContext { context state }
                }
              }
            }
          }
        }
      }
    }
  }
  rateLimit { cost remaining }
}'

body=$(jq -n --arg q "$query" --arg owner "$owner" --arg repo "$repo" --argjson number "$number" \
  '{query: $q, variables: {owner: $owner, repo: $repo, number: $number}}')

curl -sS -X POST https://api.github.com/graphql \
  -H "Authorization: bearer ${GITHUB_TOKEN}" \
  -H "Content-Type: application/json" \
  -D /dev/stderr \
  -d "$body" 2> >(grep -iE '^(HTTP|x-accepted-github-permissions|x-ratelimit-)' >&2) | jq .

# 읽는 법:
# - contexts.nodes에 __typename "CheckRun"이 status/conclusion과 함께 오면 15번은 "온다"다.
# - statusCheckRollup이 null이거나, CheckRun 노드 없이 StatusContext만 오거나,
#   errors에 FORBIDDEN이 있으면 "check run은 안 온다"다. 이때 응답과
#   x-accepted-github-permissions 헤더를 research 0006 15절에 적는다.
