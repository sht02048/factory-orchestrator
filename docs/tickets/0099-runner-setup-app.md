---
status: doing
blocked_by: [0095, 0097]
---

# 0099 러너 등록 간소화 3: 다른 맥 · Ganger 앱으로 등록

## 목표

다른 맥에 Ganger 앱이 있으면 그 맥의 앱에서 "이 맥을 러너로 등록"을 눌러 이 서버에 러너로 붙인다. 0095의 고르기 화면에서 "다른 맥 · 그 맥에 Ganger 앱이 있어요"를 고르면 이 흐름으로 간다.

## 운영자 결정(2026-11-19, 시안 U10·U11)

- 필요한 것: 그 맥에 Ganger 앱·Orca 앱, 같은 tailnet.
- 직접 할 일: 그 맥에서 원격 로그인 켜기, "이 맥을 러너로 등록" 누르기.
- 그 맥에서 하는 준비는 0095의 "이 맥을 러너로"와 같다.

## 덧붙인 운영자 결정(2026-11-19)

- **토큰 받기.** 서버 화면(온보딩·Runners 러너 추가)에서 "다른 맥 · 그 맥에 Ganger 앱이 있어요"를 고르면 서버가 0097과 같은 일회용 등록 요청(10분·한 번)을 만들고, 서버 화면은 0097의 `EnrollmentView`로 "러너를 기다리는 중…"을 보인다. 그 서버에 "다른 서버에 붙기"로 붙어 있는 다른 맥의 Ganger 데스크톱 앱에 "이 맥을 러너로 등록할까요?"가 뜬다(시안 U10의 2번 흐름).
- **알아채는 방식.** 데스크톱 앱은 원격 모드일 때만 `GET /api/runner-enrollment/offer`를 3초마다 묻는다. 지금 데스크톱↔서버 연결은 main 프로세스의 HTTP 폴링(`/api/attention`)뿐이고 SSE는 0103이 만든다. 0103이 SSE를 깔면 이 요청을 SSE 이벤트 한 종류로 옮기고 이 폴링은 fallback이 된다.
- **누를 때 발급.** offer 응답은 `{ id, expiresInMs }`만 주고 토큰을 주지 않는다. 앱에서 사람이 "등록"을 누를 때 `POST /api/runner-enrollment/offer/accept`가 그 순간 토큰을 만들어(서버는 해시만 둔다) 설치 스크립트를 한 번만 돌려준다. 받은 뒤 그 요청은 다른 맥 앱에서 사라진다. 두 앱이 동시에 받으면 하나만 이긴다.
- **"토큰 없이 받는 끝점은 아무것도 하지 않는다"의 예외는 offer/accept 하나뿐이다.** 이유: offer/accept는 서버 화면과 같은 request guard(Host·Origin 검사)를 지난다. 서버 화면에는 인증이 없어 같은 사람이 이미 "러너 추가"로 토큰을 낼 수 있으니, 이 끝점이 새로 넓히는 권한은 없다.
- **준비 방식.** 앱은 0097이 만든 설치 스크립트(`packages/app/src/runner-setup/setup-script.ts`)를 그대로 받아 디스크에 쓰지 않고 `sh -s`의 stdin으로 돌린다. 같은 일을 앱 코드로 다시 구현하지 않는다. 스크립트가 끝에 `POST <webAddress>/api/runner-enrollment`로 결과를 보내는 경로도 그대로 쓴다. 토큰·비밀값은 프로세스 인자·앱 로그·화면에 남지 않는다.
- **진행.** 스크립트는 환경 변수 `GANGER_PROGRESS=1`일 때만 기계용 줄(`ganger-step:<단계>`, `ganger-fail:<문제>`)을 더 낸다. 명령 경로의 출력은 그대로다. 기계용 줄에는 토큰·비밀값이 섞이지 않는다.
- **취소.** 받기 전 취소는 그 앱에서만 숨긴다(서버에 아무것도 보내지 않는다). 받은 뒤 취소는 스크립트를 멈추고 그 토큰으로 `outcome: failed`, `problem: canceled`를 보내 서버 화면에 보인다.
- **0097에서 넘긴 것.** `startEnrollment`·`receiveEnrollment`·`RunnerEnrollments`·`EnrollmentView`를 다시 쓴다. 토큰은 메모리에만 있다(그대로 둔다).
- **고르기 화면.** 0095 고르기 화면의 "다른 맥 · 그 맥에 Ganger 앱이 있어요" '곧 지원' 꼬리표를 떼고 이 흐름으로 잇는다(온보딩·Runners 둘 다).
- **앱 쪽 화면.** 앱이 어떤 서버(이름)에 붙어 있는지, 직접 할 일(원격 로그인 켜기) 안내, 등록/취소, 진행(원격 로그인 → 키 등록 → Orca 서비스 → GitHub → 서버에 등록), 실패·만료를 보인다. 요청이 오면 창을 앞으로 가져와 앱 화면으로 바꾸고, 창이 가려져 있으면 macOS 알림도 띄운다. 취소하거나 끝나면 서버 화면으로 돌아간다.
- **서버 맥 자신에는 뜨지 않는다.** 로컬 모드는 묻지 않는다. 원격 주소가 loopback이거나, 이 맥 loopback에서 도는 서버의 instanceId가 원격 서버와 같으면 띄우지 않는다.

