import { fileURLToPath } from "node:url";
import { bundleMigrations } from "@ganger/db/bundle-migrations";
import { defineConfig } from "vite";
import { thirdPartyManifest } from "../../scripts/third-party";

export default defineConfig({
  build: {
    ssr: "src/cli.ts",
    outDir: "dist",
    target: "node24",
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "bin/[name].js", banner: "#!/usr/bin/env node" } },
  },
  ssr: { noExternal: true },
  plugins: [
    bundleMigrations(),
    thirdPartyManifest(fileURLToPath(new URL("dist/third-party", import.meta.url)), "cli"),
  ],
});
