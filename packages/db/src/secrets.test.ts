import { existsSync, readFileSync } from "node:fs";
import { toCodeHostKind, toTrackerConnectionId, toTrackerKind } from "@ganger/core";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import { toCodeHostConnectionId } from "./ids.js";
import { migrate } from "./migrate.js";
import { SecretBox, SecretBoxError } from "./secret-box.js";
import {
  getTrackerConnection,
  listCodeHostConnections,
  saveCodeHostConnection,
  saveTrackerConnection,
} from "./settings.js";
import { KEY, tempDatabasePath } from "./test-fixtures.js";

const API_KEY = "lin_api_PLAINTEXT_SHOULD_NOT_LEAK_1234";
const WEBHOOK_SECRET = "whsec_PLAINTEXT_SHOULD_NOT_LEAK_5678";
const GITHUB_TOKEN = "github_pat_PLAINTEXT_SHOULD_NOT_LEAK_9012";
const connectionId = toTrackerConnectionId("conn-1");

function fileBytes(path: string): string {
  return [path, `${path}-wal`, `${path}-shm`]
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p).toString("latin1"))
    .join("");
}

describe("토큰 암호화 저장", () => {
  let cleanup: () => void = () => {};
  afterEach(() => cleanup());

  it("저장한 토큰이 DB 파일에 평문으로 남지 않고, 같은 키로 복호화된다", () => {
    const temp = tempDatabasePath();
    cleanup = temp.cleanup;

    const db = openDatabase(temp.path);
    migrate(db);
    const box = new SecretBox(KEY);
    saveTrackerConnection(db, box, {
      id: connectionId,
      kind: toTrackerKind("linear"),
      name: "Acme",
      config: { webhookPath: "/webhooks/acme" },
      secrets: { apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET },
    });
    saveCodeHostConnection(db, box, {
      id: toCodeHostConnectionId("gh-1"),
      kind: toCodeHostKind("github"),
      name: "GitHub",
      config: {},
      secrets: { token: GITHUB_TOKEN },
    });

    for (const secret of [API_KEY, WEBHOOK_SECRET, GITHUB_TOKEN]) {
      expect(fileBytes(temp.path)).not.toContain(secret);
    }
    db.$client.close();
    for (const secret of [API_KEY, WEBHOOK_SECRET, GITHUB_TOKEN]) {
      expect(fileBytes(temp.path)).not.toContain(secret);
    }

    const reopened = openDatabase(temp.path);
    const sameKey = new SecretBox(Uint8Array.from(KEY));
    expect(getTrackerConnection(reopened, sameKey, connectionId)).toEqual({
      id: connectionId,
      kind: "linear",
      name: "Acme",
      config: { webhookPath: "/webhooks/acme" },
      secrets: { apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET },
    });
    expect(listCodeHostConnections(reopened, sameKey)[0]?.secrets).toEqual({ token: GITHUB_TOKEN });

    const otherKey = new SecretBox(new Uint8Array(32).fill(9));
    expect(() => getTrackerConnection(reopened, otherKey, connectionId)).toThrow(SecretBoxError);
    reopened.$client.close();
  });

  it("봉한 값을 다른 행으로 옮기면 열리지 않는다", () => {
    const box = new SecretBox(KEY);
    const sealed = box.seal(API_KEY, "tracker_connections:conn-1");
    expect(box.open(sealed, "tracker_connections:conn-1")).toBe(API_KEY);
    expect(() => box.open(sealed, "tracker_connections:conn-2")).toThrow(SecretBoxError);
  });

  it("같은 값도 봉할 때마다 다르게 나온다", () => {
    const box = new SecretBox(KEY);
    expect(box.seal(API_KEY, "c")).not.toBe(box.seal(API_KEY, "c"));
  });

  it("32바이트가 아닌 키를 거부한다", () => {
    expect(() => new SecretBox(new Uint8Array(16))).toThrow(SecretBoxError);
  });
});
