import { describe, expect, it } from "vitest";
import { MutationRejectedError } from "./mutation-error";
import { createQueryClient } from "./query-client";
import { REQUEST_ID_RETRY_WINDOW_MS, withRunActionRequestId } from "./run-action-request-ids";

const RUN = "run-1";

function recorder() {
  const seen: string[] = [];
  return {
    seen,
    ok: (requestId: string) => {
      seen.push(requestId);
      return Promise.resolve("ok");
    },
    lost: (requestId: string) => {
      seen.push(requestId);
      return Promise.reject(new Error("network"));
    },
    rejected: (requestId: string) => {
      seen.push(requestId);
      return Promise.reject(new MutationRejectedError("not-cancelable"));
    },
  };
}

describe("런 동작 요청 ID", () => {
  it("응답을 못 받아 다시 보내면 같은 ID를 쓴다", async () => {
    const client = createQueryClient();
    const calls = recorder();
    await expect(withRunActionRequestId(client, RUN, "cancel", calls.lost)).rejects.toThrow(
      "network",
    );
    await withRunActionRequestId(client, RUN, "cancel", calls.ok);

    expect(calls.seen[0]).toBe(calls.seen[1]);
    expect(calls.seen[0]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("성공한 뒤의 같은 동작은 새 요청이라 새 ID를 쓴다", async () => {
    const client = createQueryClient();
    const calls = recorder();
    await withRunActionRequestId(client, RUN, "control:pause", calls.ok);
    await withRunActionRequestId(client, RUN, "control:pause", calls.ok);

    expect(calls.seen[0]).not.toBe(calls.seen[1]);
  });

  it("서버가 거절하면 ID를 버린다", async () => {
    const client = createQueryClient();
    const calls = recorder();
    await expect(withRunActionRequestId(client, RUN, "cancel", calls.rejected)).rejects.toThrow(
      "mutation rejected",
    );
    await withRunActionRequestId(client, RUN, "cancel", calls.ok);

    expect(calls.seen[0]).not.toBe(calls.seen[1]);
  });

  it("응답을 못 받은 멈추기 뒤에 재개가 성공하면, 다음 멈추기는 새 ID를 쓴다", async () => {
    const client = createQueryClient();
    const calls = recorder();
    await expect(withRunActionRequestId(client, RUN, "control:pause", calls.lost)).rejects.toThrow(
      "network",
    );
    await withRunActionRequestId(client, RUN, "control:resume", calls.ok);
    await withRunActionRequestId(client, RUN, "control:pause", calls.ok);

    expect(calls.seen[2]).not.toBe(calls.seen[0]);
  });

  it("다시 보내는 시간이 지나면 새 ID를 쓴다", async () => {
    const client = createQueryClient();
    const calls = recorder();
    await expect(withRunActionRequestId(client, RUN, "cancel", calls.lost, 1_000)).rejects.toThrow(
      "network",
    );
    await withRunActionRequestId(
      client,
      RUN,
      "cancel",
      calls.ok,
      1_000 + REQUEST_ID_RETRY_WINDOW_MS,
    );

    expect(calls.seen[0]).not.toBe(calls.seen[1]);
  });

  it("런이 다르면 ID를 함께 쓰지 않는다", async () => {
    const client = createQueryClient();
    const calls = recorder();
    await expect(withRunActionRequestId(client, RUN, "cancel", calls.lost)).rejects.toThrow(
      "network",
    );
    await withRunActionRequestId(client, "run-2", "cancel", calls.ok);

    expect(calls.seen[0]).not.toBe(calls.seen[1]);
  });
});
