import { describe, expect, it } from "vitest";
import { openLog } from "./open-log.js";
import type { OpenLogDeps } from "./open-log.js";

function fakeShell(options: { files: string[]; openError?: string }) {
  const calls: string[] = [];
  const deps: OpenLogDeps = {
    exists: (path) => options.files.includes(path),
    openPath: (path) => {
      calls.push(`open ${path}`);
      return Promise.resolve(options.openError ?? "");
    },
    showItemInFolder: (path) => {
      calls.push(`show ${path}`);
    },
  };
  return { deps, calls };
}

describe("로그 열기", () => {
  it("로그 파일이 있으면 그 파일을 연다", async () => {
    const { deps, calls } = fakeShell({ files: ["/home/logs/server.log"] });
    await openLog("/home/logs/server.log", deps);
    expect(calls).toEqual(["open /home/logs/server.log"]);
  });

  it("파일을 열 앱이 없으면 Finder 에서 파일을 보인다", async () => {
    const { deps, calls } = fakeShell({
      files: ["/home/logs/server.log"],
      openError: "no app",
    });
    await openLog("/home/logs/server.log", deps);
    expect(calls).toEqual(["open /home/logs/server.log", "show /home/logs/server.log"]);
  });

  it("서버가 로그를 쓰기 전에 실패해 파일이 없으면 로그 폴더를 연다", async () => {
    const { deps, calls } = fakeShell({ files: [] });
    await openLog("/home/logs/server.log", deps);
    expect(calls).toEqual(["open /home/logs"]);
  });
});
