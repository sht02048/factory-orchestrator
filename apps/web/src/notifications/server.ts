import { getDatabase } from "../server/database";
import { syncNotifications, throttledSync } from "./notifications";

export const notificationSync = throttledSync(
  () => syncNotifications(getDatabase(), new Date()),
  () => Date.now(),
);
