---
status: done
blocked_by: []
---

# 0084 서버가 도는 동안 맥이 잠들지 않게

## 목표

오케스트레이터 서버가 도는 맥이 자리를 비운 사이 잠들지 않게, 제품이 스스로 잠자기를 막는다.

## 배경

운영자와 정했다(2026-11-19). 서버를 도는 맥이 자리를 비운 사이 잠들면 web·worker·러너 ssh가 멈추고 webhook을 놓친다. macOS에는 잠든 채 프로그램을 돌릴 길이 없으니 잠자기를 막아야 한다. 지금은 운영자가 Amphetamine으로 막는다. 제품이 스스로 막으면 다른 설치에서도 설정 없이 된다.

막는 것은 자리를 비워 생기는 잠자기(idle sleep)뿐이다. 뚜껑 닫기, 사용자가 고른 잠자기, 배터리 부족은 막지 못한다. 러너 맥은 대상이 아니다.

## 범위

- **서버가 도는 동안 idle sleep을 막는다.** 런이 있을 때만이 아니라 서버가 도는 내내다(webhook을 받아야 하므로).
  - CLI `ganger start`(서비스로 돌 때 포함): macOS에서 `/usr/bin/caffeinate -i -w <start pid>`로 잠자기 방지를 건다. `start`가 끝나면 풀고, `start`가 강제로 끝나도 `-w`로 함께 풀린다. caffeinate가 없거나 실패하면 경고만 하고 서버는 그대로 돈다.
  - 데스크톱 앱: 앱이 띄운 서버(②)도 `ganger start`로 돌아 CLI의 잠자기 방지가 이미 걸린다. 앱만 끝내도 ②는 계속 돌므로, 앱의 `powerSaveBlocker`는 서버 수명과 어긋난다(앱이 꺼지면 풀린다). 그래서 둘을 걸지 않고 CLI caffeinate 하나로 정리했다(코디네이터 결정 2026-11-19). 원격 서버에 붙는 모드는 이 맥에서 서버를 띄우지 않으니 걸 것이 없다.
- **켜고 끄기.** 기본은 켜짐이다. Settings 「설치 전체」에 「잠자기」 항목을 두고 "서버가 도는 동안 이 맥이 잠들지 않게"를 켜고 끈다.
  - 저장 위치: DB 저장 형식을 바꾸지 않으려고(one-way 피함) 설치 폴더의 `<home>/power.json`(`{"preventSleep": boolean}`)에 둔다. `.env`처럼 0600으로, 임시 파일에 쓴 뒤 rename한다. 읽기 실패나 잘못된 내용이면 켜짐으로 두고 경고를 한 번 남긴다(코디네이터 결정 2026-11-19).
  - `start`가 web에 설치 폴더(`GANGER_HOME`)를 넘기고, web Settings가 그 폴더의 `power.json`을 쓴다. 설치 폴더를 모르는 web(예: `pnpm dev`)에서는 "여기서 바꿀 수 없어요"로 보인다.
  - `start`가 5초마다 파일을 다시 읽어, 값이 바뀔 때만 caffeinate를 켜고 끈다. 다시 시작 없이 적용된다.
- **안내.** README(영어)의 실행 안내에 뚜껑·직접 고른 잠자기·배터리 부족은 막지 못하고, 노트북은 전원 연결·외부 모니터(clamshell) 또는 pmset 설정이 필요하며, 러너 맥도 같다고 적는다. Settings 설명 문구도 같은 한계를 해요체로 적는다.
- 화면 문구는 `apps/web/messages/ko/settings.json`에 둔다. 0074 검사(토큰·HTML 요소·길이)를 지킨다.

## 완료 조건

- 서버가 도는 동안 잠자기 방지가 걸리고 서버가 끝나면 풀린다는 시험: caffeinate 호출·종료를 가짜로 대신하는 단위 시험(`apps/cli/src/keep-awake.test.ts`, `start.test.ts`, `program.test.ts`).
- 데스크톱: 앱이 띄운 서버가 잠자기 방지를 거는 CLI `start` 경로를 쓴다는 시험(`apps/desktop/src/core/local-server.test.ts`). `powerSaveBlocker` 시험은 위 결정으로 이 시험으로 바꿨다.
- 설정을 끄면 걸지 않는다는 시험.
- 이 맥에서 `ganger start`를 띄운 뒤 `pmset -g assertions`에 caffeinate의 PreventUserIdleSystemSleep이 보이고, 끄면 사라진다는 확인(PR에 출력 요약).
- Settings 스크린숏 1280px.

## 후속

- Linux 서버의 잠자기 방지(예: `systemd-inhibit --what=idle`)는 범위 밖이다. 0.1.0은 macOS 앱만 공개한다.
