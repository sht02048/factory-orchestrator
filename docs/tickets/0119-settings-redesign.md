---
status: doing
blocked_by: []
---

# 0119 Settings 화면 다시 짜기(S1 한 페이지)

## 목표

Settings 를 한 페이지에 모아 보는 화면(시안 S1)으로 바꾼다. 쓸데없이 늘 보이던 설명을 걷어내고, 온보딩과 같은 말투·컴포넌트를 쓴다.

## 배경

운영자 보고(2026-11-19): "세팅 페이지 완전 그린데 ui ux 다 손봐야 해. 너무 쓸데없는 정보 다 보여주고 온보딩이랑 톤도 안 맞고." 시안 셋 중 S1(한 페이지에 모아 보기)을 골랐고, 다듬은 보드 다섯 장(전체, 프로젝트 상세, 줄 안에서 바꾸기, 고급 › MCP, 400px)을 승인했다.

## 구조

- 한 페이지다. 왼쪽 목차(Workspace · 프로젝트 · 연결 · 이 서버 · 고급)와 본문 한 열(최대 720)을 둔다. 목차는 스크롤 위치를 따라 지금 구역을 표시하고, 문제가 있는 구역에는 점을 붙인다. 좁은 폭(400px)에서는 목차가 본문 위 가로 칩 줄이 된다.
- 구역마다 카드 하나에 줄(라벨 · 값 · 동작 하나)을 쌓는다. 줄의 두 번째 글줄은 짧은 상태·값만 둔다.
  - **Workspace**: 이름, 최대 실행 시간. Workspace 가 없으면 이 구역과 프로젝트 구역 대신 Workspace 를 만들라는 한 줄과 버튼.
  - **프로젝트**: 이 Workspace 의 트래커 프로젝트 줄(저장소 · 에이전트 · 바로 할당 라벨, 저장소를 안 정했으면 문제 문구와 "정하기"). "+ 넣기"로 트래커 프로젝트를 넣는다. 줄을 누르면 프로젝트 상세(`/settings/projects/$connectionId/$projectId`, 머리 "Settings › 이름")로 간다. 상세는 저장소(0115 머지 전에는 지금 Mapping 폼), 할당(바로 할당 라벨은 트래커 연결 단위라 그렇다고 적는다, 런 시작 때 바꿀 상태), 맨 아래 "이 Workspace에서 빼기"(확인 창)다.
  - **연결**: 트래커 연결 줄(webhook 여부, "관리"), GitHub 토큰("바꾸기"), 러너(대수와 문제 요약, Runners 로 가는 링크). 러너 등록·수정은 Settings 에서 빼고 Runners 화면이 맡는다(운영자 답 2026-11-19: Runners 상세 패널에 "고치기"를 더한다).
  - **이 서버**: 다른 기기에서 열 주소, 잠자기 막기 스위치(바꿀 수 없으면 꺼진 모양 + 이유 한 줄), 업데이트(버전 · 지금 확인).
  - **고급**: Webhook 공개 주소, MCP(하위 화면 `/settings/mcp`: 클라이언트 설정 탭 + 복사, 쓰기 허용 스위치와 위험 ⓘ 툴팁, 최근 작업).
- 바꾸기: 고르면 끝나는 값(스위치·선택·숫자)은 바로 저장하고 그 줄에 "저장하는 중 / 저장했어요 / 되돌렸어요"와 실패 이유를 보인다. 글로 넣고 확인이 필요한 값(이름·토큰·키·주소)은 "바꾸기"를 누르면 그 줄이 그 자리에서 펼쳐지고 "저장하기 / 닫기"를 둔다. 비밀 값 입력칸은 늘 띄우지 않는다.
- 보조 설명·주의 문구는 접기 상자가 아니라 라벨 옆 ⓘ 툴팁으로 둔다. 토큰·API 키 만드는 법은 "…에서 만들기 ↗" 바깥 링크 하나 + 필요한 권한 ⓘ 툴팁으로 줄인다.
- 빼는 것: 오른쪽 편집 영역(SplitView editor), 범위 표시("설치 전체", "{name} Workspace"), 항목마다 요약 칸, 화면 머리 부제, Mapping 안내 세 문단, MCP 도구 목록 같은 긴 설명.
- 같은 입력(트래커 API 키, GitHub 토큰)은 온보딩과 Settings 가 같은 컴포넌트를 쓴다.
- 머리 줄은 0113 의 56px `ScreenLayout` + `PageHeader` 를 따른다. ADR 0007·0010 에 Settings 예외와 이유를 적는다.

## 0115 와의 관계

0115(Mapping 여러 저장소·라벨)가 Mapping·라벨 부분의 기능·컴포넌트 주인이다. 이 티켓은 셸·구조·다른 구역부터 하고, 프로젝트 상세의 저장소·라벨 부분은 0115 가 머지되면 origin/develop 을 받아 0115 의 컴포넌트를 그 자리에 옮겨 쓴다. 머지는 0115 다음이다.

## 고칠 파일

- `apps/web/src/settings/**`, `apps/web/src/routes/_app/settings*.tsx`, `apps/web/messages/ko/settings.json`
- 온보딩과 같이 쓰는 입력: `apps/web/src/onboarding/onboarding-screen.tsx`
- 러너 고치기: `apps/web/src/runners/runners-screen.tsx`, `apps/web/src/routes/_app/runners.tsx`, `apps/web/messages/ko/runners.json`, `packages/app/src/runners/*`(러너 보기에 orca 경로)
- `packages/ui`(스위치, ⓘ 툴팁, 설정 줄 카드, 목차), `DESIGN.md`, `/ds`
- `e2e/src/settings.test.ts`, `e2e/src/desktop-updates.test.ts`
- ADR 0007·0010

## 완료 조건

- 시험: 구역·목차, 줄 안 편집(저장·닫기·실패), 바로 저장 되돌림, 바꿀 수 없는 잠자기, 주소 locks-out 경고, 프로젝트 상세 이동·빼기, Workspace 없음, MCP 하위 화면, 400px, Runners 의 러너 고치기. 기존 settings 시험은 새 구조에 맞게 고친다.
- 스크린숏: 전체 페이지(1280), 줄 펼침 오류, 프로젝트 상세, MCP, 400px.
- `better-interface` 리뷰(1728·1280·1100·800·400px)의 HIGH·MEDIUM 을 고치고, `interface-review` 로 Introduced·Regression 이 0 인지 확인한다.
