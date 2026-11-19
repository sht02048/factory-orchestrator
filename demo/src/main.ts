import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import { devPageRoutes, injectDevTools, swapWebAdapters, swapWebWorkerWake } from "./plugins.ts";
import type { DevMode } from "./runtime.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
const webRoot = join(repoRoot, "apps/web");

const { values } = parseArgs({
  options: {
    onboarding: { type: "boolean", default: false },
    reset: { type: "boolean", default: false },
    static: { type: "boolean", default: false },
  },
  strict: true,
});

const mode: DevMode = values.onboarding ? "onboarding" : "seeded";
const devRoot = resolve(process.env["GANGER_DEV_DIR"] ?? join(repoRoot, ".dev"));
const dataDir = join(devRoot, mode);
if (values.reset && existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
  console.info(`[dev] reset ${dataDir}`);
}
mkdirSync(dataDir, { recursive: true });

const keyFile = join(dataDir, "encryption-key");
if (!existsSync(keyFile)) {
  writeFileSync(keyFile, randomBytes(32).toString("base64"), { mode: 0o600 });
}
const encryptionKeyText = readFileSync(keyFile, "utf8").trim();
const databasePath = join(dataDir, "ganger.db");
const host = process.env["WEB_HOST"] ?? "127.0.0.1";
const portText = process.env["WEB_PORT"] ?? "3000";
const port = Number(portText);
if (!/^\d+$/.test(portText) || port < 1 || port > 65_535) {
  throw new Error(`WEB_PORT must be a port number: ${process.env["WEB_PORT"]}`);
}

process.env["DATABASE_PATH"] = databasePath;
process.env["ENCRYPTION_KEY"] = encryptionKeyText;
process.env["WEB_HOST"] = host;
process.env["WEB_PORT"] = String(port);

const server = await createServer({
  root: webRoot,
  configFile: join(webRoot, "vite.config.ts"),
  plugins: [swapWebAdapters(), swapWebWorkerWake(), injectDevTools(), devPageRoutes()],
  server: {
    host,
    port,
    strictPort: true,
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem,key,p12,pfx,cer,der}",
        ".npmrc",
        ".yarnrc.yml",
        "**/.git/**",
        "**/.dev/**",
        "**/encryption-key",
        "**/*.db",
        "**/*.db-*",
      ],
    },
  },
});

await server.ssrLoadModule(join(import.meta.dirname, "runtime.ts"));
const dev = globalThis.__gangerDev;
if (dev === undefined) throw new Error("dev runtime did not load");
const runtime = await dev.start({
  mode,
  databasePath,
  encryptionKey: new Uint8Array(Buffer.from(encryptionKeyText, "base64")),
  life: !values.static,
});

await server.listen();
const address = server.httpServer?.address();
const listening = typeof address === "object" && address !== null ? address.port : port;
const shown = host === "0.0.0.0" ? "127.0.0.1" : host.includes(":") ? `[${host}]` : host;
console.info(
  [
    `[dev] ${mode === "seeded" ? "seeded data" : "onboarding"}${runtime.seeded ? " (new seed)" : ""}, data in ${dataDir}`,
    `[dev] Web is listening at http://${shown}:${listening}`,
    `[dev] Dev tools at http://${shown}:${listening}/__dev`,
  ].join("\n"),
);

let stopping = false;
const stop = (signal: NodeJS.Signals): void => {
  if (stopping) return;
  stopping = true;
  console.info(`[dev] ${signal} received, stopping`);
  Promise.all([runtime.stop(), server.close()]).then(
    () => process.exit(0),
    (error: unknown) => {
      console.error("[dev] could not stop cleanly", error);
      process.exit(1);
    },
  );
};
process.removeAllListeners("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
