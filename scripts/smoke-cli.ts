import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { findBundleProblems } from "./bundle-check.ts";

const REPO = join(import.meta.dirname, "..");
const STARTUP_TIMEOUT_MS = 60_000;
const RUNNER_CHECK_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 20_000;

const { values, positionals } = parseArgs({
  options: { bundle: { type: "boolean", default: false }, node: { type: "string" } },
  allowPositionals: true,
});
const nodePath = values.node === undefined ? process.execPath : resolve(values.node);

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(check: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${what} within ${timeoutMs} ms`);
}

function defaultTarball(): string {
  const parsed: unknown = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  const version =
    typeof parsed === "object" && parsed !== null && "version" in parsed ? parsed.version : null;
  if (typeof version !== "string") throw new Error("package.json has no version");
  return join(REPO, "dist", `ganger-${version}.tar.gz`);
}

function installBundle(installDir: string): string {
  const tarball = resolve(positionals[0] ?? defaultTarball());
  const untar = spawnSync("tar", ["-xzf", tarball, "-C", installDir], { encoding: "utf8" });
  if (untar.status !== 0) throw new Error(`could not extract ${tarball}: ${untar.stderr}`);
  const root = join(installDir, tarball.replace(/^.*[\\/]/, "").replace(/\.tar\.gz$/, ""));
  const problems = findBundleProblems(root);
  if (problems.length > 0) throw new Error(`server bundle check failed:\n${problems.join("\n")}`);
  console.log(`extracted ${tarball} to ${root}; bundle check passed`);
  return join(root, "cli", "bin", "cli.js");
}

async function checkMcp(input: {
  cli: string;
  cwd: string;
  home: string;
  env: Record<string, string | undefined>;
}): Promise<void> {
  const env = Object.fromEntries(
    Object.entries(input.env).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, value]],
    ),
  );
  const client = new Client({ name: "ganger-smoke", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: nodePath,
      args: [input.cli, "mcp", "--home", input.home],
      cwd: input.cwd,
      env,
    }),
  );
  try {
    const { tools } = await client.listTools();
    if (!tools.some((tool) => tool.name === "get_dashboard")) {
      throw new Error(
        `ganger mcp listed no get_dashboard tool: ${tools.map((t) => t.name).join(", ")}`,
      );
    }
    const dashboard = await client.callTool({ name: "get_dashboard", arguments: {} });
    const text = JSON.stringify(dashboard.content);
    if (dashboard.isError === true || !text.includes("Smoke workspace")) {
      throw new Error(`ganger mcp get_dashboard returned ${text}`);
    }
    if (!text.includes('\\"running\\": true')) {
      throw new Error(`ganger mcp did not report the running server: ${text}`);
    }
    console.log(`ganger mcp: ${tools.length} tools; get_dashboard returned the smoke workspace`);

    if (tools.some((tool) => tool.name === "set_runner_capacity")) {
      throw new Error("ganger mcp listed write tools while MCP writes were off");
    }
    const db = new DatabaseSync(join(input.home, "data", "ganger.db"));
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      db.prepare(
        "INSERT INTO install_settings (id, instance_id, mcp_write_allowed, updated_at) VALUES (1, 'smoke', 1, ?) ON CONFLICT(id) DO UPDATE SET mcp_write_allowed = 1",
      ).run(Date.now());
      const turnedOn = db
        .prepare("SELECT count(*) AS n FROM install_settings WHERE mcp_write_allowed = 1")
        .get()?.["n"];
      if (turnedOn !== 1) throw new Error("could not turn on MCP writes in install_settings");
    } finally {
      db.close();
    }
    const allowed = await client.listTools();
    if (!allowed.tools.some((tool) => tool.name === "set_runner_capacity")) {
      throw new Error("ganger mcp listed no write tools after MCP writes were turned on");
    }
    const capacity = await client.callTool({
      name: "set_runner_capacity",
      arguments: { runner: "Smoke runner", capacity: 2 },
    });
    if (capacity.isError === true) {
      throw new Error(
        `ganger mcp set_runner_capacity returned ${JSON.stringify(capacity.content)}`,
      );
    }
    const check = new DatabaseSync(join(input.home, "data", "ganger.db"));
    try {
      const row = check
        .prepare("SELECT client, tool, outcome FROM mcp_actions ORDER BY id DESC LIMIT 1")
        .get();
      if (row?.["client"] !== "ganger-smoke" || row["outcome"] !== "done") {
        throw new Error(`ganger mcp recorded ${JSON.stringify(row)}`);
      }
    } finally {
      check.close();
    }
    console.log(
      "ganger mcp: write tools appeared after MCP writes were turned on, and the write was recorded",
    );
  } finally {
    await client.close();
  }
}

const home = mkdtempSync(join(tmpdir(), "ganger-smoke-cli-"));
const installDir = values.bundle ? mkdtempSync(join(tmpdir(), "ganger-smoke-bundle-")) : null;
const port = await freePort();
const env = { ...process.env };
for (const name of [
  "WEB_HOST",
  "WEB_PORT",
  "DATABASE_PATH",
  "ENCRYPTION_KEY",
  "GANGER_HOME",
  "NODE_PATH",
  "NODE_OPTIONS",
]) {
  delete env[name];
}

let output = "";
let failure: string | undefined;
let exitCode: number | null | undefined;
let child: ReturnType<typeof spawn> | undefined;
try {
  const cli =
    installDir === null
      ? join(REPO, "apps", "cli", "dist", "bin", "cli.js")
      : installBundle(installDir);
  const cwd = installDir ?? REPO;
  const init = spawnSync(nodePath, [cli, "init", "--home", home, "--port", String(port)], {
    cwd,
    env,
    encoding: "utf8",
  });
  if (init.error !== undefined) throw new Error(`could not run init: ${init.error.message}`);
  output += init.stdout + init.stderr;
  if (init.status !== 0) throw new Error(`init exited with ${init.status ?? init.signal}`);

  const started = spawn(nodePath, [cli, "start", "--home", home], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = started;
  started.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  started.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  started.once("exit", (code) => (exitCode = code));

  await waitFor(
    () => {
      if (exitCode !== undefined)
        throw new Error(`start exited with ${exitCode} before web was ready`);
      return output.includes("Web is listening at");
    },
    STARTUP_TIMEOUT_MS,
    "start did not report that web is listening",
  );
  await waitFor(
    () => output.includes("[worker] started"),
    STARTUP_TIMEOUT_MS,
    "worker did not start",
  );

  const response = await fetch(`http://127.0.0.1:${port}/runs`);
  if (response.status !== 200) throw new Error(`GET /runs returned ${response.status}`);
  console.log(`GET /runs -> ${response.status}`);
  const asset = /(?:src|href)="(\/assets\/[^"]+\.js)"/.exec(await response.text())?.[1];
  if (asset === undefined) throw new Error("GET /runs returned no script asset");
  const assetResponse = await fetch(`http://127.0.0.1:${port}${asset}`);
  if (assetResponse.status !== 200)
    throw new Error(`GET ${asset} returned ${assetResponse.status}`);
  console.log(`GET ${asset} -> ${assetResponse.status}`);

  const db = new DatabaseSync(join(home, "data", "ganger.db"));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const applied = db.prepare("SELECT count(*) AS n FROM schema_migrations").get()?.["n"];
    if (typeof applied !== "number" || applied === 0) throw new Error("no migrations were applied");
    console.log(`schema_migrations: ${applied} row(s)`);

    db.prepare(
      "INSERT INTO runners (id, kind, name, config, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "smoke-runner",
      "orca",
      "Smoke runner",
      JSON.stringify({ sshTarget: "factory-smoke.invalid", connectTimeoutSeconds: 5 }),
      1,
      Date.now(),
    );
    const check = db.prepare(
      "SELECT online, checked_at AS checkedAt, check_error AS checkError FROM runners WHERE id = ?",
    );
    let row: Record<string, unknown> | undefined;
    await waitFor(
      () => {
        row = check.get("smoke-runner");
        return row?.["checkedAt"] !== null && row?.["checkedAt"] !== undefined;
      },
      RUNNER_CHECK_TIMEOUT_MS,
      "worker did not record a runner check",
    );
    if (row?.["online"] !== 0)
      throw new Error(`runner check recorded online=${String(row?.["online"])}`);
    if (typeof row?.["checkError"] !== "string") throw new Error("runner check recorded no error");
    console.log(`runner check recorded: offline, error ${row["checkError"]}`);

    db.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)").run(
      "smoke-workspace",
      "Smoke workspace",
      Date.now(),
    );
  } finally {
    db.close();
  }

  await checkMcp({ cli, cwd, home, env });

  started.kill("SIGTERM");
  await waitFor(() => exitCode !== undefined, STOP_TIMEOUT_MS, "start did not stop after SIGTERM");
  if (exitCode !== 0) throw new Error(`start exited with ${exitCode} after SIGTERM`);
  try {
    await fetch(`http://127.0.0.1:${port}/runs`);
    throw new Error("web still responds after start stopped");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("web still")) throw error;
  }
  console.log("start stopped web and worker on SIGTERM");
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  if (child !== undefined && exitCode === undefined) child.kill("SIGKILL");
  rmSync(home, { recursive: true, force: true });
  if (installDir !== null) rmSync(installDir, { recursive: true, force: true });
}

if (failure !== undefined) {
  console.error(`cli smoke test failed: ${failure}\n--- output ---\n${output}`);
  process.exitCode = 1;
}
