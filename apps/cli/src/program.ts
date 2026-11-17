import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { BootConfigError, parseBootConfig } from "@factory/db";
import { MissingEnvFileError, homePaths, readBootEnv, resolveHome } from "./home.js";
import { EnvFileFormatError, init } from "./init.js";
import type { AppLayout } from "./layout.js";
import { messages } from "./messages.js";
import {
  SERVICE_NAME,
  ServiceError,
  detectServiceManager,
  formatCommand,
  installService,
  servicePlan,
  uninstallService,
} from "./service.js";
import type { CommandRunner, ServicePlan } from "./service.js";
import { StartError, start } from "./start.js";
import type { Started } from "./start.js";

/** CLI가 바깥과 닿는 곳. 시험에서 바꿔 끼운다 */
export interface ProgramContext {
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
  userHome: string;
  uid: number;
  nodePath: string;
  cliEntry: string;
  layout: AppLayout;
  runCommand: CommandRunner;
  out(line: string): void;
  err(line: string): void;
  /** start가 받은 멈춤 신호를 기다린다 */
  onStopSignal(handler: (signal: NodeJS.Signals) => void): void;
}

/** @returns 프로세스 종료 코드 */
export async function runProgram(
  argv: ReadonlyArray<string>,
  context: ProgramContext,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        home: { type: "string" },
        host: { type: "string" },
        port: { type: "string" },
        "database-path": { type: "string" },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    context.err(`${error instanceof Error ? error.message : String(error)}\n\n${messages.usage}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, subcommand, ...rest] = positionals;
  if (values.help || command === undefined || command === "help") {
    context.out(messages.usage);
    return command === undefined && !values.help ? 2 : 0;
  }
  const home = resolveHome(values.home, context.env, context.userHome);

  try {
    if (command === "init" && subcommand === undefined) {
      return runInit(context, {
        home,
        ...(values.host === undefined ? {} : { host: values.host }),
        ...(values.port === undefined ? {} : { port: values.port }),
        ...(values["database-path"] === undefined ? {} : { databasePath: values["database-path"] }),
      });
    }
    if (command === "start" && subcommand === undefined) return await runStart(context, home);
    if (command === "service" && rest.length === 0) {
      if (subcommand === "install") return runServiceInstall(context, home, values["dry-run"]);
      if (subcommand === "uninstall") return runServiceUninstall(context, home, values["dry-run"]);
    }
    context.err(`${messages.errors.unknownCommand(positionals.join(" "))}\n\n${messages.usage}`);
    return 2;
  } catch (error) {
    context.err(describeError(error));
    return 1;
  }
}

function runInit(context: ProgramContext, options: Parameters<typeof init>[0]): number {
  const result = init(options);
  if (result.created) {
    context.out(messages.init.created(result.envFile));
    context.out(messages.init.summary(result.host, result.port, result.databasePath));
    context.out(messages.init.next);
  } else {
    context.out(messages.init.exists(result.envFile));
  }
  return 0;
}

async function runStart(context: ProgramContext, home: string): Promise<number> {
  // 뜨는 중에 신호를 받아도 자식을 남기지 않게 handler를 먼저 단다. 뜨는 중이면 기다림을 멈추고 정리한다.
  const abort = new AbortController();
  let started: Started | undefined;
  context.onStopSignal((signal) => {
    if (abort.signal.aborted) return;
    abort.abort();
    context.out(messages.start.stopping(signal));
    void started?.stop();
  });

  try {
    started = await start({
      home,
      env: context.env,
      layout: context.layout,
      signal: abort.signal,
      onMigrated: (config, migrated) => {
        context.out(messages.start.config(homePaths(home).envFile, config.databasePath));
        context.out(messages.start.migrated(migrated));
      },
    });
  } catch (error) {
    if (abort.signal.aborted && error instanceof StartError) {
      context.out(messages.start.stopped);
      return 0;
    }
    throw error;
  }
  context.out(messages.start.ready(started.url));

  const { failure } = await started.exited;
  if (failure !== undefined && !abort.signal.aborted) {
    context.err(messages.start.childFailed(failure));
    return 1;
  }
  context.out(messages.start.stopped);
  return 0;
}

function planFor(context: ProgramContext, home: string): ServicePlan | undefined {
  const manager = detectServiceManager(context.platform);
  if (manager === undefined) {
    context.err(messages.service.unsupported(context.platform));
    return undefined;
  }
  const xdgConfigHome = context.env["XDG_CONFIG_HOME"];
  return servicePlan({
    manager,
    userHome: context.userHome,
    uid: context.uid,
    ...(xdgConfigHome === undefined || xdgConfigHome === "" ? {} : { xdgConfigHome }),
    nodePath: context.nodePath,
    cliEntry: context.cliEntry,
    factoryHome: home,
    path: context.env["PATH"] ?? "/usr/bin:/bin",
  });
}

function runServiceInstall(context: ProgramContext, home: string, dryRun: boolean): number {
  const plan = planFor(context, home);
  if (plan === undefined) return 1;
  if (dryRun) {
    context.out(messages.service.dryRunHeader);
    context.out(messages.service.wouldCreateDirectories);
    for (const dir of plan.directories) context.out(`  ${dir}`);
    context.out(messages.service.wouldWrite(plan.file.path));
    context.out(plan.file.contents);
    context.out(messages.service.wouldRun);
    for (const command of plan.install) context.out(`  ${formatCommand(command)}`);
    return 0;
  }
  // 부팅 설정이 없거나 틀린 채로 등록하면 서비스가 뜨자마자 끝나기를 되풀이한다. 미리 막는다.
  try {
    parseBootConfig(readBootEnv(homePaths(home).envFile, {}));
  } catch (error) {
    context.err(`${describeError(error)}\n${messages.service.needsInit}`);
    return 1;
  }
  installService(plan, context.runCommand);
  context.out(messages.service.installed(plan.file.path));
  context.out(messages.service.nodeNote(context.nodePath));
  switch (plan.manager) {
    case "launchd":
      context.out(messages.service.launchdLogs(homePaths(home).logDir));
      break;
    case "systemd":
      context.out(messages.service.systemdLogs(`${SERVICE_NAME}.service`));
      context.out(messages.service.linger);
      break;
  }
  return 0;
}

function runServiceUninstall(context: ProgramContext, home: string, dryRun: boolean): number {
  const plan = planFor(context, home);
  if (plan === undefined) return 1;
  if (dryRun) {
    context.out(messages.service.dryRunHeader);
    context.out(messages.service.wouldRunBeforeRemove);
    for (const command of plan.stop) context.out(`  ${formatCommand(command)}`);
    context.out(messages.service.wouldRemove(plan.file.path));
    if (plan.cleanup.length > 0) {
      context.out(messages.service.wouldRunAfterRemove);
      for (const command of plan.cleanup) context.out(`  ${formatCommand(command)}`);
    }
    return 0;
  }
  const result = uninstallService(plan, context.runCommand);
  if (!result.installed) {
    context.out(messages.service.notInstalled(plan.file.path));
    return 0;
  }
  for (const failure of result.failed) {
    context.err(messages.service.commandFailed(failure.command, failure.output));
  }
  context.out(messages.service.uninstalled(plan.file.path));
  return 0;
}

function describeError(error: unknown): string {
  if (error instanceof MissingEnvFileError) return messages.errors.missingEnvFile(error.envFile);
  if (
    error instanceof BootConfigError ||
    error instanceof StartError ||
    error instanceof ServiceError ||
    error instanceof EnvFileFormatError
  ) {
    return error.message;
  }
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/** 실제 명령 실행. 출력은 실패했을 때만 보여 주려고 모은다 */
export const runCommand: CommandRunner = (command) => {
  const [file, ...args] = command;
  if (file === undefined) return { ok: false, output: "empty command" };
  const result = spawnSync(file, args, { encoding: "utf8" });
  if (result.error !== undefined) return { ok: false, output: result.error.message };
  if (result.status === 0) return { ok: true };
  return { ok: false, output: `${result.stdout}${result.stderr}` };
};
