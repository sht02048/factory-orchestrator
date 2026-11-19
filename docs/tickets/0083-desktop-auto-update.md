---
status: done
blocked_by: [0079]
---

# 0083 데스크톱 앱 자동 업데이트

## 목표

설치한 macOS 앱이 GitHub Release의 새 버전을 스스로 받아 바꾼다.

## 배경

0046 「후속(릴리스 때)」의 자동 업데이트다. 0031에서 운영자 결정(2026-11-18)으로 0.1.0에는 넣지 않았다. 0.1.0은 dmg만 올리고 새 버전은 Release에서 다시 받는다. 업데이트 피드 주소가 저장소 주소에 달려 있어 저장소 이름을 바꾼(0079) 뒤에 한다.

## 범위

- research 0012 2절 「자동 업데이트」의 방식을 고른다. Squirrel.Mac은 서명한 앱이어야 돈다.
- 0031의 릴리스 워크플로에 업데이트용 산출물(예: 서명·공증한 zip)을 더해 Release에 함께 올린다.
- 업데이트 뒤 서버 교체는 0046 「②의 버전 교체」를 따른다. 앱이 띄운 ②의 배포물 지문이 바뀌면 옛 ②를 멈추고 새 ②를 띄우며, 도는 런은 러너에서 이어진다.
- 0.1.0을 설치한 사람은 자동 업데이트가 없으니, 업데이트가 들어간 버전을 한 번 손으로 받아야 함을 Release 본문에 적는다.

## 사용자 경험(운영자 결정 2026-11-19, 시안 U4·U5)

- **흐름.** 앱이 뒤에서 새 버전을 확인하고 받는다. 다 받으면 묻는다(묻지 않고 바꾸지 않는다). 사용자가 "다시 시작"을 누르면 앱과 앱이 띄운 서버를 함께 바꾼다. 바꾸는 동안 반장(신호 주는 중)과 "서버를 새 버전으로 바꾸는 중이에요"를 보이고, 끝나면 "0.2.0으로 바꿨어요"와 바뀐 내용(Release 노트) 링크를 보인다.
- **알림 자리는 오른쪽 아래 토스트(시안 U5의 B).** 내용은 "새 버전 0.2.0을 받았어요", 서버도 바뀌어 화면이 몇 초 끊기고 런은 러너에서 이어진다는 한 문장, 버튼 "다시 시작"·"나중에", "바뀐 내용" 링크다.
- **이 토스트는 저절로 사라지지 않는다.** 시간 제한이 없고, "다시 시작"이나 "나중에"를 눌러야 닫힌다. 다른 토스트(저장했어요 등)가 와도 밀려나지 않는다. "나중에"를 누르면 닫히고 다음에 앱을 끌 때 바뀐다. 앱을 다시 열었을 때 아직 바뀌지 않았으면 다시 보인다. 포커스를 빼앗지 않고 화면 읽기에는 한 번 알린다.
- **Settings 업데이트 구역.** 지금 버전(앱과 서버가 같은지), 마지막 확인 시각과 "지금 확인", 자동 업데이트 켜기·끄기(끄면 확인하지 않는다, 확인할 때 IP와 버전이 Release 호스트에 전해진다는 안내).
- **자동으로 안 될 때.** Applications 밖에서 실행(옮기라는 안내), 바꿀 권한 없음(Release 링크), 원격 서버에 붙은 앱(앱과 서버 판이 다르면 알림), CLI·Linux 서버(새 버전이 있다는 표시만).

## 완료 조건

- 앞 버전을 설치한 맥에서 새 Release를 올리면 앱이 새 버전으로 다시 뜨고, ②가 새 버전으로 교체되며 Running 런이 이어진다(0046 「후속(릴리스 때)」의 완료 조건).

## 선행 조정(운영자 지시 2026-11-19)

