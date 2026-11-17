import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ENCRYPTION_KEY_BYTES } from "./config.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";

/** 봉한 값을 열지 못함: 키가 다르거나, 값이 바뀌었거나, 다른 자리의 값을 옮겨 왔다. */
export class SecretBoxError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecretBoxError";
  }
}

/**
 * 토큰(트래커 API 키, webhook signing secret, 코드 호스트 토큰)을 DB에 넣기 전에 봉하고 꺼낼 때 연다
 * (ADR 0005, 스펙 7절). AES-256-GCM이고 키는 부팅 설정 `ENCRYPTION_KEY`에서 받는다.
 *
 * `context`는 값이 들어가는 자리(예: `tracker_connections:<id>`)이고 인증 데이터로 묶인다.
 * 한 행의 봉한 값을 다른 행으로 옮겨 붙이면 열리지 않는다.
 *
 * 형식: `v1:<base64(iv | tag | ciphertext)>`
 */
export class SecretBox {
  readonly #key: Uint8Array;

  constructor(key: Uint8Array) {
    if (key.length !== ENCRYPTION_KEY_BYTES) {
      throw new SecretBoxError(`encryption key must be ${ENCRYPTION_KEY_BYTES} bytes`);
    }
    this.#key = Uint8Array.from(key);
  }

  seal(plaintext: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
  }

  open(sealed: string, context: string): string {
    const [version, payload] = sealed.split(":", 2);
    if (version !== VERSION || payload === undefined) {
      throw new SecretBoxError("unknown sealed value format");
    }
    const bytes = Buffer.from(payload, "base64");
    if (bytes.length < IV_BYTES + TAG_BYTES) {
      throw new SecretBoxError("sealed value is too short");
    }
    const iv = bytes.subarray(0, IV_BYTES);
    const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = bytes.subarray(IV_BYTES + TAG_BYTES);
    try {
      const decipher = createDecipheriv(ALGORITHM, this.#key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (cause) {
      throw new SecretBoxError("cannot open sealed value with this key and context", { cause });
    }
  }
}
