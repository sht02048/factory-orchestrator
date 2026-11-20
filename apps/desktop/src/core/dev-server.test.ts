import { describe, expect, it } from "vitest";
import {
  DEV_SERVER_ENV,
  DevServerAddressError,
  bundlelessServer,
  devServerUrl,
} from "./dev-server.js";

describe("devServerUrl", () => {
  it("값이 없거나 비어 있으면 개발 서버에 붙지 않는다", () => {
    expect(devServerUrl({})).toBeUndefined();
    expect(devServerUrl({ [DEV_SERVER_ENV]: "  " })).toBeUndefined();
  });

  it("http 주소를 origin 으로 맞춘다", () => {
    expect(devServerUrl({ [DEV_SERVER_ENV]: "http://127.0.0.1:3000" })).toBe(
      "http://127.0.0.1:3000",
    );
    expect(devServerUrl({ [DEV_SERVER_ENV]: " http://[::1]:4100/runs " })).toBe(
      "http://[::1]:4100",
    );
  });

  it("http·https 가 아닌 값은 이유를 담아 거절한다", () => {
    for (const value of ["127.0.0.1:3000", "file:///tmp/index.html", "http://user:pw@host:1"]) {
      expect(() => devServerUrl({ [DEV_SERVER_ENV]: value })).toThrow(DevServerAddressError);
    }
    expect(() => devServerUrl({ [DEV_SERVER_ENV]: "ftp://example.com" })).toThrow(DEV_SERVER_ENV);
  });
});

describe("bundlelessServer", () => {
  it("개발 서버에 붙을 때는 실행할 서버 묶음 경로가 없다", () => {
    expect(bundlelessServer("0.1.0")).toEqual({
      root: "",
      cliEntry: "",
      version: "0.1.0",
      buildId: "0.1.0+dev-server",
    });
  });
});
