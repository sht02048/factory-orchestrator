import { describe, expect, it } from "vitest";
import type { ConnectionLabel } from "@ganger/app/settings/model";
import { CREATE_LABEL, labelOptions } from "./label-picker";

const text = {
  create: (name: string) => `create ${name}`,
  pickExisting: (name: string) => `pick ${name}`,
  missing: (id: string) => `missing ${id}`,
  repoLabel: (name: string, repo: string) => `${name} used by ${repo}`,
};

function connection(
  items: Array<{ id: string; name: string }>,
  repoLabels: ConnectionLabel["repoLabels"] = [],
): ConnectionLabel {
  return {
    connection: { id: "c", name: "Acme" },
    labelId: null,
    labels: { ok: true, items },
    repoLabels,
  };
}

describe("Auto-assign Label 고르기 목록(0115)", () => {
  it("ganger 라벨이 없으면 첫 줄은 만들기, 있으면 고르기다", () => {
    expect(labelOptions(connection([{ id: "a", name: "api" }]), null, text, null)[0]).toEqual({
      value: CREATE_LABEL,
      label: "create ganger",
    });
    expect(labelOptions(connection([{ id: "g", name: "Ganger" }]), null, text, null)[0]).toEqual({
      value: CREATE_LABEL,
      label: "pick Ganger",
    });
  });

  it("저장소를 가르는 라벨은 끄고 이유를 보이며, ganger가 그런 라벨이면 첫 줄도 끈다", () => {
    const options = labelOptions(
      connection(
        [
          { id: "a", name: "api" },
          { id: "g", name: "ganger" },
        ],
        [
          { labelId: "a", repo: "acme/api", project: "Web" },
          { labelId: "g", repo: "acme/infra", project: "Web" },
        ],
      ),
      null,
      text,
      null,
    );
    expect(options).toEqual([
      { value: CREATE_LABEL, label: "ganger used by acme/infra", disabled: true },
      { value: "a", label: "api used by acme/api", disabled: true },
      { value: "g", label: "ganger used by acme/infra", disabled: true },
    ]);
  });

  it("고른 라벨이 목록에 없으면 빼지 않고 끝에 둔다", () => {
    expect(labelOptions(connection([]), null, text, "old").at(-1)).toEqual({
      value: "old",
      label: "missing old",
    });
  });
});
