import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { BOOT_ENV, migrate, openDatabase, parseBootConfig } from "@factory/db";
import type { BootConfig } from "@factory/db";
import { homePaths, readBootEnv } from "./home.js";
import type { AppLayout, ProcessSpec } from "./layout.js";

/** web이 응답하기를 기다리는 시간 */
export const READY_TIMEOUT_MS = 60_000;
/** 멈추라고 한 뒤 자식이 끝나기를 기다리는 시간. 넘기면 SIGKILL로 끝낸다 */
export const STOP_TIMEOUT_MS = 15_000;

export interface StartOptions {
  home: string;
  /** 셸 환경 변수. 부팅 값은 `.env` 위에 덮고(readBootEnv), 나머지는 자식에게 그대로 넘긴다 */
  env: Readonly<Record<string, string | undefined>>;
  layout: AppLayout;
  /** 주면 자식 출력을 받아 넘긴다. 없으면 자식이 이 프로세스의 표준 출력·오류에 바로 쓴다 */
  onOutput?: (name: ProcessSpec["name"], chunk: string) => void;
  /** 마이그레이션을 마치고 자식을 띄우기 직전에 부른다. 자식 출력보다 먼저 알리려고 쓴다 */
  onMigrated?: (config: BootConfig, migrated: ReadonlyArray<string>) => void;
  /** 뜨는 중에 멈추라는 신호. 받으면 web을 더 기다리지 않고 자식을 멈춘 뒤 StartError를 던진다 */
  signal?: AbortSignal;
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
}

export interface Started {
  config: BootConfig;
  /** web에 닿는 주소 */
  url: string;
  /** 이번에 돌린 마이그레이션 이름 */
  migrated: string[];
  /** 두 자식을 멈추고 모두 끝날 때까지 기다린다. 여러 번 불러도 된다 */
  stop(): Promise<void>;
  /**
   * 두 자식이 모두 끝나면 풀린다. stop() 없이 한쪽이 먼저 끝났으면 그 이유를 담는다(다른 쪽은 멈춘다).
   * 서비스 관리자가 다시 띄우도록 부르는 쪽은 이때 0이 아닌 코드로 끝낸다.
   */
  exited: Promise<{ failure?: string }>;
}

export class StartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartError";
  }
}

/**
 * 부팅 설정을 읽고 DB 마이그레이션을 돌린 뒤(ADR 0005: 업데이트 때 자동으로 돈다) web과 worker를
 * 띄운다(ADR 0002). web이 바인딩 주소에서 응답하면 풀린다.
 *
 * 마이그레이션을 여기서 먼저 돌려 실패하면 아무 프로세스도 띄우지 않는다. web과 worker도 띄울 때
 * 마이그레이션을 부르지만 돌 것이 없어 바로 지나간다.
 */
export async function start(options: StartOptions): Promise<Started> {
  const bootEnv = readBootEnv(homePaths(options.home).envFile, options.env);
  const config = parseBootConfig(bootEnv);
  const specs = [options.layout.web(config), options.layout.worker()];
  const missing = specs.flatMap((spec) => spec.requires.filter((path) => !existsSync(path)));
  if (missing.length > 0) {
    throw new StartError(`build output not found (run pnpm build): ${missing.join(", ")}`);
  }

  const db = openDatabase(config.databasePath);
  let migrated: string[];
  try {
    migrated = migrate(db);
  } finally {
    db.$client.close();
  }
  options.onMigrated?.(config, migrated);

  const childEnv: Record<string, string | undefined> = {
    ...options.env,
    [BOOT_ENV.host]: config.host,
    [BOOT_ENV.port]: String(config.port),
    [BOOT_ENV.databasePath]: config.databasePath,
    [BOOT_ENV.encryptionKey]: Buffer.from(config.encryptionKey).toString("base64"),
  };
  const group = superviseChildren(
    specs.map((spec) => spawnChild(spec, childEnv, options.onOutput)),
    options.stopTimeoutMs ?? STOP_TIMEOUT_MS,
  );

  const url = webUrl(config);
  try {
    await waitForWeb(
      url,
      options.readyTimeoutMs ?? READY_TIMEOUT_MS,
      group.firstFailure,
      options.signal,
    );
  } catch (error) {
    await group.stop();
    throw error;
  }
  return { config, url, migrated, stop: group.stop, exited: group.exited };
}

