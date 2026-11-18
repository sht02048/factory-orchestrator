import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { thirdPartyManifest } from "../../scripts/third-party";

export default defineConfig({
  build: {
    ssr: "src/main/main.ts",
    outDir: "dist/main",
    target: "node24",
    emptyOutDir: true,
    rollupOptions: { external: ["electron"], output: { entryFileNames: "main.js", format: "es" } },
  },
  ssr: { noExternal: true, external: ["electron"] },
  plugins: [
    thirdPartyManifest(fileURLToPath(new URL("dist/third-party", import.meta.url)), "main"),
  ],
});
