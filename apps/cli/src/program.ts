import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { Readable, Writable } from "node:stream";
import { parseArgs } from "node:util";
import { createAdapterRegistry } from "@ganger/app/adapters";
import { ELECTRON_RUN_AS_NODE_ENV, mcpLaunch } from "@ganger/app/settings/mcp-launch";
import { localTimeZone } from "@ganger/app/time-zone";
import { BootConfigError, SecretBox, loadMigrations, parseBootConfig } from "@ganger/db";
import { log, processStartFields } from "@ganger/log";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MissingEnvFileError, homePaths, readBootEnv, resolveHome } from "./home.js";
import { EnvFileFormatError, init } from "./init.js";
import type { HoldSleepAssertion } from "./keep-awake.js";
import type { AppLayout } from "./layout.js";
import { parseLogsArgs, showServerLogs } from "./logs.js";
import type { LogsArgs } from "./logs.js";
import { McpStartError, openMcpDatabase, schemaProblem } from "./mcp/open.js";
import { WRITE_SWITCH_POLL_MS, createMcpServer } from "./mcp/server.js";
import { messages } from "./messages.js";
import { readLiveServerLock } from "./server-lock.js";
import {
  SYSTEMD_UNIT,
  ServiceError,
  detectServiceManager,
  formatCommand,
  installService,
  servicePlan,
  systemdUnitPath,
  uninstallService,
} from "./service.js";
import type { CommandRunner, ServicePlan } from "./service.js";
import { StartError, start } from "./start.js";
import type { Started } from "./start.js";

export interface ProgramContext {
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
  userHome: string;
  uid: number;
  nodePath: string;
  cliEntry: string;
  layout: AppLayout;
  runCommand: CommandRunner;
  holdSleepAssertion: HoldSleepAssertion;
  version: string;
  stdin: Readable;
  stdout: Writable;
  out(line: string): void;
  err(line: string): void;
  onStopSignal(handler: (signal: NodeJS.Signals) => void): void;
  setupLog?: (proc: "cli" | "mcp", home: string) => () => void;
}

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
        proc: { type: "string", multiple: true },
        run: { type: "string" },
        ticket: { type: "string" },
        level: { type: "string" },
        since: { type: "string" },
        follow: { type: "boolean", short: "f" },
        json: { type: "boolean" },
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
  const allowed: ReadonlyArray<string> =
    command === "init"
      ? ["home", "host", "port", "database-path"]
      : command === "service"
        ? ["home", "dry-run"]
        : command === "logs"
          ? ["home", "proc", "run", "ticket", "level", "since", "follow", "json"]
          : ["home"];
  const given = Object.entries(values)
    .filter(([name, value]) => name !== "help" && value !== undefined && value !== false)
    .map(([name]) => name);
  const misplaced = given.filter((name) => !allowed.includes(name));
  if (misplaced.length > 0) {
    context.err(
      `${messages.errors.optionNotFor(misplaced.map((name) => `--${name}`).join(", "), command)}\n\n${messages.usage}`,
    );
    return 2;
  }

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
    if (command === "mcp" && subcommand === undefined) return await runMcp(context, home);
    if (command === "logs" && subcommand === undefined) return await runLogs(context, home, values);
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
  const closeLog = context.setupLog?.("cli", home);
  log().info("process.started", processStartFields());
  try {
    return await superviseStart(context, home);
  } finally {
    log().info("process.stopped");
    closeLog?.();
  }
}