0031을 기다리지 않고 동시에 진행한다. 누가 먼저 머지되든 상관없다. 그래서 `blocked_by`에서 0031을 뺐다. 0031에 남은 일은 묶은 서드파티 코드의 라이선스 고지와 서버 배포물의 절대 경로 정리라 이 티켓의 업데이트 흐름과 독립이다. 두 티켓이 `scripts/release-mac.ts`와 `.github/workflows/release.yml`을 함께 고칠 수 있어, 나중에 머지되는 쪽이 `origin/main`을 머지 커밋으로 받아 맞춘다.

## 결정과 구현

- **방식: Electron 내장 `autoUpdater`(Squirrel.Mac) + Release에 올린 정적 JSON 피드.** research 0012 2절의 `update.electronjs.org` + `update-electron-app`은 외부 서비스가 Release를 대신 읽어 주는 방식이라, 확인 때 IP와 버전이 GitHub 말고 그 서비스에도 간다. 대신 앱이 GitHub Releases API(`GET /repos/<저장소>/releases`)를 직접 읽어 새 버전을 고르고, 그 Release에 올린 `ganger-update-darwin-<arch>.json`(Squirrel.Mac `serverType: "json"` 모양)을 `autoUpdater.setFeedURL`에 넘긴다. 피드는 같은 Release의 서명·공증한 `Ganger-<version>-darwin-<arch>.zip`을 가리킨다. 이렇게 하면 의존성을 더하지 않고(Electron에 들어 있다), 확인하는 곳이 GitHub 하나이며, 지금 버전이 rc면 rc(prerelease)도, 정식이면 정식만 고를 수 있다(`releases/latest`는 prerelease를 건너뛴다). electron-builder의 `electron-updater`는 패키징 도구(0046에서 고른 `@electron/packager`)를 바꿔야 해서 고르지 않았다. Squirrel.Mac은 서명한 앱이어야 돌고, 받은 zip의 서명이 지금 앱과 같은 Developer ID여야 바꾼다.
- **피드 주소는 저장소 주소에서 만든다.** 저장소 이름(`owner/name`)을 소스에 넣지 않는다(ADR 0005, 0079 결과). 릴리스 때 GitHub Actions가 주는 `GITHUB_REPOSITORY`(또는 `GANGER_RELEASE_REPOSITORY`)를 `scripts/release-mac.ts`가 받아 패키징 때 앱의 `Contents/Resources/app-update.json`에 적는다. 앱은 이 파일을 zod로 읽고(`owner/name` 모양만), 개발 실행이나 이 파일이 없는 빌드는 확인하지 않는다(Settings에 "업데이트 주소가 없어 확인하지 않아요"). 시험용으로 `GANGER_UPDATE_REPOSITORY`가 파일보다 앞선다. 저장소를 포크해 릴리스하면 포크의 Release를 본다.
- **외부 입력은 경계에서 zod로 읽는다.** Releases API 응답(`packages/app/src/updates/releases.ts`), 버전 문자열(태그의 `v`를 떼고 SemVer 모양만), 앱 설정의 업데이트 기록, 웹 화면이 받는 업데이트 상태(`packages/app/src/updates/view.ts`)를 모두 스키마로 파싱한다.
- **상태 기계(`apps/desktop/src/core/updater.ts`, Electron 없이 시험).** 확인 → 받는 중 → 받음(토스트) → 다시 시작 또는 나중에. 앱을 켠 뒤 15초에 처음, 그 뒤 6시간마다 확인한다(10분마다 때가 됐는지만 본다). 자동 업데이트를 끄면 때가 되어도 확인하지 않는다("지금 확인"은 누를 때 한 번 확인한다). 다 받으면 앱 설정에 `{ from, to }`를 적는다. 다시 연 앱이 `to` 버전이면 "바꿨어요" 토스트를 보이고, 아직 `from`이면(나중에 뒤 강제 종료 등) 바로 다시 확인해 받고 토스트를 다시 보인다. "나중에"는 이번 실행에서 토스트만 닫는다. 받은 업데이트는 Squirrel.Mac이 앱을 끌 때 바꾼다.
- **다시 시작과 ② 교체.** "다시 시작"은 `autoUpdater.quitAndInstall()`이다. 앱이 끝나도 ②는 detach돼 계속 돈다(0046). 새 앱이 뜨면 0046의 「②의 버전 교체」 그대로 배포물 지문이 다른 것을 보고 옛 `start`에 SIGTERM을 보내 끝나기를 기다린 뒤 새 `start`를 띄운다. 이 티켓은 그 사이에 `ensureRunning({ onReplacing })`으로 바꾸기 시작을 알려 앱 화면에 반장(signal)과 "서버를 새 버전으로 바꾸는 중이에요", `0.1.0 → 0.2.0`, "돌던 런은 러너에서 계속 진행돼요"를 보인다(`local-updating`). 새 ②가 뜨면 서버 화면을 열고 "0.2.0으로 바꿨어요" 토스트와 바뀐 내용(Release) 링크를 보인다.
- **토스트(시안 U5의 B).** `packages/ui`에 `PinnedToast`를 더하고 `Toaster`에 `pinned` 자리를 넓혔다. 일반 토스트 영역과 같은 고정 열의 아래에 붙어 일반 토스트는 그 위에 쌓이고, 시간 제한이 없어 "다시 시작"·"나중에"(바꾼 뒤는 "닫기")를 눌러야 닫힌다. 포커스를 옮기지 않고 안의 `role="status"`가 제목을 한 번 알린다. 토스트는 서버의 web 화면(앱 창)에 그리고, 앱은 preload로 서버 화면에만 `gangerDesktopUpdates` 다리를 연다(앱 창의 그 서버 origin에서 온 요청만 받는다). 브라우저로 연 web에는 다리가 없어 토스트가 없다.
- **Settings 업데이트 구역.** 설치 항목에 "업데이트"를 더했다. 데스크톱 앱 안: 지금 버전(앱과 서버가 같은지), 마지막 확인 시각과 결과, "지금 확인", 받았으면 "다시 시작", 자동 업데이트 켜기·끄기와 "확인할 때 이 기기의 IP와 지금 버전이 GitHub Releases에 전해져요" 안내. 이 Mac의 앱 설정이라 앱 설정 파일에 둔다.
- **자동으로 안 될 때 네 경우.** (1) Applications 밖에서 실행(`app.isInApplicationsFolder()`): 받지 않고 옮기라는 안내. (2) 앱이나 그 폴더에 쓸 수 없음: 받지 않고 "바꿀 권한이 없어요"와 Release 링크. (3) 원격 서버에 붙은 앱·앱이 띄우지 않은 이 Mac의 서버(③, 터미널 `start`): 앱만 바꾸고, 앱과 서버 판이 다르면 Settings에 알린다(토스트 문구도 "앱이 바뀌어요"). (4) CLI·Linux 서버를 브라우저로 열면: Settings에 지금 버전과 "자동으로 업데이트하지 않아요, Release에서 받아요"만 보인다. 서버는 저장소 주소를 모르므로(위 피드 주소 결정) 새 버전 확인은 하지 않는다. 데스크톱 앱으로 그 서버를 열면 (3)으로 판 차이를 알린다.
- **릴리스 산출물.** `scripts/release-mac.ts`가 서명·공증·staple한 앱을 `ditto`로 zip(`Ganger-<version>-darwin-<arch>.zip`)하고 피드 JSON을 쓴다. `release.yml`은 zip을 풀어 서명·staple·Gatekeeper와 `app-update.json`, 피드가 zip을 가리키는지 확인한 뒤 dmg와 함께 Release에 올린다.
- **0.1.0 설치자 안내.** 0.1.0(과 그 앞 rc)은 업데이트 코드가 없어 스스로 바뀌지 않는다. `scripts/release-update.ts`의 `manualUpdateNotice`가 0.3.0 전 버전의 Release 본문 맨 앞에 "dmg를 한 번 받아 Applications의 앱을 바꾸라"는 안내(영어, 사용자 문서)를 넣는다(`gh release create --notes-file`, 자동 생성 노트가 그 뒤에 붙는다). 0.3.0부터는 넣지 않는다. 이 경계는 `MANUAL_UPDATE_NOTICE_BEFORE`로 바꾼다.
- **서명 경로 시험.** 서명·공증은 PR CI에서 돌 수 없다(시크릿이 `release` 환경에만 있다). PR에서는 서명 없는 경로로 시험했다: 상태 기계·피드 고르기·피드 JSON·저장소 주소 읽기는 단위 시험, 서명 없는 로컬 패키징으로 `app-update.json`이 앱에 들어가는지, 패키징한 앱의 서버 화면에 업데이트 다리가 열리는지는 로컬 smoke. 실제 Squirrel.Mac 받기와 교체는 **다음 rc에서 확인한다**: 앞 rc를 설치한 맥에서 새 rc Release를 올려 앱이 토스트를 띄우고, "다시 시작"으로 새 버전이 뜨고, ②가 바뀌고 Running 런이 이어지는지 본다(아래 완료 조건).

