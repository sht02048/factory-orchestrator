---
status: done
blocked_by: [0007, 0015, 0027]
---

# web Settings 화면

## 목표

이 Workspace와 설치 전체의 설정을 고치고 연결을 확인한다.

## 범위

- 이 티켓은 `apps/web`의 Settings 라우트, 그 화면 메시지, web 서버가 DB 설정에서 codehost-github를 만드는 코드만 고친다.
- 이 Workspace: 이름, 트래커 프로젝트, Mapping(트래커 프로젝트 → 러너 쪽 프로젝트·에이전트, 러너는 고르지 않음, Q53), Auto-assign Label, 최대 실행 시간, "In Progress" 상태(ADR 0006·0007, Q39·Q41).
- 설치 전체: Tracker Connection(API 키, webhook signing secret), GitHub 토큰, 러너 등록(ssh 대상, orca 경로, capacity).
- 연결 확인: Linear와 GitHub는 server function이 어댑터로 바로 확인한다. GitHub 토큰 입력에는 필수 권한(Metadata, Pull requests 읽기)과 선택 권한(Actions 읽기, 있으면 Run 상세에 CI 상태가 보임)을 안내한다(Q79). 러너 확인은 DB에 요청을 남기고 worker가 쓴 결과를 보인다(Q61). 결과는 스펙 9절의 러너 필수 조건(Orca 상시 서비스, 비대화형 ssh 세션의 GitHub 인증)을 각각 보인다. GitHub 인증은 러너 쪽 프로젝트 저장소마다 `git push --dry-run` 결과를 보이고, 실패하면 해결 방법(`gh auth login --insecure-storage`와 `gh auth setup-git`, 또는 GitHub용 ssh 키)을 안내한다(Q82.15).
- 권한 안내: Mapping에서 에이전트가 쓸 권한을 그 프로젝트의 에이전트 설정에서 미리 허용하기를 권한다. 오케스트레이터 화면에서는 권한 프롬프트를 허용할 수 없기 때문이다(Q82.4).
- 토큰은 db의 암호화 저장을 쓴다.
- 한 트래커 프로젝트는 Workspace 하나에만 묶인다(ADR 0006).

## 완료 조건

- 각 설정을 저장하고 다시 열면 같은 값이 보인다는 테스트가 통과한다.
- 이미 다른 Workspace에 묶인 트래커 프로젝트를 고를 수 없다는 테스트가 통과한다.
- 러너 확인 요청이 DB에 생기고, 결과를 넣으면 성공·실패가 보인다는 테스트가 통과한다.