async function superviseStart(context: ProgramContext, home: string): Promise<number> {
  const abort = new AbortController();
  let started: Started | undefined;
  context.onStopSignal((signal) => {
    if (abort.signal.aborted) return;
    abort.abort();
    log().info("process.stopping", { signal });
    context.out(messages.start.stopping(signal));
    void started?.stop();
  });

  try {
    started = await start({
      home,
      env: context.env,
      layout: context.layout,
      signal: abort.signal,
      ...(context.cliEntry === "" ? {} : { cliEntry: context.cliEntry }),
      keepAwake: {
        platform: context.platform,
        hold: context.holdSleepAssertion,
        warn: (line) => context.err(line),
      },
      warn: (line) => context.err(line),
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
  if (abort.signal.aborted) {
    await started.stop();
    context.out(messages.start.stopped);
    return 0;
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

async function runMcp(context: ProgramContext, home: string): Promise<number> {
  const closeLog = context.setupLog?.("mcp", home);
  log().info("process.started", processStartFields());
  try {
    return await serveMcp(context, home);
  } finally {
    log().info("process.stopped");
    closeLog?.();
  }
}

async function serveMcp(context: ProgramContext, home: string): Promise<number> {
  const config = parseBootConfig(readBootEnv(homePaths(home).envFile, context.env));
  const migrations = loadMigrations();
  const db = openMcpDatabase(config.databasePath, migrations);
  const mcp = createMcpServer({
    db,
    secretBox: new SecretBox(config.encryptionKey),
    registry: createAdapterRegistry(),
    home,
    mcpLaunch: mcpLaunch({
      nodePath: context.nodePath,
      cliEntry: context.cliEntry === "" ? undefined : context.cliEntry,
      home,
      electron: context.env[ELECTRON_RUN_AS_NODE_ENV] === "1",
    }),
    version: context.version,
    timeZone: localTimeZone(),
    now: () => new Date(),
    serverStatus: () => {
      const lock = readLiveServerLock(home);
      return { running: lock !== undefined, url: lock?.url ?? null };
    },
    schemaProblem: () => schemaProblem(db, migrations),
  });
  const { server } = mcp;
  const closed = new Promise<void>((resolve) => {
    server.server.onclose = resolve;
  });
  const close = () => void server.close();
  context.stdin.once("end", close);
  context.onStopSignal(close);
  const watchWriteSwitch = setInterval(mcp.syncWriteTools, WRITE_SWITCH_POLL_MS);
  try {
    await mcp.connect(new StdioServerTransport(context.stdin, context.stdout));
    await closed;
  } finally {
    clearInterval(watchWriteSwitch);
    context.stdin.off("end", close);
    db.$client.close();
  }
  return 0;
}

async function runLogs(context: ProgramContext, home: string, args: LogsArgs): Promise<number> {
  const parsed = parseLogsArgs(args, new Date());
  if (!parsed.ok) {
    context.err(`${parsed.error}\n\n${messages.usage}`);
    return 2;
  }
  if (systemdServiceInstalled(context)) context.err(messages.logs.journald(SYSTEMD_UNIT));
  return showServerLogs(
    {
      out: (line) => context.out(line),
      err: (line) => context.err(line),
      color: writesToTerminal(context.stdout) && context.env["NO_COLOR"] === undefined,
      onStopSignal: (handler) => context.onStopSignal(handler),
    },
    homePaths(home).logDir,
    parsed.request,
  );
}

function systemdServiceInstalled(context: ProgramContext): boolean {
  if (detectServiceManager(context.platform) !== "systemd") return false;
  return existsSync(systemdUnitPath(context.userHome, context.env["XDG_CONFIG_HOME"]));
}

function writesToTerminal(stream: Writable): boolean {
  return Reflect.get(stream, "isTTY") === true;
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
    gangerHome: home,
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
      context.out(messages.service.systemdLogs(SYSTEMD_UNIT));
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
  for (const failure of result.failed) {
    context.err(messages.service.commandFailed(failure.command, failure.output));
  }
  if (!result.installed) {
    context.out(messages.service.notInstalled(plan.file.path));
    return 0;
  }
  if (result.failed.length > 0) {
    context.err(messages.service.removedWithWarnings(plan.file.path));
    return 1;
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
    error instanceof McpStartError ||
    error instanceof EnvFileFormatError
  ) {
    return error.message;
  }
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

export const runCommand: CommandRunner = (command) => {
  const [file, ...args] = command;
  if (file === undefined) return { ok: false, output: "empty command" };
  const result = spawnSync(file, args, { encoding: "utf8" });
  if (result.error !== undefined) return { ok: false, output: result.error.message };
  if (result.status === 0) return { ok: true };
  return { ok: false, output: `${result.stdout}${result.stderr}` };
};
