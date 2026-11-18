import { createFileRoute } from "@tanstack/react-router";
import { loadAttention } from "../../attention/attention";
import { getDatabase } from "../../server/database";

/**
 * 알림할 사건 `GET /api/attention`(티켓 0046). 데스크톱 앱이 폴링한다. 화면과 같은 Host 검사를 받는다.
 */
export const Route = createFileRoute("/api/attention")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          { events: loadAttention(getDatabase(), new Date()) },
          { headers: { "cache-control": "no-store" } },
        ),
    },
  },
});
