import { AdapterRegistry } from "@factory/core";
import { githubCodeHostFactory } from "@factory/codehost-github";
import { orcaRunnerFactory } from "@factory/runner-orca";
import { linearTrackerFactory } from "@factory/tracker-linear";

/**
 * worker가 DB 설정으로 어댑터를 만들 때 쓰는 등록표(ADR 0008). 새 러너·트래커·코드 호스트 종류는 여기에
 * 한 줄을 더한다. worker는 저장한 종류(kind)로 고를 뿐 제품을 알지 못한다.
 */
export function createAdapterRegistry(): AdapterRegistry {
  return new AdapterRegistry()
    .registerRunner(orcaRunnerFactory)
    .registerTracker(linearTrackerFactory)
    .registerCodeHost(githubCodeHostFactory);
}
