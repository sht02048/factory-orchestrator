import { z } from "zod";
import rootPackage from "../../../../package.json" with { type: "json" };

/*
 * 신원 확인 경로(티켓 0048, Q10). 데스크톱 앱(0046)이 tailnet 기기마다 "이 서버가 오케스트레이터인가"를 묻는 곳이다.
 * 계약(이름과 응답 모양)은 docs/tickets/0048 「신원 확인 경로 계약」에 적었다. 바꾸면 0046 과 함께 바꾼다.
 * 비밀이 아닌 값만 담는다. 호스트명·경로·계정·주소 같은 운영자 값은 담지 않는다(ADR 0005).
 */

export const PRODUCT_NAME = "factory-orchestrator";

/** 요청한 Host 로 화면을 열 수 있는지. 안 되면 그 서버의 Settings 에서 다른 기기에서 열 주소를 정해야 한다 */
export const WEB_ACCESS = ["allowed", "host-not-allowed"] as const;
export type WebAccess = (typeof WEB_ACCESS)[number];

export const identitySchema = z.object({
  product: z.literal(PRODUCT_NAME),
  version: z.string(),
  instanceId: z.string(),
  webAccess: z.enum(WEB_ACCESS),
});
export type Identity = z.infer<typeof identitySchema>;

/** 제품 버전. 서버 배포물 이름과 같은 값(루트 package.json, scripts/bundle.ts)이다 */
export const PRODUCT_VERSION = z.object({ version: z.string() }).parse(rootPackage).version;

export function identityOf(instanceId: string, webAccess: WebAccess): Identity {
  return { product: PRODUCT_NAME, version: PRODUCT_VERSION, instanceId, webAccess };
}
