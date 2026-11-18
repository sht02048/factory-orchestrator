import { getInstallSettings } from "@factory/db";
import { createFileRoute } from "@tanstack/react-router";
import { identityOf } from "../../identity/identity";
import { getDatabase } from "../../server/database";
import { currentAllowedHosts } from "../../server/request-access";
import { hostnameOfHostHeader, isHostAllowed } from "../../server/request-guard";

/**
 * 신원 확인 경로 `GET /api/identity`(티켓 0048). 인증 없이 제품 이름·버전·설치 ID 와, 요청한 Host 로 화면을 열 수
 * 있는지를 돌려준다. Host 검사를 받지 않는 경로라(request-guard) 바깥 주소를 정하기 전에도 답한다.
 */
export const Route = createFileRoute("/api/identity")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const { pathname } = new URL(request.url);
        const allowed = isHostAllowed(
          hostnameOfHostHeader(request.headers.get("host")),
          pathname,
          currentAllowedHosts(),
        );
        const { instanceId } = getInstallSettings(getDatabase());
        return Response.json(identityOf(instanceId, allowed ? "allowed" : "host-not-allowed"), {
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});