## 시험

- 상태 기계(`apps/desktop/src/core/updater.test.ts`): 확인 → 받음 → 토스트, 다시 시작(받기 전에는 설치하지 않음), 나중에(이번 실행에서 다시 띄우지 않음), 앱을 다시 열었는데 아직 옛 버전이면 바로 다시 받아 토스트, 새 버전으로 열리면 바꿨다는 토스트, 자동 업데이트를 끄면 확인하지 않음, 6시간 간격, Applications 밖·권한 없음, 업데이트 주소 없는 빌드, 실패 뒤 다시 시도, 확인 겹치지 않음.
- 피드(`packages/app/src/updates/releases.test.ts`, `scripts/release-update.test.ts`): 버전 비교(rc), rc 채널, 초안·피드 없는 Release·다른 아키텍처 건너뛰기, 모양이 다른 응답, Squirrel JSON 모양, 태그와 버전 불일치, 0.1.0 설치자 안내.
- 서버 교체 순서(`apps/desktop/src/core/local-server.test.ts`): 바꾸기 시작을 알릴 때 옛 ②가 아직 돌고 새 ②는 아직 없으며, 그 뒤 옛 ②가 멈추고 새 ②가 뜨고 worker가 한 벌이다.
- 화면: 토스트 문구와 경우별 본문(`apps/web/src/shell/update-toast.test.tsx`), Settings 구역과 안 되는 네 경우(`apps/web/src/settings/updates-panel.test.tsx`), 바꾸는 중 화면(`apps/desktop/src/renderer/screens.test.ts`), 브라우저에서 토스트가 저절로 닫히지 않고 다른 토스트에 밀리지 않으며 포커스를 빼앗지 않고 한 번 알리는지, 나중에·다시 시작·닫기, Settings 켜기·끄기(`e2e/src/desktop-updates.test.ts`), 패키징한 앱의 업데이트 다리(`apps/desktop/smoke/packaged.smoke.ts`, 로컬).

## 남은 위험

- Squirrel.Mac으로 실제 받아 바꾸기는 서명한 Release 두 개가 있어야 확인된다. 다음 rc에서 확인한다.
- GitHub API는 인증 없이 IP당 시간에 60번이다. 6시간 간격이면 넉넉하지만 같은 공인 IP 뒤의 맥이 많으면 "확인하지 못했어요"가 보일 수 있다.
- 받은 뒤 "나중에"를 누르고 앱을 끄지 않으면 Squirrel.Mac이 바꾸지 않는다. 앱을 끄는 때(트레이 "종료", 로그아웃) 바뀐다.
- CLI·Linux 서버를 브라우저로만 쓰면 새 버전이 있는지 알 수 없다. 서버가 저장소 주소를 알게 하는 방법(빌드 때 주소 넣기 등)은 후속이다.
