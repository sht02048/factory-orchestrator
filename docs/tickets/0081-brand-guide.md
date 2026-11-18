---
status: done
blocked_by: [0077, 0080]
---

# 0081 브랜드 가이드 문서

## 목표

흩어진 브랜딩 규칙을 저장소 한곳에 모은다(운영자 요청 2026-11-18). 기여자와 에이전트가 기호·마스코트·색·워드마크·앱 아이콘을 쓸 때 한 문서만 열면 되게 한다.

## 배경

지금 브랜딩 규칙은 티켓 [0077](0077-ganger-logo-and-icon.md)·[0080](0080-apply-brand-to-app-ui.md)(작업 기록), `packages/ui/DESIGN.md`의 "브랜드 그림(티켓 0077)" 절, [ADR 0010](../adr/0010-ui-words-and-visual-rules.md) 5·11번, `packages/ui/brand/`의 원본에 흩어져 있다. 운영자가 만든 브랜드 시트는 비공개 캔버스라 저장소에 없다. 티켓은 그때의 작업 기록이라 0080이 0077의 색 규칙을 바꾼 것처럼 앞뒤가 다르고, 지금 규칙을 알려면 여러 문서를 이어 읽어야 한다.

## 범위

- **`packages/ui/brand/README.md`** 를 영어로 쓴다(공개 저장소의 사용자·기여자 문서, ADR 0005). 담을 것:
  - 두 기호의 역할: 호루라기(기호)와 반장(마스코트), 마스코트 표정 넷과 각 자리.
  - 브랜드 세 색(Ink·Paper·Ganger Yellow)과 0080 뒤 앱 화면에서의 쓰임. 앱 화면 값은 `packages/ui/src/tokens.stylex.ts`를 기준으로 확인한다.
  - 워드마크(Manrope ExtraBold, 소문자, 자간 −4%, 아웃라인 SVG, OFL 고지 파일).
  - 조합(가로·세로), 여백(기호 주위 취구 한 칸), 최소 크기(기호만 16px 전용판, 조합 높이 20px).
  - 하지 말 것: 마스코트를 앱 아이콘·파비콘에 쓰기, 기호에 그림자·빛·그라데이션 넣기, 마스코트에 팔다리·옷 더하기, 마스코트를 목록·상태 알약·버튼 옆에 두기, 노랑을 상태 색으로 쓰기.
  - 앱 아이콘 규격: 1024 정사각형 레이어 원본, `.icon` + `.icns`, Xcode 26이 없으면 `.icns`만.
  - 원본 파일 표(파일 이름 → 쓰임)와 컴포넌트(`GangerMark`, `Mascot`, `MascotMessage`)는 DESIGN.md로 잇는 링크.
- 이 문서와 DESIGN.md·ADR 0010이 겹치는 규칙은 링크로 잇고 값을 두 번 적지 않는다(어긋남 방지). 상태 색(Human Check 청록 등)과 컴포넌트 props는 각각 ADR 0010과 DESIGN.md에만 둔다.
- `packages/ui/DESIGN.md` "브랜드 그림" 절에 이 README로 가는 링크 한 줄을 더한다.
- 이 티켓은 문서만 고친다. 고칠 파일: `packages/ui/brand/README.md`, `packages/ui/DESIGN.md`(링크 한 줄), 이 티켓 파일, `docs/tickets/README.md`(순서도). 같은 때 도는 0074(검사 강제)가 `packages/ui`·`apps/web`을 고치므로 그 밖은 건드리지 않는다.

## 완료 조건

- `packages/ui/brand/README.md`가 위 항목을 모두 담고, 색 값이 `tokens.stylex.ts`와 같다.
- DESIGN.md 브랜드 절에서 이 README로 가는 링크가 있다.
- 문서 형식 검사(커밋 훅의 format check)를 통과한다. 스크린숏은 필요 없다.
