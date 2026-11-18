# 셀프호스팅 제품으로 만든다

이 저장소는 운영자 한 사람의 도구가 아니라, 다른 사람이 설치해 자기 환경으로 설정해 쓰는 셀프호스팅 제품이다. 대상은 Orca로 여러 에이전트를 돌리는 개인 개발자와 작은 팀이고, 설치 하나당 운영자는 한 명이다. 필수 의존성은 Orca, GitHub, Linear뿐이다.

- **개인 값을 저장소에 넣지 않는다.** 실명, 이메일, 호스트명, tailnet 안의 주소, 기기 이름, GitHub 계정, Linear 워크스페이스, 로컬 경로 같은 운영자 환경 값은 코드·문서·설정 어디에도 두지 않고 모두 설정으로 받는다. 예시에는 가상 값(`example.com`, `acme`)을 쓴다. 한 번 공개 저장소의 이력에 들어간 값은 지우기 어렵기 때문이다.
- **설정은 첫 실행 때 웹 온보딩에서 한다.** 트래커 연결 → GitHub 토큰 → 첫 러너 등록과 ssh 연결 확인 → 첫 Workspace 만들기(트래커 프로젝트 고르기) → 첫 매핑 순서다. 토큰은 DB에 암호화해 저장하고, `.env`에는 부팅에 필요한 최소값(포트, 데이터 경로, 암호화 키 등)만 둔다. 설정 파일을 손으로 고치게 하면 연결 확인을 미루게 되고 비밀값이 평문 파일에 흩어진다.
- **배포는 npm 패키지 하나와 CLI다.** CLI는 `init`, `start`, launchd·systemd 서비스 등록을 맡고, macOS·Linux에서 네이티브로 돈다. Docker 이미지는 나중으로 미룬다. 오케스트레이터는 ssh로 러너에 명령하는데, macOS에서 컨테이너 안에서는 호스트의 ssh 설정·키와 Tailscale을 쓰기 불편하기 때문이다.
- **Tailscale은 필수가 아니라 권장 구성이다.** 러너는 ssh로 닿기만 하면 된다. Linear webhook을 밖에 여는 방법은 Tailscale Funnel, Cloudflare Tunnel, 리버스 프록시 중에서 운영자가 고른다.
- **문서 언어를 나눈다.** README와 사용자 문서는 영어로 쓰고, 내부 설계 문서(GLOSSARY, ADR, 티켓)는 한국어로 쓴다.
- **UI는 한국어 우선이되 처음부터 i18n 구조로 만든다.** 화면 문구는 컴포넌트에 직접 쓰지 않고 메시지 파일로 분리한다. 나중에 문구를 뽑아내는 일은 화면이 늘수록 비싸진다.

릴리스는 SemVer와 Changesets로 하고 1.0 전까지는 0.x를 쓴다. 업데이트할 때 DB 마이그레이션을 자동으로 실행한다. 이름 `factory-orchestrator`는 임시다.

**갱신(2026-11-18, 운영자 결정, 티켓 0029).** 지금 만드는 배포물은 의존성까지 묶은 서버 배포물(폴더와 tarball, Node 미포함)이고 공개하지 않는다. npm 패키지로 낼지와 Changesets는 릴리스 티켓 0031에서 정한다. CLI가 `init`, `start`, 서비스 등록을 맡는 점은 그대로다.

**갱신(2026-11-18, 운영자 결정, 티켓 0076).** 제품 이름은 Ganger다. 위의 임시 이름 `factory-orchestrator`와 그 이름이 들어간 패키지·CLI 명령·설치 폴더·환경 변수·데스크톱 앱 이름을 바꾸는 표와, 이미 설치한 곳을 옮기는 규칙은 [ADR 0011](0011-product-name-ganger.md)에 있다.

**갱신(2026-11-19, 운영자 결정, 티켓 0031).** 위의 "배포는 npm 패키지 하나와 CLI다"를 바꾼다. 배포는 macOS 앱(dmg)을 GitHub Release로 올리는 것이다. npm 패키지는 내지 않고 Changesets도 쓰지 않는다. dmg는 Developer ID로 서명하고 공증하며, `v*` 태그를 push할 때 GitHub Actions의 `release` 워크플로가 만든다. 버전은 루트와 `apps/desktop`의 `package.json`을 PR로 올린 뒤 태그를 단다. CLI가 `init`, `start`, launchd·systemd 서비스 등록을 맡는 점은 그대로다. Linux·macOS 서버 배포물(티켓 0029)은 0.1.0에 올리지 않을 뿐이고, Linux 서버 지원을 접는 것이 아니다.

## Considered Options

- **Docker 이미지 우선 배포**: 설치는 쉽지만 macOS에서 ssh·Tailscale 연동이 불편해 미룬다.
- **Tailscale 필수**: 네트워크 구성을 강제해 설치할 수 있는 사람이 줄어 권장 구성으로만 둔다.
