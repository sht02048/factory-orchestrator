---
status: done
blocked_by: []
---

# 1단계 완료 기준 시험

## 목표

스펙 1절의 완료 기준(Q48)을 실제 환경에서 확인한다.

## 범위 변경(운영자 결정 2026-11-18, Q90)

- 0029(npm 패키지)와 0031(릴리스)은 보류다. 그래서 이 시험은 npm 패키지 대신 저장소를 빌드해 CLI로 띄운다(`init` → `start`, 임시 home과 포트). npm publish, 태그, Release는 하지 않는다. 그래서 0029를 기다리지 않는다(`blocked_by`에서 뺐다).
- 완료 조건에서 "운영자가 결과를 보고 0.1.0 릴리스를 승인했다"를 뺐다. 결과 기록과 결함 티켓만 남긴다.
- 스펙 1절 완료 기준의 "npm CLI로 설치"와 "0.1.0으로 릴리스"에는 티켓 0042·0043의 PR에서 Q90을 반영했다.

## 범위

- 저장소를 빌드해 CLI `init`·`start`로 띄운다(위 범위 변경. 원래는 0029의 패키지 파일을 npm으로 설치).
- 온보딩을 끝까지 하고, 테스트 Linear 워크스페이스의 티켓 하나에 Auto-assign Label만 붙인다.
- 그 런이 러너에서 처리되고 에이전트 결과와 PR 상태가 기록돼, 요약 결과(Merged / Human Check / Failed / Canceled 중 하나)와 함께 홈·Runs·Run 상세·Stats에 나타나는지 본다.
- 운영자 준비가 필요하다: 테스트용 Linear 워크스페이스와 webhook 공개 URL, fine-grained GitHub 토큰, Orca 상시 서비스가 있는 테스트 러너, 에이전트가 CI 통과 뒤 병합하도록 설정된 테스트 저장소(ADR 0004).
- 발견한 결함은 새 티켓으로 남긴다.

## 완료 조건

- 위 흐름의 화면(온보딩 완료, Run 상세의 두 축과 요약 결과, Stats)과 Linear 티켓의 상태·결과 댓글을 PR에 기록했다. 운영자 환경 값은 가렸다.

## 결과

2026-11-18에 흐름을 끝까지 돌렸다. 라벨만 붙인 티켓이 webhook으로 자동 할당돼 70초 만에 요약 결과 Merged로 끝났다. 기록은 research [0011](../research/0011-acceptance-run.md)에 있다. 온보딩만으로는 Auto-assign Label과 "In Progress" 상태가 비어 Settings에서 골랐다. 찾은 결함은 0041~0045로 남겼다.
