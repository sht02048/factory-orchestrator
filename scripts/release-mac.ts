import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDmg } from "./check-dmg.ts";
import { BACKGROUND_PNG } from "./dmg-background.ts";
import { packageVersion } from "./release-plan.ts";
import { manualUpdateNotice, releaseRepository, updateArtifacts } from "./release-update.ts";

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

const SECRET_ARGS = new Set<string>();

const NOTARY_ENV = ["APPLE_API_KEY_PATH", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"] as const;

export function signingFromEnv(env: Readonly<Record<string, string | undefined>>): Signing {
  const values = NOTARY_ENV.map((name) => env[name] ?? "");
  const [keyPath = "", keyId = "", issuer = ""] = values;
  const missing = NOTARY_ENV.filter((_, index) => values[index] === "");
  const keychain = env["MACOS_SIGN_KEYCHAIN"] ?? "";
  if (missing.length === NOTARY_ENV.length) {
    if (keychain !== "")
      throw new Error(`MACOS_SIGN_KEYCHAIN is set without ${NOTARY_ENV.join(", ")}`);
    return { kind: "unsigned" };
  }
  if (missing.length > 0) {
    throw new Error(
      `Set all of ${NOTARY_ENV.join(", ")} to sign, or none. Missing: ${missing.join(", ")}`,
    );
  }
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
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(output);
  } catch {
    parsed = null;
  }
  if (typeof parsed === "object" && parsed !== null && "id" in parsed && "status" in parsed) {
    const { id, status } = parsed;
    if (typeof id === "string" && typeof status === "string") return { id, status };
  }
  throw new Error(`Unexpected notarytool output: ${output}`);
}

function run(
  command: string,
  args: ReadonlyArray<string>,
  options: SpawnSyncOptions = {},
  allowFailure = false,
): string {
  console.log(`$ ${command} ${args.map((arg) => (SECRET_ARGS.has(arg) ? "***" : arg)).join(" ")}`);
  const result = spawnSync(command, args, { stdio: ["ignore", "pipe", "inherit"], ...options });
  const stdout = result.stdout?.toString() ?? "";
  if (result.status !== 0 && !allowFailure) {
    process.stdout.write(stdout);
    throw new Error(`${command} exited with ${result.status ?? result.signal ?? "unknown"}`);
  }
  return stdout;
}

export interface DmgbuildInput {
  root: string;
  app: string;
  dmg: string;
}

export function dmgbuildArgs({ root, app, dmg }: DmgbuildInput): string[] {
  return [
    "-s",
    join(root, "scripts", "dmg-settings.py"),
    "-D",
    `app=${app}`,
    "-D",
    `background=${BACKGROUND_PNG}`,
    "-D",
    `icon=${join(root, "apps", "desktop", "icons", "icon.icns")}`,
    PRODUCT,
    dmg,
  ];
}

function installDmgbuild(root: string, work: string): string {
  const venv = join(work, "dmgbuild");
  const uv = spawnSync("uv", ["--version"], { stdio: "ignore" });
  if (uv.error !== undefined || uv.status !== 0) {
    throw new Error("uv is required to install dmgbuild: https://docs.astral.sh/uv/");
  }
  run("uv", ["venv", "--quiet", "--python", "3.12", venv]);
  run("uv", [
    "pip",
    "install",
    "--quiet",
    "--python",
    join(venv, "bin", "python"),
    "--require-hashes",
    "-r",
    join(root, "scripts", "dmgbuild-requirements.txt"),
  ]);
  return join(venv, "bin", "dmgbuild");
}

function notarize(path: string, notary: NotaryCredentials): void {
  SECRET_ARGS.add(notary.keyId).add(notary.issuer);
  const credentials = [
    "--key",
    notary.keyPath,
    "--key-id",
    notary.keyId,
    "--issuer",
    notary.issuer,
  ];
  const result = notaryStatus(
    run(
      "xcrun",
      ["notarytool", "submit", path, ...credentials, "--wait", "--output-format", "json"],
      {},
      true,
    ),
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
  const repository = releaseRepository(process.env);
  const tag = process.env["RELEASE_TAG"] ?? `v${version}`;
  const arch = process.arch;
  const out = join(root, "dist", "release");
  const work = join(out, "work");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const dmgbuild = installDmgbuild(root, work);

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
      ...(repository === null ? [] : ["--update-repository", repository]),
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

  const update =
    repository === null
      ? null
      : updateArtifacts({ repository, tag, version, arch, publishedAt: new Date().toISOString() });
  if (update !== null) {
    run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, join(out, update.zipName)]);
    writeFileSync(join(out, update.feedName), update.feed);
  }
  console.log(
    update === null
      ? "update files: skipped (no GITHUB_REPOSITORY or GANGER_RELEASE_REPOSITORY)"
      : `update files: ${update.zipName}, ${update.feedName}`,
  );

  const dmg = join(out, `${PRODUCT}-${version}-${arch}.dmg`);
  run(dmgbuild, dmgbuildArgs({ root, app, dmg }), { stdio: "inherit" });
  checkDmg(dmg);

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
  const notes = join(out, "release-notes.md");
  const notice = manualUpdateNotice(version);
  writeFileSync(notes, notice === null ? "" : `${notice}\n`);
  console.log(`dmg: ${dmg}`);
  const outputFile = process.env["GITHUB_OUTPUT"];
  if (outputFile !== undefined) {
    appendFileSync(outputFile, `dmg=${dmg}\nnotes=${notes}\n`);
    if (update !== null) {
      appendFileSync(
        outputFile,
        `update-zip=${join(out, update.zipName)}\nupdate-feed=${join(out, update.feedName)}\n`,
      );
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
