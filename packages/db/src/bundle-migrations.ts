import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATE_MODULE = fileURLToPath(new URL("./migrate.ts", import.meta.url));
export const MIGRATIONS_FROM_MODULE = "../drizzle";
const MIGRATIONS_FOLDER = fileURLToPath(new URL(MIGRATIONS_FROM_MODULE, import.meta.url));

type BundleOutput =
  | { type: "chunk"; fileName: string; moduleIds: ReadonlyArray<string> }
  | { type: "asset" };

interface EmitContext {
  emitFile(file: { type: "asset"; fileName: string; source: Uint8Array }): string;
}

export class BundleMigrationsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleMigrationsError";
  }
}

export function migrationOutputs(
  bundle: Readonly<Record<string, BundleOutput>>,
  folder: string = MIGRATIONS_FOLDER,
): Array<{ fileName: string; source: string }> {
  const targets = new Set(
    Object.values(bundle).flatMap((output) =>
      output.type === "chunk" && output.moduleIds.includes(MIGRATE_MODULE)
        ? [posix.join(posix.dirname(output.fileName), MIGRATIONS_FROM_MODULE)]
        : [],
    ),
  );
  const outputs: Array<{ fileName: string; source: string }> = [];
  for (const target of targets) {
    if (target === ".." || target.startsWith("../")) {
      throw new BundleMigrationsError(
        `migrations would land outside the output directory (${target}); place the chunk with migrate.ts in a subdirectory`,
      );
    }
    for (const name of readdirSync(folder).toSorted()) {
      const source = join(folder, name, "migration.sql");
      if (!existsSync(source)) continue;
      outputs.push({ fileName: posix.join(target, name, "migration.sql"), source });
    }
  }
  return outputs;
}

export function bundleMigrations() {
  return {
    name: "factory-bundle-migrations",
    generateBundle(this: EmitContext, _options: unknown, bundle: Record<string, BundleOutput>) {
      for (const { fileName, source } of migrationOutputs(bundle)) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(source) });
      }
    },
  };
}
