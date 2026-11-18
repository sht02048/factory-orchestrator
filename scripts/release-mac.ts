import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { packageVersion } from "./release-plan.ts";

const PRODUCT = "Ganger";
const DEVELOPER_ID = "Developer ID Application";

export interface NotaryCredentials {
  keyPath: string;
  keyId: string;
  issuer: string;
}

export type Signing =
  | { kind: "unsigned" }
  | { kind: "signed"; notary: NotaryCredentials; keychain: string | null };

const NOTARY_ENV = ["APPLE_API_KEY_PATH", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"] as const;

export function signingFromEnv(env: Readonly<Record<string, string | undefined>>): Signing {
  const values = NOTARY_ENV.map((name) => env[name] ?? "");
  const [keyPath = "", keyId = "", issuer = ""] = values;
  const missing = NOTARY_ENV.filter((_, index) => values[index] === "");
  if (missing.length === NOTARY_ENV.length) return { kind: "unsigned" };
  if (missing.length > 0) {
    throw new Error(
      `Set all of ${NOTARY_ENV.join(", ")} to sign, or none. Missing: ${missing.join(", ")}`,
    );
  }
  const keychain = env["MACOS_SIGN_KEYCHAIN"] ?? "";
  return {
    kind: "signed",
    notary: { keyPath, keyId, issuer },
    keychain: keychain === "" ? null : keychain,
  };
}

export function developerIdIdentity(findIdentityOutput: string): string {
  const hashes = new Set<string>();
  for (const line of findIdentityOutput.split("\n")) {
    const match = /^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"/.exec(line);
    if (match?.[1] !== undefined && match[2]?.startsWith(`${DEVELOPER_ID}:`) === true) {
      hashes.add(match[1]);
    }
  }
  const [only, ...rest] = hashes;
  if (only === undefined) throw new Error(`No valid "${DEVELOPER_ID}" identity in the keychain`);
  if (rest.length > 0) {
    throw new Error(`More than one "${DEVELOPER_ID}" identity; keep only one in the keychain`);
  }
  return only;
}

export function notaryStatus(output: string): { id: string; status: string } {
  const parsed: unknown = JSON.parse(output);
  if (typeof parsed === "object" && parsed !== null && "id" in parsed && "status" in parsed) {
    const { id, status } = parsed;
    if (typeof id === "string" && typeof status === "string") return { id, status };
  }
  throw new Error(`Unexpected notarytool output: ${output}`);
}

function run(command: string, args: ReadonlyArray<string>, options: SpawnSyncOptions = {}): string {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: ["ignore", "pipe", "inherit"], ...options });
  const stdout = result.stdout?.toString() ?? "";
  if (result.status !== 0) {
    process.stdout.write(stdout);
    throw new Error(`${command} exited with ${result.status ?? result.signal ?? "unknown"}`);
  }
  return stdout;
}

function notarize(path: string, notary: NotaryCredentials): void {
  const credentials = [
    "--key",
    notary.keyPath,
    "--key-id",
    notary.keyId,
    "--issuer",
    notary.issuer,
  ];
  const result = notaryStatus(
    run("xcrun", [
      "notarytool",
      "submit",
      path,
      ...credentials,
      "--wait",
      "--output-format",
      "json",
    ]),
  );
  console.log(`notarization ${result.id}: ${result.status}`);
  if (result.status !== "Accepted") {
    process.stdout.write(run("xcrun", ["notarytool", "log", result.id, ...credentials]));
    throw new Error(`Notarization of ${path} ended with ${result.status}`);
  }
}

function main(): void {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const signing = signingFromEnv(process.env);
  const version = packageVersion(readFileSync(join(root, "package.json"), "utf8"), "package.json");
  const arch = process.arch;
  const out = join(root, "dist", "release");
  const work = join(out, "work");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const identity =
    signing.kind === "signed"
      ? developerIdIdentity(
          run("security", [
            "find-identity",
            "-v",
            "-p",
            "codesigning",
            ...(signing.keychain === null ? [] : [signing.keychain]),
          ]),
        )
      : null;
  console.log(
    identity === null ? "signing: skipped (no notary credentials)" : "signing: Developer ID",
  );

  const inRoot: SpawnSyncOptions = { cwd: root, stdio: "inherit" };
  run("pnpm", ["run", "build"], inRoot);
  run("pnpm", ["run", "bundle"], inRoot);
  run(
    process.execPath,
    [
      join(root, "apps", "desktop", "scripts", "package.ts"),
      "--arch",
      arch,
      "--out",
      join(work, "app"),
      ...(identity === null ? [] : ["--sign-identity", identity]),
      ...(signing.kind === "signed" && signing.keychain !== null
        ? ["--keychain", signing.keychain]
        : []),
    ],
    inRoot,
  );
  const app = join(work, "app", `${PRODUCT}-darwin-${arch}`, `${PRODUCT}.app`);

  if (signing.kind === "signed") {
    const appZip = join(work, `${PRODUCT}-notarize.zip`);
    run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, appZip]);
    notarize(appZip, signing.notary);
    rmSync(appZip);
    run("xcrun", ["stapler", "staple", app]);
  }

  const volume = join(work, "volume");
  mkdirSync(volume);
  run("ditto", [app, join(volume, `${PRODUCT}.app`)]);
  symlinkSync("/Applications", join(volume, "Applications"));
  const dmg = join(out, `${PRODUCT}-${version}-${arch}.dmg`);
  run("hdiutil", [
    "create",
    "-volname",
    PRODUCT,
    "-srcfolder",
    volume,
    "-fs",
    "HFS+",
    "-format",
    "UDZO",
    "-ov",
    dmg,
  ]);

  if (signing.kind === "signed" && identity !== null) {
    run("codesign", [
      "--sign",
      identity,
      "--timestamp",
      ...(signing.keychain === null ? [] : ["--keychain", signing.keychain]),
      dmg,
    ]);
    notarize(dmg, signing.notary);
    run("xcrun", ["stapler", "staple", dmg]);
  }

  rmSync(work, { recursive: true, force: true });
  console.log(`dmg: ${dmg}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
