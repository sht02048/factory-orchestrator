import { describe, expect, it } from "vitest";
import {
  MOTION_BURST_LIMIT,
  chooseMoveStyle,
  diffMotionOrders,
  reconcileMotionRows,
  type MotionBox,
  type MotionRow,
} from "./components/motion-plan";

const viewport: MotionBox = { left: 0, top: 0, right: 1000, bottom: 800 };
const box = (left: number, top: number): MotionBox => ({
  left,
  top,
  right: left + 200,
  bottom: top + 60,
});
const slideInput = {
  changeCount: 1,
  reducedMotion: false,
  crossesList: true,
  from: box(0, 0),
  to: box(320, 0),
  visibleArea: viewport,
};

describe("한꺼번에 많이 바뀜 판단(M3)", () => {
  it("한 행을 맨 위로 올리면 밀려난 행은 세지 않고 1건이다", () => {
    const changes = diffMotionOrders(
      [{ listId: "a", keys: ["1", "2", "3", "4", "5", "6"] }],
      [{ listId: "a", keys: ["6", "1", "2", "3", "4", "5"] }],
    );
    expect(changes.count).toBe(1);
    expect([...changes.displaced]).toEqual(["6"]);
  });

  it("칸 사이로 옮긴 카드, 들어온 카드, 빠진 카드를 따로 센다", () => {
    const changes = diffMotionOrders(
      [
        { listId: "q", keys: ["1", "2"] },
        { listId: "r", keys: ["3"] },
      ],
      [
        { listId: "q", keys: ["2", "9"] },
        { listId: "r", keys: ["1"] },
      ],
    );
    expect([...changes.crossed]).toEqual(["1"]);
    expect([...changes.entered]).toEqual(["9"]);
    expect([...changes.left]).toEqual(["3"]);
    expect(changes.count).toBe(3);
  });

  it("3건까지는 미끄러지고 4건부터 흐려진다", () => {
    expect(chooseMoveStyle({ ...slideInput, changeCount: MOTION_BURST_LIMIT })).toBe("slide");
    expect(chooseMoveStyle({ ...slideInput, changeCount: MOTION_BURST_LIMIT + 1 })).toBe("fade");
  });

  it("옮겨 갈 자리가 보이는 영역 밖이면 흐려진다", () => {
    expect(chooseMoveStyle({ ...slideInput, to: box(320, 900) })).toBe("fade");
  });

  it("칸이 세로로 쌓여 옮기면 흐려지고, 같은 목록 안 이동은 미끄러진다", () => {
    const stacked = { ...slideInput, to: box(0, 400) };
    expect(chooseMoveStyle(stacked)).toBe("fade");
    expect(chooseMoveStyle({ ...stacked, crossesList: false })).toBe("slide");
  });
});

describe("움직임 줄이기(M4)", () => {
  it("다른 조건이 모두 미끄러짐이어도 흐려진다", () => {
    expect(chooseMoveStyle({ ...slideInput, reducedMotion: true })).toBe("fade");
  });
});

describe("빠지는 행 자리 유지", () => {
  const row = (key: string, leaving = false): MotionRow<string> => ({ key, item: key, leaving });
  const self = (item: string) => item;

  it("빠진 행은 앞 이웃 뒤에 남는다", () => {
    const rows = reconcileMotionRows([row("a"), row("b"), row("c")], ["a", "c"], self);
    expect(rows.map(({ key, leaving }) => [key, leaving])).toEqual([
      ["a", false],
      ["b", true],
      ["c", false],
    ]);
  });

  it("맨 앞 행이 빠지면 맨 앞에 남는다", () => {
    const rows = reconcileMotionRows([row("a"), row("b")], ["b"], self);
    expect(rows.map(({ key }) => key)).toEqual(["a", "b"]);
  });

  it("빠지던 행이 돌아오면 다시 보통 행이다", () => {
    const rows = reconcileMotionRows([row("a", true), row("b")], ["a", "b"], self);
    expect(rows.every(({ leaving }) => !leaving)).toBe(true);
  });
});
