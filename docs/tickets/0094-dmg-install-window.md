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
- **창.** 내용 영역 540×380(제목 막대 32를 더해 창 높이 412), 아이콘 크기 128, 앱은 왼쪽·Applications는 오른쪽 가운데 높이, 툴바·사이드바·상태 막대를 숨긴다.
- **배경 그림.** 540×380과 @2x(1080×760). Paper 바탕, Ink 글자, 진한 노랑(`oklch(0.62 0.15 70)`, Paper 위 3.4:1) 화살표, 위쪽 가운데 Ink 몸통·노란 취구 호루라기, 짧은 영어 안내("Drag Ganger to Applications"). 원본은 `packages/ui/brand/dmg/background.svg`이고(로고 원본 시험이 글자 패스·파일 목록을 보는 brand 폴더 바로 아래를 피해 하위 폴더에 둔다), `node scripts/dmg-background.ts`가 PNG 둘을 다시 만든다. 브랜드 가이드에 한 줄 더한다.
- **볼륨 아이콘.** [0077](0077-ganger-logo-and-icon.md)의 `apps/desktop/icons/icon.icns`를 dmg 볼륨 아이콘으로 쓴다.
- **서명·공증 흐름 유지.** dmg를 만든 뒤 지금처럼 서명·공증·staple한다. 서명 없는 경로도 같은 창이다.
- **검사.** `node scripts/check-dmg.ts <dmg>`가 dmg를 마운트해 `.DS_Store`(두 아이콘 위치와 창 설정)·배경·볼륨 아이콘·Applications 링크·앱을 확인한다. 판정 함수는 scripts 시험이 덮고, 릴리스 워크플로 확인 단계와 `pnpm release:mac` 끝에서 돈다.

## 완료 조건

- 서명 없는 dmg를 이 맥에서 만들어 마운트하면 배경 그림 위에 앱과 Applications가 나란히 놓인 창이 뜬다(PR에 스크린숏).
- `check-dmg` 판정 시험과 배경 PNG 크기 시험이 통과한다.

## 결과(2026-11-19)

- 이 맥(arm64)에서 서명 없는 `pnpm release:mac`을 끝까지 돌렸다. dmgbuild 1.6.7로 만든 dmg를 `check-dmg`가 통과시켰고, `hdiutil`로만 묶은 dmg는 배경·볼륨 아이콘·`.DS_Store`가 없다고 멈췄다.
- 처음에는 Ink 바탕이었다. 밝은 모드에서 Finder가 아이콘 이름을 검은 글자로 그리면 Ink에 묻힌다는 지적(코디네이터 2026-11-19)에 따라 Paper 바탕으로 바꿨다.
- 어두운 모드(이 맥)에서 띄운 창을 찍어 보니 Finder는 Paper 바탕 위 이름을 검은 글자로 그렸다. Finder가 이름 색을 시스템 모드가 아니라 배경 그림 밝기로 고르므로, 이름 아래를 어둡게 하는 띠는 넣지 않았다. 띠를 넣으면 오히려 검은 이름이 띠 위에 묻힌다.
- 창 높이 380은 제목 막대를 포함해 배경 아래 32가 잘렸다. 창 높이를 412로 올려 배경 540×380이 모두 보인다.
- 남은 확인: 서명 경로(다음 rc 태그)와 실제 앱 아이콘 모양(0031의 앱 아이콘 눈 확인).
