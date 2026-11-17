import { AdapterRegistry } from "@factory/core";
import { githubCodeHostFactory } from "@factory/codehost-github";
import { SecretBox, parseBootConfig } from "@factory/db";
import { linearTrackerFactory } from "@factory/tracker-linear";

let registry: AdapterRegistry | undefined;
let secretBox: SecretBox | undefined;

/**
 * web 이 DB 설정으로 어댑터를 만들 때 쓰는 등록표(ADR 0008). 새 트래커·코드 호스트 종류는 여기에 한 줄을 더한다.
 * Settings 의 연결 확인이 이 등록표로 어댑터를 만든다(0025). server 쪽에서만 부른다.
 */
export function getAdapterRegistry(): AdapterRegistry {
  registry ??= new AdapterRegistry()
    .registerTracker(linearTrackerFactory)
    .registerCodeHost(githubCodeHostFactory);
  return registry;
}

/** 연결의 비밀값(signing secret 등)을 여는 상자. 키는 부팅 설정에서 받는다(ADR 0005). */
export function getSecretBox(): SecretBox {
  secretBox ??= new SecretBox(parseBootConfig(process.env).encryptionKey);
  return secretBox;
}
