import { describe, expect, it } from "vitest";
import type { ActionResult, SubmitState } from "../settings/settings-screen";
import { createSerialSaver } from "./serial-save";

function deferred() {
  let resolve: (result: ActionResult) => void = () => {};
  const promise = new Promise<ActionResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness() {
  let saved = "none";
  let shown = "none";
  const sent: string[] = [];
  const replies = new Map<string, ReturnType<typeof deferred>>();
  const states: SubmitState["kind"][] = [];
  let saves = 0;
  const saver = createSerialSaver<string>({
    send: (value) => {
      sent.push(value);
      const reply = deferred();
      replies.set(value, reply);
      return reply.promise;
    },
    revert: () => {
      shown = saved;
    },
    onState: (state) => states.push(state.kind),
    onSaved: () => {
      saves += 1;
    },
  });
  return {
    choose: (value: string) => {
      shown = value;
      saver.choose(value);
    },
    reply: (value: string, result: ActionResult) => {
      if (result.ok) saved = value;
      replies.get(value)?.resolve(result);
    },
    sent,
    states,
    shown: () => shown,
    saves: () => saves,
  };
}

describe("한 줄의 자동 저장은 한 번에 하나씩 보낸다", () => {
  it("A 저장이 끝나기 전에 고른 B는 A 뒤에 보내고, B가 실패하면 저장된 A로 되돌린다", async () => {
    const h = harness();
    h.choose("A");
    h.choose("B");
    await flush();
    expect(h.sent).toEqual(["A"]);

    h.reply("A", { ok: true });
    await flush();
    expect(h.sent).toEqual(["A", "B"]);
    expect(h.shown()).toBe("B");

    h.reply("B", { ok: false, reason: "network" });
    await flush();
    expect(h.shown()).toBe("A");
    expect(h.states.at(-1)).toBe("failed");
    expect(h.saves()).toBe(1);
  });

  it("보내는 동안 여러 번 고르면 마지막으로 고른 값만 이어서 보낸다", async () => {
    const h = harness();
    h.choose("A");
    h.choose("B");
    h.choose("C");
    await flush();
    h.reply("A", { ok: true });
    await flush();
    expect(h.sent).toEqual(["A", "C"]);
    h.reply("C", { ok: true });
    await flush();
    expect(h.shown()).toBe("C");
    expect(h.states.at(-1)).toBe("idle");
  });

  it("앞 요청이 실패해도 뒤에 고른 값이 있으면 되돌리지 않고 그 값을 보낸다", async () => {
    const h = harness();
    h.choose("A");
    h.choose("B");
    await flush();
    h.reply("A", { ok: false, reason: "network" });
    await flush();
    expect(h.sent).toEqual(["A", "B"]);
    expect(h.shown()).toBe("B");
    expect(h.states).not.toContain("failed");
  });

  it("보내기나 저장 알림이 바로 예외를 던져도 다음 고른 값을 보낸다", async () => {
    const sent: string[] = [];
    const states: string[] = [];
    let shown = "none";
    const saver = createSerialSaver<string>({
      send: (value) => {
        sent.push(value);
        if (value === "boom") throw new Error("send failed");
        return Promise.resolve({ ok: true });
      },
      revert: () => {
        shown = "none";
      },
      onState: (state) => states.push(state.kind),
      onSaved: () => {
        if (sent.length === 2) throw new Error("announce failed");
      },
    });
    saver.choose("boom");
    await flush();
    expect(states.at(-1)).toBe("failed");
    expect(shown).toBe("none");

    saver.choose("A");
    await flush();
    saver.choose("B");
    await flush();
    expect(sent).toEqual(["boom", "A", "B"]);
    expect(states.at(-1)).toBe("idle");
  });
});
