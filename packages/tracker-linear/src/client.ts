import { AdapterError } from "@factory/core";
import type { TrackerErrorDetail } from "@factory/core";
import { z } from "zod";

/**
 * Linear GraphQL API 호출과 오류 분류(research 0002 B.4, 이 패키지의 픽스처).
 *
 * - 인증 실패, rate limit, 없는 대상, 네트워크 오류는 core의 오류 종류(AdapterError)로 던진다.
 * - 그 밖의 GraphQL 오류(잘못된 입력 등)와 모양이 다른 응답은 LinearApiError로 던진다. core의 오류 종류가
 *   아니므로 부르는 쪽은 알 수 없는 실패로 다룬다.
 */

export const LINEAR_API_URL = "https://api.linear.app/graphql";

/** 요청 하나를 기다리는 최대 시간. 넘기면 네트워크 오류다. */
const REQUEST_TIMEOUT_MS = 30_000;

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** 이 패키지가 core 오류 종류로 던지는 오류. instanceof로 detail 타입을 그대로 얻는다. */
export class LinearTrackerError extends AdapterError<TrackerErrorDetail> {
  constructor(detail: TrackerErrorDetail, options?: { cause?: unknown }) {
    super(detail, options);
    this.name = "LinearTrackerError";
  }
}

/** core 오류 종류에 들지 않는 Linear API 오류 */
export class LinearApiError extends Error {
  /** `errors[].extensions.code`. 없으면 null */
  readonly code: string | null;
  readonly status: number;

  constructor(message: string, input: { code: string | null; status: number; cause?: unknown }) {
    super(message, { cause: input.cause });
    this.name = "LinearApiError";
    this.code = input.code;
    this.status = input.status;
  }
}

const graphQLErrorSchema = z.object({
  message: z.string(),
  extensions: z.object({ code: z.string().optional() }).loose().optional(),
});

const responseSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(graphQLErrorSchema).optional(),
});

type GraphQLError = z.infer<typeof graphQLErrorSchema>;

export class LinearClient {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly fetch: Fetch;

  constructor(input: { apiKey: string; apiUrl?: string; fetch?: Fetch }) {
    this.apiKey = input.apiKey;
    this.apiUrl = input.apiUrl ?? LINEAR_API_URL;
    this.fetch = input.fetch ?? ((url, init) => fetch(url, init));
  }

  /** 쿼리 하나를 보내고 `data`를 스키마로 파싱해 돌려준다. */
  async request<T>(
    query: string,
    variables: Readonly<Record<string, unknown>>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // 개인 API 키는 Bearer 없이 그대로 보낸다(research 0002 B.1).
          authorization: this.apiKey,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new LinearTrackerError({ kind: "network", cause }, { cause });
    }

    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      throw new LinearTrackerError({ kind: "network", cause }, { cause });
    }

    const parsed = responseSchema.safeParse(parseJson(text));
    const errors = parsed.success ? (parsed.data.errors ?? []) : [];

    const detail = classify(response, errors);
    if (detail !== null) throw new LinearTrackerError(detail);

    if (!parsed.success) {
      throw new LinearApiError(
        `Linear 응답이 GraphQL 응답 모양이 아니다(HTTP ${response.status})`,
        {
          code: null,
          status: response.status,
        },
      );
    }
    const [first] = errors;
    if (first !== undefined) {
      throw new LinearApiError(first.message, {
        code: first.extensions?.code ?? null,
        status: response.status,
      });
    }
    if (!response.ok) {
      throw new LinearApiError(`Linear 응답 HTTP ${response.status}`, {
        code: null,
        status: response.status,
      });
    }

    const data = schema.safeParse(parsed.data.data);
    if (!data.success) {
      throw new LinearApiError("Linear 응답의 data가 예상한 모양이 아니다", {
        code: null,
        status: response.status,
        cause: data.error,
      });
    }
    return data.data;
  }
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * 응답을 core 오류 종류로 가른다. 어디에도 들지 않으면 null이다.
 *
 * - 인증: HTTP 401·403 또는 `AUTHENTICATION_ERROR`·`FORBIDDEN`(픽스처 `error-unauthorized`).
 * - rate limit: HTTP 429 또는 `RATELIMITED`, 기다릴 시간은 `Retry-After`(초)(research 0002 B.4).
 * - 없는 대상: `INPUT_ERROR`이면서 메시지가 "not found"를 담음. Linear는 없는 티켓·트래커 프로젝트·상태를
 *   모두 이렇게 알린다(픽스처 `error-*-not-found`).
 * - 네트워크: HTTP 5xx. 응답을 받지 못한 경우는 request가 따로 던진다.
 */
function classify(
  response: Response,
  errors: ReadonlyArray<GraphQLError>,
): TrackerErrorDetail | null {
  const codes = errors.map((error) => error.extensions?.code);
  if (
    response.status === 401 ||
    response.status === 403 ||
    codes.includes("AUTHENTICATION_ERROR") ||
    codes.includes("FORBIDDEN")
  ) {
    return { kind: "unauthorized" };
  }
  if (response.status === 429 || codes.includes("RATELIMITED")) {
    return { kind: "rate-limited", retryAfterSeconds: retryAfterSeconds(response.headers) };
  }
  if (
    errors.some(
      (error) => error.extensions?.code === "INPUT_ERROR" && /not found/i.test(error.message),
    )
  ) {
    return { kind: "not-found" };
  }
  if (response.status >= 500) {
    return {
      kind: "network",
      cause: new Error(`Linear 응답 HTTP ${response.status}`),
    };
  }
  return null;
}

function retryAfterSeconds(headers: Headers): number | null {
  const value = headers.get("retry-after");
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** Relay connection 한 쪽. */
export function connectionSchema<T extends z.ZodType>(node: T) {
  return z.object({
    nodes: z.array(node),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().nullable(),
    }),
  });
}
