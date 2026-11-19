---
status: done
blocked_by: [0094]
---

# dmg 안 앱의 FinderInfo 때문에 릴리스 검증이 실패하는 문제

## 배경

`v0.1.0-rc.3` 릴리스 워크플로(run 44441561806)의 macos 잡에서 "Verify the dmg and the app inside it" 단계가 멈췄다. dmg를 마운트해 앱에 `codesign --verify --deep --strict`를 돌리자 다음과 같이 실패했다.

```
Ganger.app: resource fork, Finder information, or similar detritus not allowed
Disallowed xattr com.apple.FinderInfo found on …/Ganger.app
```

[0094](0094-dmg-install-window.md)에서 dmg를 dmgbuild로 만들면서 `scripts/dmg-settings.py`에 `hide_extensions = [app_name]`을 넣었다. dmgbuild는 확장자 숨김을 앱 번들의 `com.apple.FinderInfo` xattr로 기록하고, 서명된 번들에 FinderInfo가 붙으면 `codesign --strict`가 거부한다. Finder는 `.app` 확장자를 원래 숨기므로 이 설정은 필요 없다.

## 범위

- `scripts/dmg-settings.py`에서 `hide_extensions`를 뺀다.
- `scripts/check-dmg.ts`가 dmg 안 앱 번들 전체에 `com.apple.FinderInfo`·`com.apple.ResourceFork` xattr이 없는지 `xattr -r`로 검사한다. 판정 함수는 scripts 시험이 덮는다.
- `check-dmg`가 dmg 안 앱을 임시 폴더로 복사해 ad-hoc 서명하고 `codesign --verify --deep --strict`를 돌린다. 서명 없는 경로에서도 서명 검증이 거부할 찌꺼기를 미리 잡는다.
- 태그를 만들거나 릴리스를 시작하지 않는다.

## 완료 조건

- 바꾸기 전 설정으로 만든 dmg에서 앱에 `com.apple.FinderInfo`가 붙고 `codesign --verify --deep --strict`가 실패하는 것을 재현한다. 바꾼 뒤에는 둘 다 사라진다.
- 이 맥에서 서명 없는 `pnpm release:mac`을 끝까지 돌려 `check-dmg`가 통과한다.
- `check-dmg` xattr 판정 시험이 통과한다.

## 결과(2026-11-19)

- dmgbuild 1.6.7로 `/usr/bin/true`를 실행 파일로 둔 ad-hoc 서명 앱을 dmg로 묶어 재현했다. `hide_extensions`가 있으면 dmg 안 `Ganger.app`에 `com.apple.FinderInfo`가 붙고 `codesign --verify --deep --strict`가 rc.3과 같은 메시지로 실패했다. 빼면 xattr이 없고 검증이 통과했다.
- 바꾸기 전 dmg는 새 `check-dmg`가 FinderInfo와 ad-hoc 서명 검증 실패 둘 다로 멈췄고, 바꾼 뒤 dmg는 통과했다.
- 이 맥(arm64)에서 서명 없는 `pnpm release:mac`을 끝까지 돌렸고, 실제 Electron 앱을 담은 dmg를 `check-dmg`가 ad-hoc 서명 검증까지 통과시켰다.
- 남은 확인: Developer ID 서명 경로(다음 rc 태그의 릴리스 워크플로).
