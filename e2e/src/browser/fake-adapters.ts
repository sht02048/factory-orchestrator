import { AdapterRegistry } from "@factory/core";
import { FakeTracker } from "@factory/core/testing";
import { SecretBox, parseBootConfig } from "@factory/db";
import { fakeKind, trackerTickets } from "./fixtures.js";

/*
 * 브라우저 시험에서 apps/web/src/server/adapters.ts 대신 싣는 모듈(시험의 vite 플러그인이 바꿔 끼운다).
 * 제품 코드는 Linear·GitHub 어댑터만 등록하므로, 시험은 같은 이름의 함수를 내보내며 core 가짜 트래커를
 * 등록한다. 내보내는 함수의 이름과 모양은 원본과 같아야 한다.
 */

let registry: AdapterRegistry | undefined;
let secretBox: SecretBox | undefined;

export function getAdapterRegistry(): AdapterRegistry {
  if (registry === undefined) {
    const tracker = new FakeTracker(fakeKind);
    for (const ticket of trackerTickets) tracker.addTicket(ticket);
    registry = new AdapterRegistry().registerTracker({ kind: fakeKind, create: () => tracker });
  }
  return registry;
}

export function getSecretBox(): SecretBox {
  secretBox ??= new SecretBox(parseBootConfig(process.env).encryptionKey);
  return secretBox;
}
