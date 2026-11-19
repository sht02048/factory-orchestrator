import { describe, expect, it } from "vitest";
import { electronAccelerator, navigationMenu } from "./navigation-menu.js";

describe("이동 메뉴(0102)", () => {
  it("Mod 를 맥은 Command, 그 밖은 Control 로 받는 accelerator 로 바꾼다", () => {
    expect(electronAccelerator("Mod+1")).toBe("CommandOrControl+1");
    expect(electronAccelerator("Mod+,")).toBe("CommandOrControl+,");
  });

  it("레일 순서대로 여섯 화면을 키와 함께 늘어놓고, 누르면 그 화면으로 보낸다", () => {
    const sent: string[] = [];
    const menu = navigationMenu({
      label: "이동",
      screenLabel: (screen) => `label:${screen}`,
      enabled: true,
      onNavigate: (screen) => sent.push(screen),
    });
    expect(menu.label).toBe("이동");
    const items = Array.isArray(menu.submenu) ? menu.submenu : [];
    expect(items.map((item) => [item.label, item.accelerator, item.enabled])).toEqual([
      ["label:dashboard", "CommandOrControl+1", true],
      ["label:tickets", "CommandOrControl+2", true],
      ["label:runs", "CommandOrControl+3", true],
      ["label:runners", "CommandOrControl+4", true],
      ["label:stats", "CommandOrControl+5", true],
      ["label:settings", "CommandOrControl+,", true],
    ]);
    for (const item of items)
      if (item.click !== undefined) Reflect.apply(item.click, undefined, []);
    expect(sent).toEqual(["dashboard", "tickets", "runs", "runners", "stats", "settings"]);
  });

  it("서버 화면이 열리지 않았으면 메뉴 항목을 끈다", () => {
    const menu = navigationMenu({
      label: "이동",
      screenLabel: (screen) => screen,
      enabled: false,
      onNavigate: () => undefined,
    });
    const items = Array.isArray(menu.submenu) ? menu.submenu : [];
    expect(items.every((item) => item.enabled === false)).toBe(true);
  });
});
