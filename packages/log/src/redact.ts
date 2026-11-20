export const REDACTED = "[redacted]";

const SECRET_KEY =
  /token|secret|passw(or)?d|authorization|cookie|signature|api[-_]?key|private[-_]?key|credential|encryption[-_]?key/i;

const TOKEN_SHAPES: ReadonlyArray<RegExp> = [
  /-----BEGIN [A-Z ]*KEY-----[\s\S]*?(-----END [A-Z ]*KEY-----|$)/g,
  /\bBearer\s+[^\s"',;]+/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}/g,
  /\blin_(api|oauth|wh)_[A-Za-z0-9_-]+/g,
  /\bgh[pousr]_[A-Za-z0-9_]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]+/g,
  /\bxox[abeprs]-[A-Za-z0-9-]+/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bExponentPushToken\[[^\]]*\]/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /(\/\/[^/\s:@]+:)[^@\s/]+@/g,
];

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

export function scrubText(text: string): string {
  let scrubbed = text;
  for (const shape of TOKEN_SHAPES) {
    scrubbed = scrubbed.replace(shape, (match, prefix: unknown) =>
      typeof prefix === "string" && prefix.startsWith("//") ? `${prefix}${REDACTED}@` : REDACTED,
    );
  }
  return scrubbed;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 4) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactValue(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    result[key] = isSecretKey(key) ? REDACTED : redactValue(inner, depth + 1);
  }
  return result;
}
