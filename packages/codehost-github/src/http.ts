import { AdapterError } from "@factory/core";
import type { CodeHostErrorDetail } from "@factory/core";
import { z } from "zod";

/** 이 어댑터가 던지는 오류. `detail.kind`로 인증·rate limit·없음·네트워크를 가른다. */
export class GitHubError extends AdapterError<CodeHostErrorDetail> {
  constructor(detail: CodeHostErrorDetail, options?: { cause?: unknown }) {
    super(detail, options);
    this.name = "GitHubError";
  }
}

export interface HttpOptions {
  token: string;
  /** 테스트에서 바꿔 끼운다. 기본은 전역 fetch */
  fetch?: typeof fetch;
  /** retry-after로 rate limit이 풀리는 시각을 셀 때 쓴다. 기본은 현재 시각 */
  now?: () => Date;
}

export interface RestResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

const API_URL = "https://api.github.com";
const TIMEOUT_MS = 30_000;
const USER_AGENT = "factory-orchestrator";

const graphqlErrors = z.array(
  z.object({
    type: z.string().optional(),
    message: z.string(),
    path: z.array(z.union([z.string(), z.number()])).optional(),
  }),
);

const graphqlEnvelope = z.object({
  data: z.unknown().optional(),
  errors: graphqlErrors.optional(),
});

export type GraphqlError = z.infer<typeof graphqlErrors>[number];

/**
 * GitHub GraphQL·REST 호출과 오류 분류를 한 곳에 둔다(research 0002 C.5, research 0006).
 *
 * - 401 → unauthorized
 * - 429 → rate-limited. 403은 `x-ratelimit-remaining: 0`이나 `retry-after`가 있거나 본문이 rate limit을
 *   말하면 → rate-limited, 그 밖의 403 → unauthorized
 * - GraphQL은 한도를 넘어도 200에 `RATE_LIMITED` 오류가 온다 → rate-limited
 * - 연결 실패, 시간 초과, 5xx, 읽을 수 없는 응답 → network(코드 호스트에서 쓸 수 있는 답을 받지 못함)
 */
export class GitHubHttp {
  private readonly token: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => Date;

  constructor(options: HttpOptions) {
    this.token = options.token;
    this.fetchFn = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * GraphQL 쿼리를 보내고 `data`를 스키마로 파싱한다. 오류 목록도 함께 돌려줘 부른 쪽이
   * `NOT_FOUND` 같은 부분 오류를 해석하게 한다. rate limit 오류는 여기서 던진다.
   */
  async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<{ data: T; errors: ReadonlyArray<GraphqlError> }> {
    const res = await this.send(
      `${API_URL}/graphql`,
      "POST",
      { "content-type": "application/json" },
      JSON.stringify({ query, variables }),
    );
    if (res.status !== 200) throw this.httpError(res);

    const envelope = graphqlEnvelope.safeParse(res.body);
    if (!envelope.success) throw malformed(envelope.error);
    const errors = envelope.data.errors ?? [];
    if (errors.some((e) => e.type === "RATE_LIMITED")) {
      throw new GitHubError({ kind: "rate-limited", resetAt: this.resetAt(res.headers) });
    }
    const data = schema.safeParse(envelope.data.data);
    if (!data.success) {
      // data가 없고 오류만 왔으면 오류 종류로 가른다.
      if (errors.some((e) => e.type === "FORBIDDEN")) {
        throw new GitHubError({ kind: "unauthorized" });
      }
      throw malformed(errors.length > 0 ? errors : data.error);
    }
    return { data: data.data, errors };
  }

  /** REST GET. 응답 상태 코드를 해석하지 않고 돌려준다. 연결 실패만 던진다. */
  async get(path: string): Promise<RestResponse> {
    return this.send(`${API_URL}${path}`, "GET", {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    });
  }

  /** 2xx가 아닌 응답을 오류로 바꾼다. */
  httpError(res: RestResponse): GitHubError {
    if (res.status === 401) return new GitHubError({ kind: "unauthorized" });
    if (res.status === 429 || res.status === 403) {
      // 429는 언제나 한도 초과다. secondary limit의 403은 헤더 없이 본문으로만 알릴 수 있다(research 0002 C.5).
      if (res.status === 429 || isRateLimited(res.headers) || mentionsRateLimit(res.body)) {
        return new GitHubError({ kind: "rate-limited", resetAt: this.resetAt(res.headers) });
      }
      return new GitHubError({ kind: "unauthorized" });
    }
    if (res.status === 404) return new GitHubError({ kind: "not-found" });
    return new GitHubError({ kind: "network", cause: new Error(`HTTP ${res.status}`) });
  }

  private async send(
    url: string,
    method: "GET" | "POST",
    headers: Record<string, string>,
    body?: string,
  ): Promise<RestResponse> {
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers: { ...headers, authorization: `bearer ${this.token}`, "user-agent": USER_AGENT },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (cause) {
      throw new GitHubError({ kind: "network", cause }, { cause });
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch (cause) {
      // 본문이 JSON이 아니어도 상태 코드로 가를 수 있으면 그것을 쓴다(예: 502 HTML).
      if (response.ok) throw new GitHubError({ kind: "network", cause }, { cause });
    }
    return { status: response.status, headers: response.headers, body: json };
  }

  /** `retry-after`(초)가 있으면 그것을, 없으면 `x-ratelimit-reset`(UTC epoch 초)를 쓴다. */
  private resetAt(headers: Headers): Date | null {
    const retryAfter = numberHeader(headers, "retry-after");
    if (retryAfter !== null) return new Date(this.now().getTime() + retryAfter * 1000);
    const reset = numberHeader(headers, "x-ratelimit-reset");
    return reset === null ? null : new Date(reset * 1000);
  }
}

function isRateLimited(headers: Headers): boolean {
  return headers.get("x-ratelimit-remaining") === "0" || headers.has("retry-after");
}

function mentionsRateLimit(body: unknown): boolean {
  const parsed = z.object({ message: z.string() }).safeParse(body);
  return parsed.success && /rate limit/i.test(parsed.data.message);
}

function numberHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function malformed(cause: unknown): GitHubError {
  return new GitHubError({ kind: "network", cause }, { cause });
}
