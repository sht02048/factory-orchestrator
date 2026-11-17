import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PRODUCT_NAME, homePaths } from "./home.js";

/**
 * 상시 서비스 등록(스펙 9절, ADR 0005). macOS는 launchd 사용자 에이전트, Linux는 systemd 사용자 서비스다.
 * 둘 다 운영자 계정으로 돌아 sudo가 필요 없고, 운영자의 ssh 설정·키를 그대로 쓴다(러너에 ssh로 닿는다).
 *
 * 운영자 머신을 바꾸는 일이라 명시적 명령(`service install`, `service uninstall`)으로만 하고,
 * 무엇을 쓰고 돌릴지는 계획(ServicePlan)으로 먼저 만들어 `--dry-run`으로 그대로 보여 준다.
 */
export type ServiceManager = "launchd" | "systemd";

/** launchd 레이블과 systemd 유닛 이름 */
export const SERVICE_NAME = PRODUCT_NAME;

export interface ServiceContext {
  manager: ServiceManager;
  /** 운영자 홈(`os.homedir()`). 서비스 파일 위치를 정한다 */
  userHome: string;
  /** launchd 도메인 `gui/<uid>` */
  uid: number;
  /** `XDG_CONFIG_HOME`. 없으면 `~/.config` */
  xdgConfigHome?: string;
  /** 서비스가 돌릴 Node 실행 파일(설치할 때의 `process.execPath`) */
  nodePath: string;
  /** 서비스가 돌릴 CLI 진입 파일 */
  cliEntry: string;
  /** 설치 폴더(`--home`) */
  factoryHome: string;
  /** 서비스 환경의 PATH. 설치한 셸의 PATH를 넘겨 ssh 등을 같은 곳에서 찾게 한다 */
  path: string;
}

export interface ServicePlan {
  manager: ServiceManager;
  file: { path: string; contents: string };
  /** 서비스 파일보다 먼저 만들 폴더 */
  directories: string[];
  /** 파일을 쓴 뒤 돌리는 명령 */
  install: string[][];
  /** 파일을 지우기 전에 돌리는 명령 */
  stop: string[][];
  /** 파일을 지운 뒤 돌리는 명령 */
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

/**
 * launchd 사용자 에이전트. 로그인하면 띄우고, 실패로 끝나면 다시 띄운다(정상 종료는 그대로 둔다).
 * launchd는 로그 폴더를 만들지 않아 계획의 directories가 만든다.
 */
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

/**
 * systemd 사용자 서비스. 실패로 끝나면 다시 띄운다. KillMode=mixed로 멈출 때 SIGTERM은 `start`에만 보내
 * `start`가 web과 worker를 차례로 멈추게 하고, 시간을 넘기면 남은 프로세스를 SIGKILL로 끝낸다.
 */
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

/** systemd 따옴표 문자열. `%`는 지정자, ExecStart의 `$`는 변수 치환이라 두 번 써서 글자 그대로 둔다 */
function quoteSystemd(value: string, options: { expandsVariables: boolean }): string {
  let escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%");
  if (options.expandsVariables) escaped = escaped.replaceAll("$", "$$$$");
  return `"${escaped}"`;
}

/** 명령을 돌린 결과. 실패하면 출력을 함께 돌려준다 */
export type CommandRunner = (
  command: ReadonlyArray<string>,
) => { ok: true } | { ok: false; output: string };

export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

/**
 * 계획대로 서비스 파일을 쓰고 등록한다. 이미 파일이 있으면 아무것도 바꾸지 않고 거부한다(먼저 uninstall).
 * 등록 명령이 실패하면 쓴 파일을 지워 설치 전으로 되돌린다.
 */
export function installService(plan: ServicePlan, run: CommandRunner): void {
  if (existsSync(plan.file.path)) {
    throw new ServiceError(`already installed: ${plan.file.path}`);
  }
  for (const dir of plan.directories) mkdirSync(dir, { recursive: true });
  writeFileSync(plan.file.path, plan.file.contents, { flag: "wx", mode: 0o644 });
  for (const command of plan.install) {
    const result = run(command);
    if (!result.ok) {
      // 앞 명령이 남긴 등록(systemd enable의 링크 등)까지 되돌린다. 되돌리는 명령의 실패는 무시한다.
      for (const undo of plan.stop) run(undo);
      rmSync(plan.file.path, { force: true });
      for (const undo of plan.cleanup) run(undo);
      throw new ServiceError(`${formatCommand(command)} failed:\n${result.output}`);
    }
  }
}

/**
 * 서비스를 멈추고 파일을 지운다. 멈추는 명령이 실패해도(이미 멈춘 경우 등) 파일은 지우고, 실패한 명령을
 * 돌려준다. 파일이 없어도 서비스 관리자에 등록이 남아 있을 수 있어(파일을 손으로 지운 경우) 멈추는 명령은
 * 돌리되, 그때의 실패는 등록이 없다는 뜻이라 알리지 않는다.
 *
 * @returns 설치돼 있었는지와 실패한 명령
 */
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

/** 보여 주기용 셸 표기. 안전한 글자만 있으면 그대로, 아니면 작은따옴표로 감싼다 */
export function formatCommand(command: ReadonlyArray<string>): string {
  return command
    .map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`))
    .join(" ");
}
