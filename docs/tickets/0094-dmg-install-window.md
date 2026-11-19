---
status: done
blocked_by: []
---

# dmg 설치 화면(끌어다 놓기)

[0031](0031-release-0-1-0.md) 범위에서 빠진 일이다.

## 배경

운영자 확인(2026-11-19): `v0.1.0-rc.2` dmg를 열면 흔한 "앱을 Applications로 끌어다 놓기" 화면이 아니라 Finder 기본 창이 뜬다. `scripts/release-mac.ts`는 `Ganger.app`과 `/Applications` 링크를 넣은 폴더를 `hdiutil create -srcfolder`로 묶을 뿐, 창 크기·아이콘 크기·위치(`.DS_Store`), 배경 그림, 볼륨 아이콘이 없다.

## 범위

- **dmg를 dmgbuild로 만든다.** Finder·AppleScript 없이 `.DS_Store`를 직접 써서 CI에서도 같은 창이 나온다. 버전을 해시까지 고정해 설치한다(`scripts/dmgbuild-requirements.txt`, `uv pip install --require-hashes`). 릴리스 워크플로와 로컬 `pnpm release:mac`이 같은 방법으로 설치한다. 설정 파일은 `scripts/dmg-settings.py`다.
- **창.** 540×380, 아이콘 크기 128, 앱은 왼쪽·Applications는 오른쪽 가운데 높이, 툴바·사이드바·상태 막대를 숨긴다.
- **배경 그림.** 540×380과 @2x(1080×760). Ink 바탕, Paper 글자, Ganger Yellow 화살표, 위쪽 가운데 호루라기, 짧은 영어 안내("Drag Ganger to Applications"). 원본은 `packages/ui/brand/dmg/background.svg`이고(로고 원본 시험이 글자 패스·파일 목록을 보는 brand 폴더 바로 아래를 피해 하위 폴더에 둔다), `node scripts/dmg-background.ts`가 PNG 둘을 다시 만든다. 브랜드 가이드에 한 줄 더한다.
- **볼륨 아이콘.** [0077](0077-ganger-logo-and-icon.md)의 `apps/desktop/icons/icon.icns`를 dmg 볼륨 아이콘으로 쓴다.
- **서명·공증 흐름 유지.** dmg를 만든 뒤 지금처럼 서명·공증·staple한다. 서명 없는 경로도 같은 창이다.
- **검사.** `node scripts/check-dmg.ts <dmg>`가 dmg를 마운트해 `.DS_Store`(두 아이콘 위치와 창 설정)·배경·볼륨 아이콘·Applications 링크·앱을 확인한다. 판정 함수는 scripts 시험이 덮고, 릴리스 워크플로 확인 단계와 `pnpm release:mac` 끝에서 돈다.

## 완료 조건

- 서명 없는 dmg를 이 맥에서 만들어 마운트하면 배경 그림 위에 앱과 Applications가 나란히 놓인 창이 뜬다(PR에 스크린숏).
- `check-dmg` 판정 시험과 배경 PNG 크기 시험이 통과한다.

## 결과(2026-11-19)

- 이 맥(arm64)에서 서명 없는 `pnpm release:mac`을 끝까지 돌렸다. dmgbuild 1.6.7로 만든 dmg를 `check-dmg`가 통과시켰고, `hdiutil`로만 묶은 dmg는 배경·볼륨 아이콘·`.DS_Store`가 없다고 멈췄다.
- `open`으로 띄운 Finder 창은 540×380이었다. 이 세션에 화면 기록 권한이 없어 스크린숏은 찍지 못했고, 대신 `.DS_Store`를 읽어 창 설정(툴바·사이드바·상태 막대 숨김, 아이콘 128, 배경 `.background.tiff`)과 아이콘 위치(앱 140,180, Applications 400,180)를 확인했다.
- 남은 확인: 운영자가 다음 rc dmg를 열어 창을 눈으로 본다. 밝은 화면 모드에서는 Finder가 아이콘 이름을 검은 글자로 그려 Ink 바탕에서 잘 안 보일 수 있다.
