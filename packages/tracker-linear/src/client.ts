import { AdapterError } from "@factory/core";
import type { TrackerErrorDetail } from "@factory/core";
import { z } from "zod";

export const LINEAR_API_URL = "https://api.linear.app/graphql";

const REQUEST_TIMEOUT_MS = 30_000;

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export class LinearTrackerError extends AdapterError<TrackerErrorDetail> {
  constructor(detail: TrackerErrorDetail, options?: { cause?: unknown }) {
    super(detail, options);
    this.name = "LinearTrackerError";
  }
}

export class LinearApiError extends Error {
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

export function connectionSchema<T extends z.ZodType>(node: T) {
  return z.object({
    nodes: z.array(node),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().nullable(),
    }),
  });
}
