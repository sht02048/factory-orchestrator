import { describe, expect, it } from "vitest";

import { isDefined } from "./index.js";

describe("isDefined", () => {
  it("null과 undefined를 걸러 낸다", () => {
    const values: Array<number | null | undefined> = [1, null, 0, undefined];

    expect(values.filter(isDefined)).toEqual([1, 0]);
  });
});
