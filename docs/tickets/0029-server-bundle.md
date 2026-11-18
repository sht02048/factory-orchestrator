---
status: done
blocked_by:
  [0008, 0019, 0020, 0021, 0022, 0023, 0024, 0026, 0027, 0028, 0032, 0033, 0035, 0039, 0040]
---

# 서버 배포물 묶기

> **범위 변경(운영자 결정 2026-11-18).** 원래 "npm 패키지 빌드와 Changesets"였다. npm 패키지는 내지 않고, 이 티켓은 저장소 클론·pnpm 빌드 없이 도는 서버 배포물을 만드는 일로 바꿨다. npm 공개 여부, Changesets, 0.1.0 changeset은 0031(릴리스, 보류)로 옮겼다. 보류를 풀었다.

## 목표

저장소 클론·pnpm 빌드 없이 도는 web·worker·CLI 한 덩어리(운영 의존성 포함)인 서버 배포물을 만든다. 데스크톱 앱(0046)의 ②분리된 서버 프로세스가 이 배포물을 그대로 싣고, ③헤드리스 서비스(`service install`)도 같은 배포물로 돈다. 배포물은 로컬에서 만들고 풀어 시험만 한다. **공개(npm publish·태그·GitHub Release)하지 않는다.**

## 범위

- worker, CLI, 공유 패키지를 JS로 묶는다. Node는 `node_modules` 안의 `.ts`를 실행하지 않는다(research 0001 「남은 위험」).
- web 서버 빌드의 운영 의존성(`react`, `@tanstack/react-router`, `use-intl`, `zod`, `@stylexjs/stylex` 등)을 묶는다. research 0012의 스파이크가 막힌 지점이다.
- Node 24 요구, `node:sqlite`, 마이그레이션 파일 동봉(PR #49), web 정적 자산을 지킨다.
- 0046에서 Electron의 Node(`ELECTRON_RUN_AS_NODE`)로도 띄울 수 있는지 본다.
- README Self-hosting 절을 영어로 맞춘다. 공개 배포물이 아직 없다는 점을 정확히 쓰고 npm 설치 안내는 쓰지 않는다.
- CI에 시험 단계를 더하면 `AGENTS.md`의 CI 목록도 함께 맞춘다.
- 하지 않는 것: npm publish, Changesets, 버전 태그, GitHub Release(0031). 루트 `pnpm dev` 진입점과 개발 시드·가짜 어댑터 등록(0047).

## 배포물 형태(정한 것)

**의존성까지 묶은 JS 폴더 하나와 그 tarball이다. Node 실행 파일은 싣지 않는다.**

```
factory-orchestrator-<version>/
  package.json      의존성 없음. "type": "module", engines(Node 24), bin(cli/bin/cli.js)
  LICENSE
  cli/              apps/cli/dist   (bin/cli.js, drizzle/ 마이그레이션)
  web/              apps/web/dist   (server/ 서버 번들과 drizzle/, client/ 정적 자산, srvx/ 실행기)
  worker/           apps/worker/dist (server/main.js, drizzle/)
```

- 만들기: `pnpm build && pnpm run bundle`. `dist/factory-orchestrator-<version>/`와 `dist/factory-orchestrator-<version>.tar.gz`가 나온다(`scripts/bundle.ts`). 쓰기: 풀고 `node <폴더>/cli/bin/cli.js init`·`start`.
- **번들러는 이미 쓰는 Vite(Rolldown)다.** worker·CLI는 이미 `ssr.noExternal: true`로 다 묶고 있었다. web도 `ssr.noExternal: true`로 서버 번들에 의존성을 모두 넣었고, 남는 import는 Node 내장 모듈뿐이다. web을 띄우는 srvx CLI도 `vite.srvx.config.ts`로 `web/srvx/srvx.js`에 묶었다(srvx는 이제 빌드에만 쓰는 devDependency다). 번들러를 하나 더 들이지 않고 각 앱의 `dist`가 그대로 배포물 조각이 된다.
- **`pnpm deploy --prod`로 `node_modules`를 싣지 않았다.** research 0012에서 정리 전 125MB였고, 이번 배포물은 4.9MB(tarball 1.2MB)다. `node_modules`를 실으면 플랫폼별 설치 결과와 lockfile을 함께 들고 다녀야 한다.
- **Node 실행 파일을 싣지 않았다.** 플랫폼마다 약 117MB짜리를 따로 만들어야 하고, 0046의 Electron이 이미 Node 24를 싣는다(research 0012 2절). SEA(단일 실행 파일)는 `start`가 web·worker를 별도 프로세스로 띄우는 지금 구조(ADR 0002)와 맞지 않는다(research 0012 3절). 그래서 배포물은 플랫폼에 기대지 않는 JS 하나이고, 헤드리스 서비스는 기계의 Node 24로, 데스크톱 앱은 Electron의 Node로 띄운다.
- **CLI 배치.** CLI(`apps/cli/src/layout.ts` `appLayout`)는 자기 위의 `package.json` 폴더 옆에 `web/`이 있으면 배포물로, 없으면 저장소(`apps/*/dist`)로 보고 web·worker를 찾는다. 두 경우 모두 web은 묶은 srvx(`web/srvx/srvx.js`)로 띄운다.
- **가짜 어댑터 검사.** `scripts/bundle-check.ts`가 배포물에 `node_modules`, TypeScript 소스, Node 내장이 아닌 패키지 import, 테스트용 가짜 어댑터(`@factory/core/testing`의 `Fake*`·`fake*Factory`)가 없는지 본다. 배포물을 만들 때와 실행 시험이 함께 쓴다.

## 완료 조건

- [x] 배포물 tarball을 저장소 밖 새 임시 폴더에 풀어, 그 폴더에서 CLI `init`·`start`가 돌고 web이 `/runs`와 정적 자산을 200으로 주며, worker가 실제 Orca 러너 어댑터 설정(닿지 않는 ssh 대상)으로 러너 상태 확인 기록(Offline, 오류)을 DB에 남기고, SIGTERM에 둘 다 멈춘다는 시험이 CI에서 돈다(`pnpm run smoke:bundle`). 저장소에서 빌드한 CLI 시험(`pnpm run smoke:cli`)도 같은 러너 확인을 본다.
- [x] 배포물에 테스트용 가짜 어댑터·`node_modules`·패키지 import가 없다는 검사가 배포물을 만들 때와 위 시험에서 돈다.
- [x] Electron 45.3.4의 Node(`ELECTRON_RUN_AS_NODE=1`, Node 24.22.3)로 같은 시험이 통과했다(로컬 스크래치, macOS arm64. `node scripts/smoke-cli.ts --bundle --node <Electron 실행 파일>`). web·worker도 Electron 실행 파일로 떴다. CI에서는 돌리지 않는다.
- [x] README Self-hosting 절을 배포물 기준으로 고쳤다.

## 남은 위험

- 묶은 서드파티 코드의 라이선스 고지를 따로 모으지 않았다. 배포물을 공개하기 전(0031)에 정한다.
- 시험은 macOS arm64(로컬)와 ubuntu(CI)에서 돌았다. 배포물에는 네이티브 모듈이 없어 플랫폼에 기대지 않지만, 다른 플랫폼의 Electron으로는 확인하지 않았다.
- Electron `runAsNode` fuse를 끄면 `ELECTRON_RUN_AS_NODE`로 띄우는 방법이 막힌다(research 0012 「남은 위험」). 0046에서 정한다.
