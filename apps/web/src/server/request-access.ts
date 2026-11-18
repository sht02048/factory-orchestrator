import { getInstallSettings, parseBootConfig } from "@factory/db";
import type { InstallAddresses } from "@factory/db";
import { allowedHosts, checkRequest, rejectionLogLine, rejectionResponse } from "./request-guard";
import type { AllowedHosts } from "./request-guard";
import { getDatabase } from "./database";

/*
 * 지금 설정으로 만든 Host 허용 목록과 요청 거르기(티켓 0048). 주소는 DB 설치 설정에 있어 요청마다 한 줄을 읽는다.
 * Settings 에서 바꾸면 다시 띄우지 않아도 다음 요청부터 맞는다.
 */

function bindHost(): string | null {
  try {
    return parseBootConfig(process.env).host;
  } catch {
    return null;
  }
}

function addresses(): InstallAddresses {
  try {
    return getInstallSettings(getDatabase());
  } catch {
    // DB 를 열지 못하면 바깥 주소를 받지 않는다. 127.0.0.1 은 늘 받으므로 오류 화면은 그대로 보인다.
    return { webAddress: null, webhookAddress: null };
  }
}

export function currentAllowedHosts(): AllowedHosts {
  return allowedHosts({ bindHost: bindHost(), ...addresses() });
}

/** 받지 않을 요청이면 거절 응답을, 받으면 null 을 돌려준다. 거절은 로그에 까닭과 함께 남긴다 */
export function guardRequest(request: Request): Response | null {
  const verdict = checkRequest(request, currentAllowedHosts());
  if (verdict.ok) return null;
  console.warn(rejectionLogLine(request, verdict));
  return rejectionResponse(verdict.reason);
}
