import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BootConfig } from "@ganger/db";
import { appLayout } from "./layout.js";

const config: BootConfig = {
  host: "127.0.0.1",
  port: 3000,
  databasePath: "/data/ganger.db",
  encryptionKey: new Uint8Array(32),
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ganger-layout-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function touch(...parts: string[]): string {
  const path = join(dir, ...parts);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "");
  return path;
}

describe("appLayout", () => {
  it("uses the dist folders next to the CLI package in the workspace", () => {
    touch("apps", "cli", "package.json");
    const cli = touch("apps", "cli", "dist", "bin", "cli.js");
    const layout = appLayout(cli);

    const web = layout.web(config);
    expect(web.cwd).toBe(join(dir, "apps", "web", "dist"));
    expect(web.args).toEqual([
      join(dir, "apps", "web", "dist", "srvx", "srvx.js"),
      "--prod",
      "--host",
      "127.0.0.1",
      "--port",
      "3000",
      "--static",
      join(dir, "apps", "web", "dist", "client"),
      join(dir, "apps", "web", "dist", "server", "server.js"),
    ]);
    expect(layout.worker().args).toEqual([
      join(dir, "apps", "worker", "dist", "server", "main.js"),
    ]);
  });

  it("uses the web and worker folders next to the CLI in the server bundle", () => {
    touch("bundle", "package.json");
    const cli = touch("bundle", "cli", "bin", "cli.js");
    mkdirSync(join(dir, "bundle", "web"));
    const layout = appLayout(cli);

    const web = layout.web(config);
    expect(web.cwd).toBe(join(dir, "bundle", "web"));
    expect(web.requires).toEqual([
      join(dir, "bundle", "web", "srvx", "srvx.js"),
      join(dir, "bundle", "web", "server", "server.js"),
      join(dir, "bundle", "web", "client"),
    ]);
    expect(layout.worker()).toMatchObject({
      cwd: join(dir, "bundle", "worker"),
      args: [join(dir, "bundle", "worker", "server", "main.js")],
    });
  });
});
