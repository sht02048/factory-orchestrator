import { expect, test } from "vitest";

test("verify that check fails when a browser shard fails", () => {
  expect(1).toBe(2);
});
