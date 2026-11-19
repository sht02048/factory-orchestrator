import { describe, expect, it } from "vitest";
import { particlesOf } from "./particles";

describe("particlesOf", () => {
  it.each([
    ["0.2.0", "이", "을", "으로"],
    ["0.2.1", "이", "을", "로"],
    ["0.2.2", "가", "를", "로"],
    ["0.3.6", "이", "을", "으로"],
    ["0.2.0-rc.7", "이", "을", "로"],
    ["1.0.0-beta", "가", "를", "로"],
  ])("%s 뒤에는 %s, %s, %s 를 붙인다", (version, subject, object, direction) => {
    expect(particlesOf(version)).toEqual({ subject, object, direction });
  });
});
