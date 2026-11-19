import { describe, expect, it } from "vitest";
import {
  isCompleteDraft,
  labelOwner,
  withDefaultRepo,
  withRepoAdded,
  withRepoLabel,
  withRepoRemoved,
} from "./mapping-draft";
import type { MappingDraft } from "./mapping-draft";
import { saveStatusOf } from "./synced-save";

const draft: MappingDraft = {
  agent: "claude",
  model: "",
  repos: [
    { id: "web", isDefault: true, labelId: null },
    { id: "api", isDefault: false, labelId: "label-api" },
  ],
};

describe("Mapping 고치기(0115)", () => {
  it("처음 더한 저장소가 기본이 되고, 기본이 있으면 라벨 없는 저장소로 더한다", () => {
    const empty: MappingDraft = { agent: null, model: "", repos: [] };
    expect(withRepoAdded(empty, "web").repos).toEqual([
      { id: "web", isDefault: true, labelId: null },
    ]);
    expect(withRepoAdded(draft, "infra").repos.at(-1)).toEqual({
      id: "infra",
      isDefault: false,
      labelId: null,
    });
    expect(withRepoAdded(draft, "api")).toBe(draft);
  });

  it("기본 저장소는 뺄 수 없고 다른 저장소는 뺀다", () => {
    expect(withRepoRemoved(draft, "web")).toBe(draft);
    expect(withRepoRemoved(draft, "api").repos.map((r) => r.id)).toEqual(["web"]);
  });

  it("기본을 바꾸면 새 기본의 라벨을 떼고 이전 기본은 라벨 없는 저장소가 된다", () => {
    expect(withDefaultRepo(draft, "api").repos).toEqual([
      { id: "web", isDefault: false, labelId: null },
      { id: "api", isDefault: true, labelId: null },
    ]);
  });

  it("기본 저장소에는 라벨을 붙이지 않고, 라벨이 어느 저장소에 붙었는지 안다", () => {
    expect(withRepoLabel(draft, "web", "label-x")).toEqual(draft);
    expect(labelOwner(draft, "label-api", "infra")).toBe("api");
    expect(labelOwner(draft, "label-api", "api")).toBeNull();
  });

  it("에이전트와 기본 저장소가 다 있어야 저장한다", () => {
    expect(isCompleteDraft(draft)).toBe(true);
    expect(isCompleteDraft({ ...draft, agent: null })).toBe(false);
    expect(isCompleteDraft({ ...draft, repos: [] })).toBe(false);
  });

  it("행 상태: 보내는 중은 저장 중, 실패는 되돌렸어요, 한 번 저장한 뒤 쉬면 저장했어요", () => {
    expect(saveStatusOf({ kind: "sending" }, false)).toBe("saving");
    expect(saveStatusOf({ kind: "failed", reason: "label-in-use" }, true)).toBe("reverted");
    expect(saveStatusOf({ kind: "idle" }, true)).toBe("saved");
    expect(saveStatusOf({ kind: "idle" }, false)).toBe("idle");
  });
});
