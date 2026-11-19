import { describe, expect, it } from "vitest";
import { hermesConfig, jsonConfig, mcpLaunch } from "./mcp-launch.js";

const desktop = mcpLaunch({
  nodePath: "/Applications/Ganger.app/Contents/MacOS/Ganger",
  cliEntry: "/Applications/Ganger.app/Contents/Resources/server/cli/bin/cli.js",
  home: "/Users/operator/.ganger",
  electron: true,
});

describe("MCP 클라이언트 설정 조각", () => {
  it("앱 안 CLI의 절대 경로로 ganger mcp를 띄우고, 데스크톱 앱이면 Node로 돌게 한다", () => {
    expect(desktop).toEqual({
      located: true,
      command: "/Applications/Ganger.app/Contents/MacOS/Ganger",
      args: [
        "/Applications/Ganger.app/Contents/Resources/server/cli/bin/cli.js",
        "mcp",
        "--home",
        "/Users/operator/.ganger",
      ],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
  });

  it("CLI 위치를 모르면 PATH의 ganger를 쓴다", () => {
    expect(
      mcpLaunch({
        nodePath: "/usr/bin/node",
        cliEntry: undefined,
        home: undefined,
        electron: false,
      }),
    ).toEqual({ located: false, command: "ganger", args: ["mcp"], env: {} });
  });

  it("Hermes config.yaml의 mcp_servers 형식으로 쓴다", () => {
    expect(hermesConfig(desktop)).toBe(
      [
        "mcp_servers:",
        "  ganger:",
        '    command: "/Applications/Ganger.app/Contents/MacOS/Ganger"',
        "    args:",
        '      - "/Applications/Ganger.app/Contents/Resources/server/cli/bin/cli.js"',
        '      - "mcp"',
        '      - "--home"',
        '      - "/Users/operator/.ganger"',
        "    env:",
        '      ELECTRON_RUN_AS_NODE: "1"',
      ].join("\n"),
    );
  });

  it("다른 클라이언트용 JSON은 mcpServers 형식이고, 환경 변수가 없으면 env를 뺀다", () => {
    const plain = mcpLaunch({
      nodePath: "/usr/local/bin/node",
      cliEntry: "/opt/ganger/cli/bin/cli.js",
      home: "/srv/ganger home",
      electron: false,
    });
    expect(JSON.parse(jsonConfig(plain))).toEqual({
      mcpServers: { ganger: { command: plain.command, args: plain.args } },
    });
    expect(hermesConfig(plain)).not.toContain("env:");
    expect(hermesConfig(plain)).toContain('      - "/srv/ganger home"');
  });
});
