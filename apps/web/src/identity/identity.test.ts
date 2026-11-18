import { describe, expect, it } from "vitest";
import { PRODUCT_NAME, PRODUCT_VERSION, identityOf, identitySchema } from "./identity";

describe("신원 확인 응답", () => {
  it("제품 이름·버전·설치 ID·화면 열 수 있는지만 담는다", () => {
    const identity = identityOf("3f1c2b9e-0000-4000-8000-000000000000", "host-not-allowed");
    expect(identity).toEqual({
      product: "factory-orchestrator",
      version: PRODUCT_VERSION,
      instanceId: "3f1c2b9e-0000-4000-8000-000000000000",
      webAccess: "host-not-allowed",
    });
    expect(Object.keys(identity).sort()).toEqual(["instanceId", "product", "version", "webAccess"]);
    expect(identitySchema.parse(JSON.parse(JSON.stringify(identity)))).toEqual(identity);
  });

  it("제품 이름이 다르면 우리 서버가 아니다", () => {
    expect(
      identitySchema.safeParse({
        product: "other",
        version: "1",
        instanceId: "x",
        webAccess: "allowed",
      }).success,
    ).toBe(false);
    expect(PRODUCT_NAME).toBe("factory-orchestrator");
  });

  it("모르는 webAccess 값은 열 수 없음으로 읽는다(값을 더해도 옛 클라이언트가 깨지지 않는다)", () => {
    expect(
      identitySchema.parse({
        product: "factory-orchestrator",
        version: "9.0.0",
        instanceId: "x",
        webAccess: "read-only",
      }).webAccess,
    ).toBe("host-not-allowed");
  });
});
