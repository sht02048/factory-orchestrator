import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PRODUCT_NAME, homePaths } from "./home.js";

export type ServiceManager = "launchd" | "systemd";

export const SERVICE_NAME = PRODUCT_NAME;

export interface ServiceContext {
  manager: ServiceManager;
  userHome: string;
  uid: number;
  xdgConfigHome?: string;
  nodePath: string;
  cliEntry: string;
  factoryHome: string;
  path: string;
}

export interface ServicePlan {
  manager: ServiceManager;
  file: { path: string; contents: string };
  directories: string[];
  install: string[][];
  stop: string[][];
  cleanup: string[][];
}

export function detectServiceManager(platform: NodeJS.Platform): ServiceManager | undefined {
  if (platform === "darwin") return "launchd";
  if (platform === "linux") return "systemd";
  return undefined;
}

export function servicePlan(context: ServiceContext): ServicePlan {
  const programArguments = [
    context.nodePath,
    context.cliEntry,
    "start",
    "--home",
    context.factoryHome,
  ];
  switch (context.manager) {
    case "launchd": {
      const path = join(context.userHome, "Library", "LaunchAgents", `${SERVICE_NAME}.plist`);
      const logDir = homePaths(context.factoryHome).logDir;
      return {
        manager: "launchd",
        file: {
          path,
          contents: renderLaunchdPlist({
            label: SERVICE_NAME,
            programArguments,
            path: context.path,
            logFile: join(logDir, `${SERVICE_NAME}.log`),
          }),
        },
        directories: [dirname(path), logDir],
        install: [["launchctl", "bootstrap", `gui/${context.uid}`, path]],
        stop: [["launchctl", "bootout", `gui/${context.uid}/${SERVICE_NAME}`]],
        cleanup: [],
      };
    }
    case "systemd": {
      const configHome = context.xdgConfigHome ?? join(context.userHome, ".config");
      const unit = `${SERVICE_NAME}.service`;
      const path = join(configHome, "systemd", "user", unit);
      return {
        manager: "systemd",
        file: {
          path,
          contents: renderSystemdUnit({
            description: `${SERVICE_NAME} (web and worker)`,
            execStart: programArguments,
            path: context.path,
          }),
        },
        directories: [dirname(path)],
        install: [
          ["systemctl", "--user", "daemon-reload"],
          ["systemctl", "--user", "enable", "--now", unit],
        ],
        stop: [["systemctl", "--user", "disable", "--now", unit]],
        cleanup: [["systemctl", "--user", "daemon-reload"]],
      };
    }
  }
}

export function renderLaunchdPlist(input: {
  label: string;
  programArguments: ReadonlyArray<string>;
  path: string;
  logFile: string;
}): string {
  const string = (value: string): string => `<string>${escapeXml(value)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${string(input.label)}
  <key>ProgramArguments</key>
  <array>
${input.programArguments.map((arg) => `    ${string(arg)}`).join("\n")}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    ${string(input.path)}
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
  ${string(input.logFile)}
  <key>StandardErrorPath</key>
  ${string(input.logFile)}
</dict>
</plist>
`;
}

export function renderSystemdUnit(input: {
  description: string;
  execStart: ReadonlyArray<string>;
  path: string;
}): string {
  return `[Unit]
Description=${input.description}

[Service]
Type=simple
ExecStart=${input.execStart.map((arg) => quoteSystemd(arg, { expandsVariables: true })).join(" ")}
Environment=${quoteSystemd(`PATH=${input.path}`, { expandsVariables: false })}
Restart=on-failure
RestartSec=10
KillMode=mixed
TimeoutStopSec=30

[Install]
WantedBy=default.target
`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function quoteSystemd(value: string, options: { expandsVariables: boolean }): string {
  let escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%");
  if (options.expandsVariables) escaped = escaped.replaceAll("$", "$$$$");
  return `"${escaped}"`;
}

export type CommandRunner = (
  command: ReadonlyArray<string>,
) => { ok: true } | { ok: false; output: string };

export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

export function installService(plan: ServicePlan, run: CommandRunner): void {
  if (existsSync(plan.file.path)) {
    throw new ServiceError(`already installed: ${plan.file.path}`);
  }
  for (const dir of plan.directories) mkdirSync(dir, { recursive: true });
  writeFileSync(plan.file.path, plan.file.contents, { flag: "wx", mode: 0o644 });
  for (const command of plan.install) {
    const result = run(command);
    if (!result.ok) {
      for (const undo of plan.stop) run(undo);
      rmSync(plan.file.path, { force: true });
      for (const undo of plan.cleanup) run(undo);
      throw new ServiceError(`${formatCommand(command)} failed:\n${result.output}`);
    }
  }
}

export function uninstallService(
  plan: ServicePlan,
  run: CommandRunner,
): { installed: boolean; failed: Array<{ command: string; output: string }> } {
  if (!existsSync(plan.file.path)) {
    for (const command of plan.stop) run(command);
    return { installed: false, failed: [] };
  }
  const failed: Array<{ command: string; output: string }> = [];
  const runAll = (commands: string[][]): void => {
    for (const command of commands) {
      const result = run(command);
      if (!result.ok) failed.push({ command: formatCommand(command), output: result.output });
    }
  };
  runAll(plan.stop);
  rmSync(plan.file.path, { force: true });
  runAll(plan.cleanup);
  return { installed: true, failed };
}

export function formatCommand(command: ReadonlyArray<string>): string {
  return command
    .map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`))
    .join(" ");
}
