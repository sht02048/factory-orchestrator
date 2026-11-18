import {
  AdapterRegistry,
  toCodeHostKind,
  toRepoRef,
  toRunnerKind,
  toTrackerKind,
} from "@factory/core";
import type { RepoRef, RunnerProjectId } from "@factory/core";
import { FakeCodeHost, FakeRunner, FakeTracker } from "@factory/core/testing";
import { RUNNER_PROJECTS, trackerCatalog, trackerSpecFor } from "./fixtures.js";
import { FAIL_AUTH, FAIL_NO_ORCA, FAIL_OFFLINE, FAIL_PUSH_AUTH } from "./values.js";

/*
 * 개발 진입점의 가짜 세계(티켓 0047). web 과 worker 가 한 프로세스에서 같은 가짜 트래커·러너·코드 호스트를
 * 본다. 어댑터는 core 의 시험용 가짜(@factory/core/testing)를 그대로 쓰고, 저장한 종류(linear·orca·github)로
 * 등록해 화면이 실제 설치처럼 보이게 한다. 이 등록은 개발 진입점에서만 한다. 제품 코드의 등록표
 * (apps/web/src/server/adapters.ts, apps/worker/src/registry.ts)는 실제 어댑터만 등록하고 이 모듈을 모른다.
 *
 * 같은 프로세스지만 web 모듈 그래프(vite SSR)와 이 모듈 그래프가 따로 돌 수 있어, 세계는 globalThis 에 하나만 둔다.
 */

export const TRACKER_KIND = toTrackerKind("linear");
export const RUNNER_KIND = toRunnerKind("orca");
export const CODE_HOST_KIND = toCodeHostKind("github");

export class DemoWorld {
  /** 트래커 연결의 API 키로 찾는다. 같은 키면 같은 가짜 트래커다 */
  readonly trackers = new Map<string, FakeTracker>();
  /** 러너의 ssh 대상으로 찾는다 */
  readonly runners = new Map<string, FakeRunner>();
  /** 코드 호스트는 저장소마다 PR 을 둔다. 토큰과 상관없이 하나다 */
  readonly codeHost = new FakeCodeHost(CODE_HOST_KIND, "");
  private readonly badCodeHost = new FakeCodeHost(CODE_HOST_KIND, "");
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
    this.badCodeHost.connection = { ok: false, error: { kind: "unauthorized" } };
  }

  tracker(apiKey: string): FakeTracker {
    const found = this.trackers.get(apiKey);
    if (found !== undefined) return found;
    const tracker = new FakeTracker(TRACKER_KIND);
    if (apiKey.toLowerCase().includes(FAIL_AUTH)) {
      tracker.connection = { ok: false, error: { kind: "unauthorized" } };
    } else {
      const catalog = trackerCatalog(trackerSpecFor(apiKey), this.now());
      tracker.projects.push(...catalog.projects);
      for (const project of catalog.projects) {
        tracker.states.set(project.id, catalog.states);
        tracker.labels.set(project.id, catalog.labels);
      }
      for (const ticket of catalog.tickets) tracker.addTicket(ticket);
    }
    this.trackers.set(apiKey, tracker);
    return tracker;
  }

  runner(sshTarget: string): FakeRunner {
    const found = this.runners.get(sshTarget);
    if (found !== undefined) return found;
    const runner = new FakeRunner(RUNNER_KIND);
    const target = sshTarget.toLowerCase();
    runner.setProjects(RUNNER_PROJECTS);
    runner.online = !target.includes(FAIL_OFFLINE);
    // 실제 Orca 러너와 같은 확인 항목 ID 를 써 화면이 같은 문구를 보인다(apps/web/src/labels.ts).
    runner.prerequisites = [
      {
        id: "orca-service",
        name: "Orca background service",
        satisfied: !target.includes(FAIL_NO_ORCA),
        hint: "orca serve service install --bind 127.0.0.1 --refuse-public --command orca",
        blocksAssignment: false,
      },
      ...RUNNER_PROJECTS.map((project) => ({
        id: `github-push:${project.id}`,
        name: `GitHub push access: ${project.displayName}`,
        satisfied: !target.includes(FAIL_PUSH_AUTH),
        hint: "Run `gh auth login --insecure-storage` and `gh auth setup-git` on the runner.",
        blocksAssignment: true,
      })),
    ];
    this.runners.set(sshTarget, runner);
    return runner;
  }

  /** 러너 쪽 프로젝트 ID 가 곧 저장소 이름이다(acme/web) */
  repoOf(project: RunnerProjectId): RepoRef {
    return toRepoRef(project);
  }

  /** 개발 진입점에서만 쓰는 어댑터 등록표. web 과 worker 가 함께 쓴다 */
  registry(): AdapterRegistry {
    return new AdapterRegistry()
      .registerTracker({
        kind: TRACKER_KIND,
        create: (config) => this.tracker(stringAt(config, "secrets", "apiKey")),
      })
      .registerRunner({
        kind: RUNNER_KIND,
        create: (config) => this.runner(stringAt(config, "sshTarget")),
      })
      .registerCodeHost({
        kind: CODE_HOST_KIND,
        create: (config) =>
          stringAt(config, "secrets", "token").toLowerCase().includes(FAIL_AUTH)
            ? this.badCodeHost
            : this.codeHost,
      });
  }
}

/** 설정 JSON 에서 문자열 하나를 꺼낸다. 없으면 빈 문자열이다 */
export function stringAt(value: unknown, ...path: string[]): string {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) return "";
    current = Object.getOwnPropertyDescriptor(current, key)?.value;
  }
  return typeof current === "string" ? current : "";
}

declare global {
  // 개발 진입점의 가짜 세계. web 모듈 그래프와 함께 쓴다.
  var __factoryDemoWorld: DemoWorld | undefined;
}

/** 이 프로세스의 가짜 세계. 처음 부를 때 만든다 */
export function demoWorld(): DemoWorld {
  globalThis.__factoryDemoWorld ??= new DemoWorld();
  return globalThis.__factoryDemoWorld;
}
