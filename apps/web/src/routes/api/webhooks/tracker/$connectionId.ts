import { toTrackerConnectionId } from "@factory/core";
import { createFileRoute } from "@tanstack/react-router";
import { getAdapterRegistry, getSecretBox } from "../../../../server/adapters";
import { getDatabase } from "../../../../server/database";
import {
  consoleWebhookLogger,
  receiveTrackerWebhook,
  rejectTrackerWebhook,
} from "../../../../webhooks/receive";
import type { WebhookContext } from "../../../../webhooks/receive";

/**
 * 트래커 webhook 수신 주소. 연결마다 주소가 달라 어느 Tracker Connection의 webhook인지 가린다(0027).
 * 운영자는 트래커 설정에서 webhook 주소를 `<공개 주소>/api/webhooks/tracker/<연결 ID>`로 둔다.
 */
export const Route = createFileRoute("/api/webhooks/tracker/$connectionId")({
  server: {
    handlers: {
      POST: ({ request, params }) => {
        const now = new Date();
        const connectionId = toTrackerConnectionId(params.connectionId);
        let context: WebhookContext;
        try {
          context = {
            db: getDatabase(),
            secretBox: getSecretBox(),
            registry: getAdapterRegistry(),
            logger: consoleWebhookLogger,
          };
        } catch (error) {
          // 부팅 설정(암호화 키, DB 경로)이 잘못됐다. 기록 없는 500이 되지 않게 남긴다(0040).
          return rejectTrackerWebhook(consoleWebhookLogger, connectionId, request, error);
        }
        return receiveTrackerWebhook(context, connectionId, request, now);
      },
    },
  },
});
