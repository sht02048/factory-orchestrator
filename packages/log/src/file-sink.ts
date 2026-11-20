import {
  closeSync,
  copyFileSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

export interface RotationLimits {
  maxBytes: number;
  files: number;
}

export function rotatedPath(path: string, index: number): string {
  return `${path}.${index}`;
}

export function shiftRotated(path: string, files: number): void {
  if (files <= 0) {
    rmSync(path, { force: true });
    return;
  }
  rmSync(rotatedPath(path, files), { force: true });
  for (let index = files - 1; index >= 1; index -= 1) {
    const from = rotatedPath(path, index);
    if (existsSync(from)) renameSync(from, rotatedPath(path, index + 1));
  }
}

export function rotateIfOver(path: string, limits: RotationLimits): boolean {
  if (!existsSync(path) || statSync(path).size <= limits.maxBytes) return false;
  shiftRotated(path, limits.files);
  if (limits.files > 0) renameSync(path, rotatedPath(path, 1));
  return true;
}

export function rotateInPlaceIfOver(path: string, limits: RotationLimits): boolean {
  if (!existsSync(path) || statSync(path).size <= limits.maxBytes) return false;
  shiftRotated(path, limits.files);
  if (limits.files > 0) copyFileSync(path, rotatedPath(path, 1));
  truncateSync(path, 0);
  return true;
}

export interface FileSink {
  write(text: string): void;
  close(): void;
}

export function fileSink(path: string, limits: RotationLimits): FileSink {
  let fd: number | undefined;

  const open = (): number => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const opened = openSync(path, "a+", 0o600);
    endPartialLine(opened);
    fd = opened;
    return opened;
  };

  const reopen = (): number => {
    if (fd !== undefined) closeSync(fd);
    fd = undefined;
    return open();
  };

  const rotatedByOther = (current: number): boolean => {
    if (!existsSync(path)) return true;
    return statSync(path).ino !== fstatSync(current).ino;
  };

  return {
    write(text) {
      let current = fd ?? open();
      const bytes = Buffer.byteLength(text);
      const size = fstatSync(current).size;
      if (size > 0 && size + bytes > limits.maxBytes) {
        if (!rotatedByOther(current)) {
          closeSync(current);
          fd = undefined;
          shiftRotated(path, limits.files);
          if (limits.files > 0 && existsSync(path)) renameSync(path, rotatedPath(path, 1));
          else rmSync(path, { force: true });
        }
        current = reopen();
      }
      try {
        writeSync(current, text);
      } catch (error) {
        closeSync(current);
        fd = undefined;
        throw error;
      }
    },
    close() {
      if (fd !== undefined) closeSync(fd);
      fd = undefined;
    },
  };
}

function endPartialLine(fd: number): void {
  const size = fstatSync(fd).size;
  if (size === 0) return;
  const last = Buffer.alloc(1);
  readSync(fd, last, 0, 1, size - 1);
  if (last[0] !== 0x0a) writeSync(fd, "\n");
}