## 범위

- 0095가 만든 Ganger 전용 ssh 키와 관리 방식(`access`)을 그대로 쓴다.
- 0095에서 "곧 지원"으로 둔 선택지를 연다.

## 완료 조건

- 다른 맥의 앱이 서버에 등록을 요청하고, 서버가 그 맥을 Ganger 관리 러너로 저장하는지 시험한다.

## 정한 것(구현 때)

- **등록 요청(offer).** `RunnerEnrollments.offer()`가 토큰 없는 요청을 만든다. `openOffer()`는 가장 새로 만든, 아직 아무 앱도 받지 않은 살아 있는 요청의 `{ id, expiresInMs }`만 준다. `acceptOffer(id)`는 그 순간 토큰(24바이트 base64url)을 만들어 해시만 두고 요청을 "받음"으로 바꾼다. 같은 요청을 두 번 받으면 `taken`, 10분이 지나면 `expired`, 거둔 요청이나 명령 흐름의 id는 `unknown`으로 거절한다. 받은 토큰은 받은 때부터 10분 산다(그 맥이 원격 로그인을 켜느라 기다릴 수 있어서). 서버 화면은 받은 뒤 "그 맥의 앱이 준비하고 있어요"(`EnrollmentView`의 `preparing`)를 보인다.
- **끝점.** `GET /api/runner-enrollment/offer`(`{ offer: { id, expiresInMs } | null }`), `POST /api/runner-enrollment/offer/accept`(JSON `{ id }` → `{ ok: true, script }` 또는 410 `{ ok: false, reason }`, 서버 주소·홈·키가 없으면 503). 둘 다 서버 화면과 같은 request guard를 지난다. 결과 보고는 0097의 `POST /api/runner-enrollment`를 그대로 쓴다. 문제 이름 `canceled`를 더했다.
- **설치 스크립트.** 0097 스크립트에 `GANGER_PROGRESS=1`일 때만 나오는 `ganger-step:<remote-login-wait|remote-login|key|service|github|report>`, `ganger-github:<결과>`, `ganger-fail:<문제|refused|unreachable|canceled>` 줄을 더했다. INT·TERM을 받으면 그 토큰으로 `canceled`를 보고하고 멈춘다(터미널 명령에서 Ctrl-C도 서버 화면에 보인다). 서버에 결과를 보내기 직전에는 이 처리를 끈다. 공용 상수는 의존성 없는 `packages/app/src/runner-setup/enrollment-protocol.ts`에 두어 데스크톱이 DB 코드를 끌어오지 않는다.
- **데스크톱 앱.** `RunnerEnrollmentFlow`(`apps/desktop/src/core/runner-enrollment.ts`)가 원격 모드에서 3초마다 요청을 묻고, 요청이 오면 창을 앞으로 가져와 앱 화면 "이 맥을 러너로 등록할까요?"로 바꾼다(창이 가려져 있으면 macOS 알림도). 등록을 누르면 받은 스크립트를 `/bin/sh -s`의 stdin으로 돌리고(stderr는 버리고 stdout에서 기계용 줄만 읽는다) 원격 로그인 → 키 등록 → Orca 서비스 → GitHub → 서버에 등록을 보인다. 취소는 프로세스 그룹에 TERM을 보낸다. 받기 전 취소와 닫은 요청은 그 앱에서만 다시 띄우지 않는다. 앱을 끄면 돌던 스크립트를 멈춘다. GUI 앱의 짧은 PATH를 보태려고 `/opt/homebrew/bin`, `/usr/local/bin`을 더한다.
- **서버 맥 자신.** 로컬 모드는 묻지 않는다. 원격 주소가 loopback이거나, 이 맥 127.0.0.1(찾기 포트와 저장한 주소의 포트)에서 도는 서버의 instanceId가 원격 서버와 같으면 묻지 않는다. 판정은 서버마다 한 번 해 둔다.
- **고르기 화면.** "다른 맥 · 그 맥에 Ganger 앱이 있어요"를 열고 칩(직접 해요: 원격 로그인 켜기 → 직접 해요: 앱에서 등록 누르기 → 키·서비스·GitHub → 확인)과 "약 2분"을 둔다. 서버 화면 흐름은 0097의 기다림·등록·주소 입력 조각을 `apps/web/src/runner-setup/enrollment.tsx`로 옮겨 명령 흐름과 같이 쓴다.

## 다음 티켓에 넘김

- **0103(데스크톱 알림 SSE).** 앱의 등록 요청 알아채기는 지금 `GET /api/runner-enrollment/offer` 3초 폴링이다. 0103이 SSE 연결을 깔면 "러너 등록 요청"을 SSE 이벤트 한 종류로 옮기고, 이 폴링은 0103의 폴링 fallback과 함께 SSE가 안 될 때만 쓴다. offer 응답에는 토큰이 없으니 SSE 이벤트에도 토큰을 싣지 않는다.
- 토큰과 요청은 메모리에만 있어 서버를 다시 켜면 사라진다(0097과 같다).
