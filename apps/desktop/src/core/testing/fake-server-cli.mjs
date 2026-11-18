import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const [command, flag, home] = process.argv.slice(2);
if (flag !== "--home" || home === undefined) process.exit(2);
const log = (line) =>
  appendFileSync(join(home, "events.log"), `${line} ${process.pid} ${Date.now()}\n`);

if (command === "init") {
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, ".env"),
    [
      `WEB_HOST="127.0.0.1"`,
      `WEB_PORT="${process.env.FAKE_PORT}"`,
      `DATABASE_PATH="${join(home, "data.db")}"`,
      `ENCRYPTION_KEY="${Buffer.alloc(32, 1).toString("base64")}"`,
      "",
    ].join("\n"),
  );
  log("init");
  process.exit(0);
}
if (command !== "start") process.exit(2);

const port = Number(/WEB_PORT="(\d+)"/.exec(readFileSync(join(home, ".env"), "utf8"))?.[1]);
const url = `http://127.0.0.1:${port}`;
const lockPath = join(home, "server.lock");
/**
 * @param {number} pid
 * @param {string} startedAt
 */
const alive = (pid, startedAt) => {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EPERM")) return false;
  }
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
    }).trim();
    return new Date(out).getTime() <= new Date(startedAt).getTime() + 2000;
  } catch {
    return true;
  }
};
for (let attempt = 0; ; attempt += 1) {
  try {
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, url, startedAt: new Date().toISOString() }),
      {
        flag: "wx",
      },
    );
    break;
  } catch {
    let holder;
    try {
      /** @type {unknown} */
      const parsed = JSON.parse(readFileSync(lockPath, "utf8"));
      holder =
        typeof parsed === "object" &&
        parsed !== null &&
        "pid" in parsed &&
        typeof parsed.pid === "number" &&
        "startedAt" in parsed &&
        typeof parsed.startedAt === "string"
          ? { pid: parsed.pid, startedAt: parsed.startedAt }
          : undefined;
    } catch {
      holder = undefined;
    }
    if (attempt > 20 || (holder !== undefined && alive(holder.pid, holder.startedAt))) {
      log("refused");
      process.exit(1);
    }
    if (holder === undefined) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      continue;
    }
    rmSync(lockPath, { force: true });
  }
}
log("start");

const self = import.meta.filename;
const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", self], {
  stdio: "ignore",
});
const webChild =
  process.env.FAKE_WEB_CHILD === "1"
    ? spawn(
        process.execPath,
        [
          "-e",
          `require("node:http").createServer((q, s) => s.end(JSON.stringify({ product: "ganger", version: "0.0.0", instanceId: "fake-instance", webAccess: "allowed" }))).listen(${port}, "127.0.0.1")`,
          self,
        ],
        { stdio: "ignore" },
      )
    : undefined;
if (webChild !== undefined) appendFileSync(join(home, "workers.log"), `${webChild.pid}\n`);
appendFileSync(join(home, "workers.log"), `${worker.pid}\n`);
const server = createServer((req, res) => {
  if (req.url === "/api/identity") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        product: "ganger",
        version: process.env.FAKE_VERSION ?? "0.0.0",
        instanceId: "fake-instance",
        webAccess: "allowed",
      }),
    );
    return;
  }
  res.end("ok");
});
if (webChild === undefined) {
  setTimeout(() => server.listen(port, "127.0.0.1"), Number(process.env.FAKE_READY_DELAY ?? 0));
}
process.on("SIGTERM", () => {
  log("stop");
  worker.kill("SIGTERM");
  webChild?.kill("SIGTERM");
  rmSync(lockPath, { force: true });
  server.close();
  setTimeout(() => process.exit(0), 50);
});
