import { describe, expect, it } from "vitest";
import { Route as appRoute } from "../routes/_app";
import { routeTree } from "../routeTree.gen";
import { ScreenError } from "./screen-error";

interface RouteNode {
  id: string;
  options: { errorComponent?: unknown };
  children?: unknown;
}

function isRouteNode(value: unknown): value is RouteNode {
  return typeof value === "object" && value !== null && "id" in value && "options" in value;
}

function childrenOf(route: { children?: unknown }): RouteNode[] {
  const children = route.children;
  if (typeof children !== "object" || children === null) return [];
  return Object.values(children).filter(isRouteNode);
}

describe("셸 안 화면의 오류 화면(0129)", () => {
  it("셸 안 화면 route는 모두 레일을 남기는 공용 오류 화면을 쓴다", () => {
    const appChildren = childrenOf(appRoute);

    expect(appChildren.length).toBeGreaterThan(0);
    expect(
      appChildren.filter((route) => route.options.errorComponent !== ScreenError).map((r) => r.id),
    ).toEqual([]);
  });

  it("셸 자신과 셸 밖 route는 지금처럼 루트 오류 화면에 맡긴다", () => {
    const outside = childrenOf(routeTree).filter((route) => route.id !== appRoute.id);

    expect(appRoute.options.errorComponent).toBeUndefined();
    expect(outside.filter((route) => route.options.errorComponent === ScreenError)).toEqual([]);
  });
});
