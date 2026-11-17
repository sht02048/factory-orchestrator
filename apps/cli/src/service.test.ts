import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ServiceError,
  detectServiceManager,
  formatCommand,
  installService,
  servicePlan,
  uninstallService,
} from "./service.js";
import type { CommandRunner, ServiceContext } from "./service.js";

const base: Omit<ServiceContext, "manager"> = {
  userHome: "/home/acme",
  uid: 501,
  nodePath: "/opt/node/bin/node",
  cliEntry: "/opt/factory-orchestrator/dist/bin/cli.js",
  factoryHome: "/home/acme/.factory-orchestrator",
  path: "/opt/node/bin:/usr/local/bin:/usr/bin:/bin",
};

describe("servicePlan", () => {
  it("launchd 사용자 에이전트 plist를 만든다", () => {
    const plan = servicePlan({ ...base, manager: "launchd" });
    expect(plan.file.path).toBe("/home/acme/Library/LaunchAgents/factory-orchestrator.plist");
    expect(plan.directories).toEqual([
      "/home/acme/Library/LaunchAgents",
      "/home/acme/.factory-orchestrator/logs",
    ]);
    expect(plan.install).toEqual([
      [
        "launchctl",
        "bootstrap",
        "gui/501",
        "/home/acme/Library/LaunchAgents/factory-orchestrator.plist",
      ],
    ]);
    expect(plan.stop).toEqual([["launchctl", "bootout", "gui/501/factory-orchestrator"]]);
    expect(plan.cleanup).toEqual([]);
    expect(plan.file.contents).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
      <dict>
        <key>Label</key>
        <string>factory-orchestrator</string>
        <key>ProgramArguments</key>
        <array>
          <string>/opt/node/bin/node</string>
          <string>/opt/factory-orchestrator/dist/bin/cli.js</string>
          <string>start</string>
          <string>--home</string>
          <string>/home/acme/.factory-orchestrator</string>
        </array>
        <key>EnvironmentVariables</key>
        <dict>
          <key>PATH</key>
          <string>/opt/node/bin:/usr/local/bin:/usr/bin:/bin</string>
        </dict>
        <key>RunAtLoad</key>
        <true/>
        <key>KeepAlive</key>
        <dict>
          <key>SuccessfulExit</key>
          <false/>
        </dict>
        <key>ThrottleInterval</key>
        <integer>10</integer>
        <key>StandardOutPath</key>
        <string>/home/acme/.factory-orchestrator/logs/factory-orchestrator.log</string>
        <key>StandardErrorPath</key>
        <string>/home/acme/.factory-orchestrator/logs/factory-orchestrator.log</string>
      </dict>
      </plist>
      "
    `);
  });

  it("systemd 사용자 서비스 unit을 만든다", () => {
    const plan = servicePlan({ ...base, manager: "systemd" });
    expect(plan.file.path).toBe("/home/acme/.config/systemd/user/factory-orchestrator.service");
    expect(plan.directories).toEqual(["/home/acme/.config/systemd/user"]);
    expect(plan.install).toEqual([
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "enable", "--now", "factory-orchestrator.service"],
    ]);
    expect(plan.stop).toEqual([
      ["systemctl", "--user", "disable", "--now", "factory-orchestrator.service"],
    ]);
    expect(plan.cleanup).toEqual([["systemctl", "--user", "daemon-reload"]]);
    expect(plan.file.contents).toMatchInlineSnapshot(`
      "[Unit]
      Description=factory-orchestrator (web and worker)

      [Service]
      Type=simple
      ExecStart="/opt/node/bin/node" "/opt/factory-orchestrator/dist/bin/cli.js" "start" "--home" "/home/acme/.factory-orchestrator"
      Environment="PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin"
      Restart=on-failure
      RestartSec=10
      KillMode=mixed
      TimeoutStopSec=30

      [Install]
      WantedBy=default.target
      "
    `);
  });

  it("XDG_CONFIG_HOME이 있으면 그 아래에 둔다", () => {
    const plan = servicePlan({ ...base, manager: "systemd", xdgConfigHome: "/srv/config" });
    expect(plan.file.path).toBe("/srv/config/systemd/user/factory-orchestrator.service");
  });

  it("경로의 특수 문자를 서비스 파일 문법에 맞게 감싼다", () => {
    const home = '/home/a&b <c> "d" 100%$x';
    const launchd = servicePlan({ ...base, manager: "launchd", factoryHome: home });
    expect(launchd.file.contents).toContain(
      "<string>/home/a&amp;b &lt;c&gt; &quot;d&quot; 100%$x</string>",
    );
    const systemd = servicePlan({ ...base, manager: "systemd", factoryHome: home });
    expect(systemd.file.contents).toContain(String.raw`"--home" "/home/a&b <c> \"d\" 100%%$$x"`);
  });
});

describe("detectServiceManager", () => {
  it("macOS는 launchd, Linux는 systemd, 그 밖은 지원하지 않는다", () => {
    expect(detectServiceManager("darwin")).toBe("launchd");
    expect(detectServiceManager("linux")).toBe("systemd");
    expect(detectServiceManager("win32")).toBeUndefined();
  });
});

describe("installService, uninstallService", () => {
  let dir: string;
  let ran: string[];
  const ok: CommandRunner = (command) => {
    ran.push(formatCommand(command));
    return { ok: true };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "factory-cli-service-"));
    ran = [];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const plan = () =>
    servicePlan({ ...base, manager: "launchd", userHome: dir, factoryHome: join(dir, "home") });

  it("파일을 쓰고 등록하고, 해제하면 멈춘 뒤 파일을 지운다", () => {
    const p = plan();
    installService(p, ok);
    expect(readFileSync(p.file.path, "utf8")).toBe(p.file.contents);
    expect(existsSync(join(dir, "home", "logs"))).toBe(true);
    expect(ran).toEqual([`launchctl bootstrap gui/501 ${p.file.path}`]);

    ran = [];
    expect(uninstallService(p, ok)).toEqual({ installed: true, failed: [] });
    expect(existsSync(p.file.path)).toBe(false);
    expect(ran).toEqual(["launchctl bootout gui/501/factory-orchestrator"]);
  });

  it("이미 있으면 덮어쓰지 않고 아무것도 돌리지 않는다", () => {
    const p = plan();
    installService(p, ok);
    writeFileSync(p.file.path, "edited");
    ran = [];
    expect(() => installService(p, ok)).toThrow(ServiceError);
    expect(readFileSync(p.file.path, "utf8")).toBe("edited");
    expect(ran).toEqual([]);
  });

  it("등록 명령이 실패하면 쓴 파일을 지운다", () => {
    const p = plan();
    expect(() => installService(p, () => ({ ok: false, output: "Bootstrap failed: 5" }))).toThrow(
      "Bootstrap failed: 5",
    );
    expect(existsSync(p.file.path)).toBe(false);
  });

  it("멈추는 명령이 실패해도 파일을 지우고 실패를 알린다", () => {
    const p = plan();
    installService(p, ok);
    const result = uninstallService(p, () => ({ ok: false, output: "No such process" }));
    expect(result).toEqual({
      installed: true,
      failed: [
        { command: "launchctl bootout gui/501/factory-orchestrator", output: "No such process" },
      ],
    });
    expect(existsSync(p.file.path)).toBe(false);
  });

  it("파일이 없어도 남은 등록을 멈추는 명령은 돌리고, 그 실패는 알리지 않는다", () => {
    const failing: CommandRunner = (command) => {
      ran.push(formatCommand(command));
      return { ok: false, output: "Could not find service" };
    };
    expect(uninstallService(plan(), failing)).toEqual({ installed: false, failed: [] });
    expect(ran).toEqual(["launchctl bootout gui/501/factory-orchestrator"]);
  });

  it("systemd 등록이 중간에 실패하면 앞 명령이 남긴 등록도 되돌린다", () => {
    const p = servicePlan({ ...base, manager: "systemd", userHome: dir, factoryHome: dir });
    const failOnEnable: CommandRunner = (command) => {
      ran.push(formatCommand(command));
      return command.includes("enable") ? { ok: false, output: "start failed" } : { ok: true };
    };
    expect(() => installService(p, failOnEnable)).toThrow("start failed");
    expect(existsSync(p.file.path)).toBe(false);
    expect(ran).toEqual([
      "systemctl --user daemon-reload",
      "systemctl --user enable --now factory-orchestrator.service",
      "systemctl --user disable --now factory-orchestrator.service",
      "systemctl --user daemon-reload",
    ]);
  });
});
