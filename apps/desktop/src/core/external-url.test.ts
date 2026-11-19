import { describe, expect, it } from "vitest";
import { opensOutsideApp } from "./external-url.js";

describe("opensOutsideApp", () => {
  it("opens web links and the Sharing settings link outside the app", () => {
    expect(opensOutsideApp("https://github.com/settings/tokens")).toBe(true);
    expect(
      opensOutsideApp(
        "x-apple.systempreferences:com.apple.preferences.sharing?Services_RemoteLogin",
      ),
    ).toBe(true);
  });

  it("keeps other schemes inside", () => {
    expect(opensOutsideApp("file:///etc/passwd")).toBe(false);
    expect(opensOutsideApp("x-apple.systempreferences:com.apple.preference.security")).toBe(false);
    expect(opensOutsideApp("javascript:alert(1)")).toBe(false);
  });
});
