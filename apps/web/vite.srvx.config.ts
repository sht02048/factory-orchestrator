import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { thirdPartyManifest } from "../../scripts/third-party";

export default defineConfig({
  build: {
    ssr: "src/srvx-cli.ts",
    outDir: "dist/srvx",
    target: "node24",
    emptyOutDir: false,
    rollupOptions: { output: { entryFileNames: "srvx.js" } },
  },
  ssr: { noExternal: true },
  plugins: [
    thirdPartyManifest(fileURLToPath(new URL("dist/third-party", import.meta.url)), "srvx"),
  ],
});
