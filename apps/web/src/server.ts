import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { guardRequest } from "./server/request-access";

/*
 * web 서버 진입(TanStack Start server entry). 화면·server function·webhook 을 라우터에 넘기기 전에
 * Host·Origin 검사를 한다(티켓 0048). 개발 서버와 프로덕션 번들이 같은 진입을 쓴다.
 */
export default createServerEntry({
  fetch(request, opts) {
    return guardRequest(request) ?? handler.fetch(request, opts);
  },
});
