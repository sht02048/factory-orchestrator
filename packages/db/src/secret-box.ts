import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ENCRYPTION_KEY_BYTES } from "./config.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";

export class SecretBoxError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SecretBoxError";
  }
}

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
