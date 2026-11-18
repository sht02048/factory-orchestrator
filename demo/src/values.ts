/*
 * 가짜 어댑터가 확인 결과를 정하는 입력값과, 온보딩 입력 칸을 채우는 가짜 값(티켓 0047). 브라우저에서 도는
 * client/prefill.ts 도 읽어 다른 모듈을 import 하지 않는다. 가상 값만 쓴다(ADR 0005).
 */

/** 이 낱말이 든 API 키·토큰은 가짜 트래커·코드 호스트가 인증 실패로 답한다 */
export const FAIL_AUTH = "invalid";
/** ssh 대상에 이 낱말이 있으면 가짜 러너가 Offline 으로 답한다 */
export const FAIL_OFFLINE = "offline";
/** ssh 대상에 이 낱말이 있으면 가짜 러너의 Orca 상시 서비스가 없다 */
export const FAIL_NO_ORCA = "no-orca";
/** ssh 대상에 이 낱말이 있으면 가짜 러너의 GitHub 인증이 깨졌다 */
export const FAIL_PUSH_AUTH = "push-auth";

/** 입력 칸 name 마다 채울 가짜 값. 모두 확인을 통과한다 */
export const PREFILL: Readonly<Record<string, string>> = {
  name: "Acme",
  apiKey: "lin_api_demo_acme",
  webhookSecret: "lin_wh_demo_acme",
  token: "github_pat_demo",
  sshTarget: "runner-a.example.com",
  orcaPath: "orca",
  capacity: "4",
};

/** 러너 폼(ssh 대상 칸이 있는 폼)의 이름 칸에 넣을 값 */
export const PREFILL_RUNNER_NAME = "runner-a";
