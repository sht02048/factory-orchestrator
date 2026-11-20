import { describe, expect, it } from "vitest";
import { parseTailnetStatus, readThisTailnetDevice } from "./tailscale.js";
import type { TailnetDeps } from "./tailscale.js";

const CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

function deps(output: string | undefined, installed = true): TailnetDeps & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    env: {},
    exists: (path) => installed && path === CLI,
    run: (file, args) => {
      calls.push([file, ...args]);
      return Promise.resolve(output);
    },
  };
}

const running = (self: unknown) =>
  JSON.stringify({ BackendState: "Running", Self: self, Peer: {} });

describe("이 기기의 Tailscale 이름", () => {
  it("Self.DNSName 끝의 점을 떼고 소문자로 읽는다", async () => {
    const status = deps(running({ DNSName: "Server.Example.ts.net." }));
    await expect(readThisTailnetDevice(status)).resolves.toEqual({
      cli: CLI,
      host: "server.example.ts.net",
    });
    expect(status.calls).toEqual([[CLI, "status", "--json"]]);
  });

  it("Tailscale 이 없으면 묻지 않고 비운다", async () => {
    const status = deps(running({ DNSName: "server.example.ts.net." }), false);
    await expect(readThisTailnetDevice(status)).resolves.toBeNull();
    expect(status.calls).toEqual([]);
  });

  it("명령이 실패하거나 시간을 넘기면 비운다", async () => {
    await expect(readThisTailnetDevice(deps(undefined))).resolves.toBeNull();
  });

  it("멈춰 있거나 이상한 출력이면 비운다", async () => {
    await expect(
      readThisTailnetDevice(deps(JSON.stringify({ BackendState: "Stopped" }))),
    ).resolves.toBeNull();
    await expect(readThisTailnetDevice(deps("not json"))).resolves.toBeNull();
    await expect(readThisTailnetDevice(deps(JSON.stringify([1, 2])))).resolves.toBeNull();
  });

  it("Self 가 없거나 이름이 주소로 쓸 수 없는 모양이면 비운다", async () => {
    await expect(readThisTailnetDevice(deps(running(undefined)))).resolves.toBeNull();
    await expect(readThisTailnetDevice(deps(running("weird")))).resolves.toBeNull();
    await expect(readThisTailnetDevice(deps(running({ DNSName: "" })))).resolves.toBeNull();
    await expect(
      readThisTailnetDevice(deps(running({ DNSName: "evil.example.ts.net/path." }))),
    ).resolves.toBeNull();
    await expect(
      readThisTailnetDevice(deps(running({ DNSName: "localhost." }))),
    ).resolves.toBeNull();
  });

  it("Self 가 이상해도 다른 기기 목록은 읽는다", () => {
    const status = JSON.stringify({
      BackendState: "Running",
      Self: 7,
      Peer: { a: { HostName: "box", DNSName: "box.example.ts.net.", Online: true } },
    });
    expect(parseTailnetStatus(status)).toEqual({
      kind: "running",
      self: null,
      devices: [{ name: "box", host: "box.example.ts.net" }],
    });
  });
});
