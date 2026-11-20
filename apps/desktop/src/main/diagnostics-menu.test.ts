import { describe, expect, it } from "vitest";
import { diagnosticsMenuItem, diagnosticsUrl, logFolderOpenable } from "./diagnostics-menu";

describe("diagnostics menu", () => {
  it("downloads the anonymized bundle from the connected server", () => {
    const downloads: string[] = [];
    const item = diagnosticsMenuItem({
      label: "진단 묶음 만들기…",
      serverUrl: "http://127.0.0.1:3000/runs",
      download: (url) => downloads.push(url),
    });
    expect(item.enabled).toBe(true);
    if (item.click !== undefined) Reflect.apply(item.click, undefined, []);
    expect(downloads).toEqual(["http://127.0.0.1:3000/api/diagnostics"]);
    expect(diagnosticsUrl("https://ganger.example.com")).toBe(
      "https://ganger.example.com/api/diagnostics",
    );
  });

  it("is turned off until a server is open", () => {
    const item = diagnosticsMenuItem({ label: "x", serverUrl: undefined, download: () => {} });
    expect(item.enabled).toBe(false);
  });

  it("opens the log folder only for the server this app started on this computer", () => {
    expect(logFolderOpenable("local")).toBe(true);
    expect(logFolderOpenable("remote")).toBe(false);
    expect(logFolderOpenable("choosing")).toBe(false);
  });
});
