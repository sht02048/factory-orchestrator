import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startWebServer } from "./web-server.js";
import type { WebServer } from "./web-server.js";

const srcDir = fileURLToPath(new URL(".", import.meta.url));
const encryptionKey = new Uint8Array(32).fill(7);

let dir: string;
const started: WebServer[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ganger-web-server-"));
  process.env["DATABASE_PATH"] = join(dir, "ganger.db");
  process.env["ENCRYPTION_KEY"] = Buffer.from(encryptionKey).toString("base64");
});

afterAll(async () => {
  await Promise.all(started.map(({ server }) => server.close()));
  delete process.env["DATABASE_PATH"];
  delete process.env["ENCRYPTION_KEY"];
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

async function optimizedDeps(cacheDir: string): Promise<string> {
  const metadata = join(cacheDir, "deps", "_metadata.json");
  const deadline = Date.now() + 60_000;
  while (!existsSync(metadata)) {
    if (Date.now() > deadline) throw new Error(`no optimized deps in ${cacheDir}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return readFileSync(metadata, "utf8");
}

describe("e2e web dev 서버", () => {
  it("플러그인이 다른 서버가 떠도 먼저 뜬 서버의 최적화한 의존성을 지우거나 바꾸지 않는다", async () => {
    const firstCache = join(dir, "first");
    const secondCache = join(dir, "second");
    started.push(await startWebServer({ plugins: [{ name: "e2e-first" }], cacheDir: firstCache }));
    const before = await optimizedDeps(firstCache);

    started.push(
      await startWebServer({ plugins: [{ name: "e2e-second" }], cacheDir: secondCache }),
    );
    await optimizedDeps(secondCache);

    expect(readFileSync(join(firstCache, "deps", "_metadata.json"), "utf8")).toBe(before);
    expect(started.map(({ server }) => server.config.cacheDir)).toEqual([firstCache, secondCache]);
  }, 120_000);

  it("e2e 시험 파일은 vite createServer 를 직접 부르지 않고 startWebServer 로 서버를 띄운다", () => {
    const direct = readdirSync(srcDir)
      .filter((name) => name.endsWith(".test.ts"))
      .filter((name) =>
        /import \{[^}]*\bcreateServer\b[^}]*\} from "vite"/.test(
          readFileSync(join(srcDir, name), "utf8"),
        ),
      );
    expect(direct).toEqual([]);
  });
});
