export const EXTERNAL_KEYS: ReadonlySet<string> = new Set([
  "ticketTitle",
  "title",
  "body",
  "choices",
  "detail",
  "lines",
  "report",
  "startError",
  "hint",
  "brief",
]);

export const EXTERNAL_FIELD = "external";

export function separateExternal(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(separateExternal);
  if (value === null || typeof value !== "object") return value;
  const own: Record<string, unknown> = {};
  const external: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === EXTERNAL_FIELD) Object.assign(external, item);
    else if (EXTERNAL_KEYS.has(key)) external[key] = item;
    else own[key] = separateExternal(item);
  }
  return Object.keys(external).length === 0 ? own : { ...own, [EXTERNAL_FIELD]: external };
}
