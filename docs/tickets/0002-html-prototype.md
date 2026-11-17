---
status: done
blocked_by: []
---

# HTML 시안 8개 화면

## 목표

실제 기능 개발 전에 오케스트레이터의 디자인과 UX 느낌을 잡는다. 버려도 되는 정적 시안이다.

## 범위

- `design/prototype/`에 정적 HTML + CSS(React·StyleX 없이)
- 시각 디자인 원칙(위계, 색, 타이포그래피, 마감 디테일) 적용
- 다크 모드만. 정보는 많되 위계가 분명한 운영 도구 톤
- 구조는 목록 + 오른쪽 상세 패널(ADR 0007)
- 화면
  1. 홈: 손댈 일(Human Check·Failed), 실행 중, Queued를 현재 Workspace 범위로 본다. "전체"는 모든 Workspace의 손댈 일만
  2. Tickets: Linear 티켓 목록, 할당, 마지막 런 결과
  3. Runs: 전체 런 목록과 상태 필터
  4. Run 상세: 타임라인, 로그 꼬리, PR·CI 상태, 결과와 이유
  5. Runners: Online/Offline, capacity 사용량, 프로젝트, capacity를 쓰는 런의 Workspace
  6. Stats: 처리량, 결과 분포(Merged / Human Check / Failed), 리드 타임, 러너·트래커 프로젝트·에이전트별 보기
  7. Settings: 이 Workspace(이름, 트래커 프로젝트, Mapping, Auto-assign Label)와 설치 전체(트래커 연결, GitHub 토큰, 러너 등록)를 나눈다
  8. 온보딩: 첫 진입 전용 전체 화면. 트래커 연결 → GitHub 토큰 → 첫 러너 등록과 ssh 연결 확인 → 첫 Workspace 만들기 → 첫 Mapping → 완료. 모든 단계가 필수다
- 목 데이터와 라벨은 `GLOSSARY.md` 용어만 쓴다. UI 문구는 한국어 해요체 UX 라이팅. 러너·프로젝트·티켓 키 같은 목 데이터는 가상 값
- 방향이 갈리는 화면은 2~3개 안을 나란히 두고 고른다

## 완료 조건

- 8개 화면을 브라우저로 열어 오갈 수 있다
- 운영자가 방향을 확정했다
