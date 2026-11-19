import { describe, expect, it } from "vitest";
import { notificationId, staleNotificationIds } from "./notification-ids.js";

const url = "http://127.0.0.1:3000";
const other = "https://ganger.example.com";

describe("앱을 다시 켰을 때 지울 알림", () => {
  it("해결된 사건 알림과 지난 실행의 묶음·놓친 일 알림을 지우고, 열린 사건·지금 띄운 알림·다른 서버 알림은 남긴다", () => {
    const delivered = [
      notificationId(url, "event-1"),
      notificationId(url, "event-2"),
      notificationId(url, "bundle-1"),
      notificationId(url, "missed-1"),
      notificationId(url, "missed-2"),
      notificationId(other, "event-9"),
      "someone-else",
    ];
    const shownNow = new Set([notificationId(url, "missed-2")]);
    expect(staleNotificationIds(url, delivered, [2], shownNow)).toEqual([
      notificationId(url, "event-1"),
      notificationId(url, "bundle-1"),
      notificationId(url, "missed-1"),
    ]);
  });

  it("서버마다 다른 알림 ID 를 쓴다", () => {
    expect(notificationId(url, "event-1")).not.toBe(notificationId(other, "event-1"));
  });
});
