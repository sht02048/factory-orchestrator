import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * 테스트 픽스처. `src/fixtures/*.json`은 이 티켓이 테스트 토큰으로 받은 응답을 가상 값(`acme/app`, 커밋 SHA,
 * 사용자 ID)으로 바꾼 것이고 `{ status, headers, body }` 꼴이다. research 0006(티켓 0012) 픽스처는 본문만
 * 있어 200으로 감싼다.
 */
const recorded = z.object({
  status: z.number(),
  headers: z.record(z.string(), z.string()),
  body: z.unknown(),
});
export type Recorded = z.infer<typeof recorded>;

export function fixture(name: string): Recorded {
  const url = new URL(`./fixtures/${name}.json`, import.meta.url);
  return recorded.parse(JSON.parse(readFileSync(url, "utf8")));
}

export function researchFixture(name: string): Recorded {
  const url = new URL(`../../../docs/research/fixtures/0006/${name}.json`, import.meta.url);
  const body: unknown = JSON.parse(readFileSync(url, "utf8"));
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

export interface SentRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** GraphQL 요청이면 쿼리와 변수 */
  graphql: { query: string; variables: Record<string, unknown> } | null;
}

const graphqlBody = z.object({ query: z.string(), variables: z.record(z.string(), z.unknown()) });

/**
 * 요청마다 handler가 고른 픽스처로 답하는 가짜 fetch. 보낸 요청을 `sent`에 모은다.
 * handler가 Error를 돌려주면 연결 실패처럼 던진다.
 */
export function fakeFetch(handler: (req: SentRequest) => Recorded | Error): {
  fetch: typeof fetch;
  sent: SentRequest[];
} {
  const sent: SentRequest[] = [];
  const fn = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers = z.record(z.string(), z.string()).parse(init?.headers ?? {});
    const body = typeof init?.body === "string" ? graphqlBody.parse(JSON.parse(init.body)) : null;
    const req: SentRequest = {
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? "GET",
      headers,
      graphql: body,
    };
    sent.push(req);
    const answer = handler(req);
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), { status: answer.status, headers: answer.headers }),
    );
  };
  return { fetch: fn, sent };
}

/** GraphQL 요청과 REST Actions 요청에 각각 답한다. */
export function route(answers: {
  graphql: Recorded | ((req: SentRequest) => Recorded | Error) | Error;
  actions?: Recorded | ((req: SentRequest) => Recorded | Error) | Error;
}): (req: SentRequest) => Recorded | Error {
  const pick = (
    answer: Recorded | ((req: SentRequest) => Recorded | Error) | Error | undefined,
    req: SentRequest,
  ): Recorded | Error => {
    if (answer === undefined) return new Error(`unexpected request ${req.url}`);
    return typeof answer === "function" ? answer(req) : answer;
  };
  return (req) =>
    req.url.endsWith("/graphql") ? pick(answers.graphql, req) : pick(answers.actions, req);
}
