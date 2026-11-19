import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const BACKGROUND_SIZE = { width: 540, height: 380 } as const;

const BRAND = fileURLToPath(new URL("../packages/ui/brand/dmg/", import.meta.url));
export const BACKGROUND_SVG = join(BRAND, "background.svg");
export const BACKGROUND_PNG = join(BRAND, "background.png");
export const BACKGROUND_PNG_2X = join(BRAND, "background@2x.png");

const CHROME =
  process.env["CHROME_PATH"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export function pngSize(png: Uint8Array): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const isPng = signature.every((byte, index) => png[index] === byte);
  if (!isPng || png.byteLength < 24) throw new Error("Not a PNG file");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function render(svg: string, scale: number, out: string): void {
  const work = mkdtempSync(join(tmpdir(), "ganger-dmg-background-"));
  try {
    const page = join(work, "page.html");
    const shot = join(work, "shot.png");
    writeFileSync(
      page,
      `<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`,
    );
    const result = spawnSync(
      CHROME,
      [
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        "--default-background-color=00000000",
        `--force-device-scale-factor=${scale}`,
        `--window-size=${BACKGROUND_SIZE.width},${BACKGROUND_SIZE.height}`,
        `--screenshot=${shot}`,
        `file://${page}`,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    if (result.status !== 0) {
      process.stderr.write(result.stderr ?? "");
      throw new Error(`Chrome exited with ${result.status ?? "unknown"}`);
    }
    const size = pngSize(readFileSync(shot));
    const expected = {
      width: BACKGROUND_SIZE.width * scale,
      height: BACKGROUND_SIZE.height * scale,
    };
    if (size.width !== expected.width || size.height !== expected.height) {
      throw new Error(
        `Rendered ${size.width}x${size.height}, expected ${expected.width}x${expected.height}`,
      );
    }
    copyFileSync(shot, out);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main(): void {
  const svg = readFileSync(BACKGROUND_SVG, "utf8");
  render(svg, 1, BACKGROUND_PNG);
  render(svg, 2, BACKGROUND_PNG_2X);
  console.log(`dmg background: ${BACKGROUND_PNG}, ${BACKGROUND_PNG_2X}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
