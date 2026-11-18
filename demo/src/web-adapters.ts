import type { AdapterRegistry } from "@factory/core";
import { SecretBox, parseBootConfig } from "@factory/db";
import { demoWorld } from "./world.js";

/*
 * 개발 진입점에서 apps/web/src/server/adapters.ts 대신 싣는 모듈(plugins.ts 의 vite 플러그인이 바꿔 끼운다).
 * e2e 브라우저 시험(e2e/src/browser/fake-adapters.ts)과 같은 방식이다. 내보내는 함수의 이름과 모양은 원본과
 * 같아야 한다. 등록표는 worker 와 같은 가짜 세계(world.ts)를 본다.
 */

let registry: AdapterRegistry | undefined;
let secretBox: SecretBox | undefined;

export function getAdapterRegistry(): AdapterRegistry {
  registry ??= demoWorld().registry();
  return registry;
}

export function getSecretBox(): SecretBox {
  secretBox ??= new SecretBox(parseBootConfig(process.env).encryptionKey);
  return secretBox;
}
