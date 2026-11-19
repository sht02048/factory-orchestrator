import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { CommandRunner } from "./commands.js";
import { failureDetail } from "./commands.js";

export interface GangerSshPaths {
  dir: string;
  identityFile: string;
  publicKeyFile: string;
  knownHostsFile: string;
}

export function gangerSshPaths(gangerHome: string): GangerSshPaths {
  const dir = join(gangerHome, "ssh");
  return {
    dir,
    identityFile: join(dir, "id_ed25519"),
    publicKeyFile: join(dir, "id_ed25519.pub"),
    knownHostsFile: join(dir, "known_hosts"),
  };
}

const publicKeyLine = z
  .string()
  .trim()
  .regex(/^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa) [A-Za-z0-9+/]+={0,3}( [^\n]*)?$/);

export type PublicKey = { type: string; body: string };

export function parsePublicKey(text: string): PublicKey | null {
  const line = text.split("\n").find((l) => l.trim() !== "");
  const parsed = publicKeyLine.safeParse(line ?? "");
  if (!parsed.success) return null;
  const [type, body] = parsed.data.split(" ");
  return type === undefined || body === undefined ? null : { type, body };
}

export type KeyResult = { ok: true; publicKey: PublicKey } | { ok: false; detail: string };

export async function ensureGangerSshKey(
  paths: GangerSshPaths,
  run: CommandRunner,
): Promise<KeyResult> {
  try {
    mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
    chmodSync(paths.dir, 0o700);
    if (!existsSync(paths.identityFile)) {
      const result = await run("ssh-keygen", [
        "-q",
        "-t",
        "ed25519",
        "-N",
        "",
        "-C",
        "ganger",
        "-f",
        paths.identityFile,
      ]);
      if (result.exitCode !== 0) return { ok: false, detail: failureDetail(result) };
    }
    chmodSync(paths.identityFile, 0o600);
    if (!existsSync(paths.publicKeyFile)) {
      const result = await run("ssh-keygen", ["-y", "-f", paths.identityFile]);
      if (result.exitCode !== 0) return { ok: false, detail: failureDetail(result) };
      writeFileSync(paths.publicKeyFile, result.stdout, { mode: 0o644 });
    }
    const publicKey = parsePublicKey(readFileSync(paths.publicKeyFile, "utf8"));
    if (publicKey === null) {
      return { ok: false, detail: `${paths.publicKeyFile} is not an ssh public key` };
    }
    return { ok: true, publicKey };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function keyLines(file: string): string[] {
  return existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
}

function appendLine(file: string, line: string, mode: number): void {
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  appendFileSync(file, `${separator}${line}\n`, { mode });
  chmodSync(file, mode);
}

export const LOCAL_ONLY_KEY_OPTIONS = 'from="127.0.0.1,::1"';

export function authorizeKey(userHome: string, key: PublicKey, options: string): void {
  const sshDir = join(userHome, ".ssh");
  mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  chmodSync(sshDir, 0o700);
  const file = join(sshDir, "authorized_keys");
  const lines = keyLines(file);
  const present = lines.some((line) => line.split(/\s+/).includes(key.body));
  if (present) {
    chmodSync(file, 0o600);
    return;
  }
  appendLine(file, `${options} ${key.type} ${key.body} ganger`, 0o600);
}

export function pinHostKey(knownHostsFile: string, host: string, key: PublicKey): void {
  mkdirSync(dirname(knownHostsFile), { recursive: true, mode: 0o700 });
  const lines = keyLines(knownHostsFile);
  const present = lines.some((line) => {
    const [hosts, type, body] = line.split(/\s+/);
    return hosts?.split(",").includes(host) === true && type === key.type && body === key.body;
  });
  if (present) return;
  appendLine(knownHostsFile, `${host} ${key.type} ${key.body}`, 0o600);
}
