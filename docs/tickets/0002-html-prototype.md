---
status: todo
blocked_by: []
---

# HTML 시안 6개 화면

## 목표

실제 기능 개발 전에 오케스트레이터의 디자인과 UX 느낌을 잡는다. 버려도 되는 정적 시안이다.

## 범위

- `design/prototype/`에 정적 HTML + CSS(React·StyleX 없이)
- emil 스킬(design-foundations, color, typography, ui-polish) 적용
- 다크 모드 우선, 라이트 모드 지원. 밀도 높은 운영 도구 톤
- 화면
  1. Tickets: Linear 티켓 목록, 할당, 자동 할당 여부
  2. Runs: Queued·진행 중·끝난 런 보드
  3. Run 상세: 타임라인, 로그 꼬리, PR·CI 상태, 결과
  4. Runners: Online/Offline, capacity 사용량, 프로젝트 목록
  5. Stats: 처리량, 결과 분포(Merged / Human Check / Failed), 리드 타임, 러너·프로젝트·에이전트별 보기
  6. Settings: Mapping(트래커 프로젝트 → 러너 프로젝트 + 에이전트), Auto-assign Label, 연결 정보
- 목 데이터와 라벨은 `GLOSSARY.md` 용어만 쓴다. UI 문구는 한국어 해요체(토스 UX 라이팅)
- 방향이 갈리는 화면은 2~3개 안을 나란히 두고 고른다

## 완료 조건

- 6개 화면을 브라우저로 열어 오갈 수 있다
- 운영자가 방향을 확정했다