/** 바인딩 주소로 닿는 주소. 모든 인터페이스에 바인딩했으면 같은 머신의 루프백으로 닿는다 */
export function webUrl(config: Pick<BootConfig, "host" | "port">): string {
  let host = config.host;
  if (host === "0.0.0.0") host = "127.0.0.1";
  else if (host === "::") host = "::1";
  if (host.includes(":")) host = `[${host}]`;
  return `http://${host}:${config.port}`;
}

interface Child {
  name: ProcessSpec["name"];
  exit: Promise<string>;
  kill(signal: NodeJS.Signals): void;
}

function spawnChild(
  spec: ProcessSpec,
  env: Record<string, string | undefined>,
  onOutput: StartOptions["onOutput"],
): Child {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env,
    stdio: onOutput === undefined ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
  });
  if (onOutput !== undefined) {
    child.stdout?.on("data", (chunk: Buffer) => onOutput(spec.name, chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => onOutput(spec.name, chunk.toString()));
  }
  let running = true;
  const exit = new Promise<string>((resolve) => {
    child.once("error", (error) => {
      running = false;
      resolve(`could not start: ${error.message}`);
    });
    child.once("exit", (code, signal) => {
      running = false;
      resolve(signal === null ? `exited with code ${code ?? "unknown"}` : `killed by ${signal}`);
    });
  });
  return {
    name: spec.name,
    exit,
    kill: (signal) => {
      if (running) child.kill(signal);
    },
  };
}

/**
 * 자식이 하나라도 먼저 끝나면 나머지를 멈춘다. 한쪽만 도는 반쪽 설치로 남지 않게 하고, 서비스 관리자가
 * 둘을 함께 다시 띄우게 한다.
 */
function superviseChildren(children: Child[], stopTimeoutMs: number) {
  let stopping = false;
  let failure: string | undefined;
  let notifyFailure: (reason: string) => void = () => undefined;
  const firstFailure = new Promise<string>((resolve) => (notifyFailure = resolve));

  const allExited = Promise.all(children.map((child) => child.exit));
  const stopAll = (): Promise<void> => {
    if (!stopping) {
      stopping = true;
      for (const child of children) child.kill("SIGTERM");
      const timer = setTimeout(() => {
        for (const child of children) child.kill("SIGKILL");
      }, stopTimeoutMs);
      void allExited.then(() => clearTimeout(timer));
    }
    return allExited.then(() => undefined);
  };

  for (const child of children) {
    void child.exit.then((reason) => {
      if (stopping) return;
      failure = `${child.name} ${reason}`;
      notifyFailure(failure);
      void stopAll();
    });
  }

  return {
    stop: stopAll,
    firstFailure,
    exited: allExited.then(() => (failure === undefined ? {} : { failure })),
  };
}

async function waitForWeb(
  url: string,
  timeoutMs: number,
  failed: Promise<string>,
  signal: AbortSignal | undefined,
): Promise<void> {
  let failure: string | undefined;
  void failed.then((reason) => (failure = reason));
  // 기다리는 동안 바뀌는 값이라 매번 새로 읽는다.
  const stopRequested = (): boolean => signal?.aborted === true;
  const stopped = () => new StartError("stopped before web responded: stop requested");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (failure !== undefined) throw new StartError(`stopped before web responded: ${failure}`);
    if (stopRequested()) throw stopped();
    try {
      await fetch(url, { signal: AbortSignal.timeout(2_000) });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    // 응답을 기다리는 동안 멈추라는 신호가 왔으면 뜬 것으로 치지 않는다.
    if (stopRequested()) throw stopped();
    return;
  }
  if (stopRequested()) throw stopped();
  throw new StartError(`web did not respond at ${url} within ${timeoutMs} ms`);
}
