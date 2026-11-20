import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { fileSink, rotateIfOver, rotateInPlaceIfOver } from "./file-sink.js";
import { readLogSettings } from "./settings.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ganger-sink-"));
  dirs.push(dir);
  return dir;
}

function line(index: number): string {
  return `${JSON.stringify({ n: index, pad: "x".repeat(40) })}\n`;
}

function allLines(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.startsWith("worker.jsonl"))
    .flatMap((name) => readFileSync(join(dir, name), "utf8").split("\n"))
    .filter((text) => text !== "");
}

describe("file sink", () => {
  it("has the line on disk as soon as write returns, so an exit right after keeps it", () => {
    const path = join(tempDir(), "logs", "worker.jsonl");
    const sink = fileSink(path, { maxBytes: 1_000_000, files: 5 });
    sink.write(line(1));
    expect(readFileSync(path, "utf8")).toBe(line(1));
    sink.close();
  });

  it("starts a new line after a line cut short by a crash", () => {
    const path = join(tempDir(), "worker.jsonl");
    writeFileSync(path, `${line(1)}{"n":2,"pad":"xx`);
    const sink = fileSink(path, { maxBytes: 1_000_000, files: 5 });
    sink.write(line(3));
    sink.close();
    const lines = readFileSync(path, "utf8").split("\n");
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ n: 1 });
    expect(JSON.parse(lines[2] ?? "")).toMatchObject({ n: 3 });
  });

  it("keeps at most the configured number of rotated files however often it overflows", () => {
    const dir = tempDir();
    const path = join(dir, "worker.jsonl");
    const sink = fileSink(path, { maxBytes: 200, files: 3 });
    for (let index = 0; index < 200; index += 1) sink.write(line(index));
    sink.close();
    expect(readdirSync(dir).sort()).toEqual([
      "worker.jsonl",
      "worker.jsonl.1",
      "worker.jsonl.2",
      "worker.jsonl.3",
    ]);
    for (const name of readdirSync(dir)) {
      expect(readFileSync(join(dir, name)).byteLength).toBeLessThanOrEqual(200);
    }
    const kept = allLines(dir).map((text) => z.object({ n: z.number() }).parse(JSON.parse(text)).n);
    expect(Math.max(...kept)).toBe(199);
    expect(kept.length).toBeGreaterThan(3);
  });

  it("keeps every line whole when two processes write the same file and rotate", () => {
    const dir = tempDir();
    const path = join(dir, "worker.jsonl");
    const first = fileSink(path, { maxBytes: 600, files: 2 });
    const second = fileSink(path, { maxBytes: 600, files: 2 });
    for (let index = 0; index < 100; index += 1) {
      first.write(line(index));
      second.write(line(1_000 + index));
    }
    first.close();
    second.close();
    const lines = allLines(dir);
    for (const text of lines)
      expect(() => z.object({ n: z.number() }).parse(JSON.parse(text))).not.toThrow();
    expect(readdirSync(dir).length).toBeLessThanOrEqual(3);
  });

  it("reads the size and file count from the environment", () => {
    expect(readLogSettings({ GANGER_LOG_MAX_MB: "2", GANGER_LOG_FILES: "1" }).limits).toEqual({
      maxBytes: 2 * 1024 * 1024,
      files: 1,
    });
    expect(readLogSettings({ GANGER_LOG_MAX_MB: "-3", GANGER_LOG_FILES: "x" }).limits).toEqual({
      maxBytes: 10 * 1024 * 1024,
      files: 5,
    });
  });

  it("drops old lines without keeping copies when the file count is zero", () => {
    const dir = tempDir();
    const path = join(dir, "worker.jsonl");
    const sink = fileSink(path, { maxBytes: 200, files: 0 });
    for (let index = 0; index < 20; index += 1) sink.write(line(index));
    sink.close();
    expect(readdirSync(dir)).toEqual(["worker.jsonl"]);
  });
});

describe("rotating an existing log before start", () => {
  it("moves a file over the limit to .1 and leaves smaller files alone", () => {
    const dir = tempDir();
    const path = join(dir, "desktop-server.log");
    writeFileSync(path, "a".repeat(50));
    expect(rotateIfOver(path, { maxBytes: 100, files: 2 })).toBe(false);
    appendFileSync(path, "b".repeat(100));
    expect(rotateIfOver(path, { maxBytes: 100, files: 2 })).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(`${path}.1`, "utf8")).toHaveLength(150);
  });

  it("copies and empties a file another process still holds open", () => {
    const dir = tempDir();
    const path = join(dir, "ganger.log");
    writeFileSync(path, "old\n".repeat(50));
    writeFileSync(`${path}.1`, "older\n");
    expect(rotateInPlaceIfOver(path, { maxBytes: 100, files: 2 })).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("");
    expect(readFileSync(`${path}.1`, "utf8")).toBe("old\n".repeat(50));
    expect(readFileSync(`${path}.2`, "utf8")).toBe("older\n");
  });
});
