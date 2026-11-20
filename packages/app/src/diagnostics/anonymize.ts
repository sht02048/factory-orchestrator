export interface KnownValues {
  sshTargets: ReadonlyArray<string>;
  hosts: ReadonlyArray<string>;
  runnerNames: ReadonlyArray<string>;
  ticketKeys: ReadonlyArray<string>;
  userHome: string | null;
  gangerHome: string | null;
}

type Category = "ssh-target" | "host" | "runner" | "home";

const MIN_LITERAL_LENGTH = 3;
const WORD_EDGE = "A-Za-z0-9_-";
const TAILNET_HOST = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.ts\.net\b/gi;
const TAILNET_IP = /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g;
const HOME_PATH = /(?<![A-Za-z0-9_.-])\/(?:Users|home)\/[^/\s"'`:;,)\]}]+/g;
const TICKET_KEY = /^([A-Za-z][A-Za-z0-9]{0,9})-\d+$/;

function escape(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bounded(literal: string): RegExp {
  return new RegExp(`(?<![${WORD_EDGE}])${escape(literal)}(?![${WORD_EDGE}])`, "g");
}

export function hostOfSshTarget(target: string): string {
  const host = target.trim().split("@").at(-1) ?? "";
  if (host.startsWith("["))
    return host.slice(1, host.includes("]") ? host.indexOf("]") : undefined);
  if ((host.match(/:/g)?.length ?? 0) > 1) return host;
  return host.split(":")[0] ?? "";
}

export function hostOfAddress(address: string | null): string | null {
  if (address === null || address.trim() === "") return null;
  try {
    return new URL(address).hostname;
  } catch {
    return null;
  }
}

export interface Anonymizer {
  text(value: string): string;
}

export function createAnonymizer(known: KnownValues): Anonymizer {
  const aliases = new Map<string, string>();
  const counters = new Map<Category, number>();
  const literals: Array<{ literal: string; pattern: RegExp }> = [];
  const register = (category: Category, literal: string, alias?: string): void => {
    const value = literal.trim();
    if (value.length < MIN_LITERAL_LENGTH || aliases.has(value)) return;
    const next = (counters.get(category) ?? 0) + 1;
    counters.set(category, next);
    aliases.set(value, alias ?? `${category}-${next}`);
    literals.push({ literal: value, pattern: bounded(value) });
    literals.sort((a, b) => b.literal.length - a.literal.length);
  };
  if (known.userHome !== null) register("home", known.userHome, "~");
  if (known.gangerHome !== null && !isInside(known.gangerHome, known.userHome)) {
    register("home", known.gangerHome, "<ganger-home>");
  }
  for (const target of known.sshTargets) register("ssh-target", target);
  for (const host of [...known.hosts, ...known.sshTargets.map(hostOfSshTarget)]) {
    register("host", host);
  }
  for (const name of known.runnerNames) register("runner", name);
  const prefixes = ticketPrefixes(known.ticketKeys);
  const ticketPatterns = [...prefixes].map((prefix, index) => {
    const alias = `PROJ${index + 1}`;
    return {
      pattern: new RegExp(`(?<![A-Za-z0-9])${escape(prefix)}-(\\d+)(?![A-Za-z0-9])`, "gi"),
      alias,
    };
  });
  return {
    text(value) {
      for (const match of value.matchAll(TAILNET_HOST)) register("host", match[0]);
      for (const match of value.matchAll(TAILNET_IP)) register("host", match[0]);
      let result = value;
      for (const { literal, pattern } of literals) {
        result = result.replace(pattern, aliases.get(literal) ?? literal);
      }
      result = result.replace(HOME_PATH, "~");
      for (const { pattern, alias } of ticketPatterns) {
        result = result.replace(pattern, (match, number: string) =>
          match === match.toLowerCase() ? `${alias.toLowerCase()}-${number}` : `${alias}-${number}`,
        );
      }
      return result;
    },
  };
}

function isInside(path: string, parent: string | null): boolean {
  return parent !== null && (path === parent || path.startsWith(`${parent}/`));
}

function ticketPrefixes(keys: ReadonlyArray<string>): Set<string> {
  const prefixes = new Set<string>();
  for (const key of keys) {
    const prefix = TICKET_KEY.exec(key.trim())?.[1];
    if (prefix !== undefined) prefixes.add(prefix.toUpperCase());
  }
  return prefixes;
}
