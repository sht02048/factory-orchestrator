export * from "./ids.js";
export * from "./run.js";
export * from "./summary.js";
export * from "./transition.js";

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
