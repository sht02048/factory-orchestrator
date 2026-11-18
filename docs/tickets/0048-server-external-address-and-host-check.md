---
status: done
blocked_by: []
---

# 서버 바깥 주소 설정, Host·Origin 검사, 신원 확인 경로

## 목표

로그인이 없는 서버(0046 Q3)를 운영자 브라우저가 연 다른 사이트가 DNS 리바인딩이나 교차 출처 요청으로 부르지 못하게 한다. 운영자는 다른 기기에서 열 주소와 webhook 공개 주소를 설정으로 정하고, 데스크톱 앱(0046)은 tailnet 기기 중 오케스트레이터를 신원 확인 경로로 가려낸다.

## 배경

research [0013](../research/0013-remote-client-pairing.md)의 「운영자가 정할 것」과 「남은 위험」(web에 Host·Origin 검사가 없다)에서 나왔다. 운영자가 0046 그릴링 2라운드(2026-11-18)에서 Q9~Q13을 정했다.

- **Q9** DNS 리바인딩을 막는다. 로그인 없음(Q3)은 그대로다. 허용한 Host(127.0.0.1·localhost·설정한 바깥 주소의 호스트)로 온 요청만 받고, 상태를 바꾸는 요청(server function 포함)은 Origin도 본다. webhook 경로는 Origin을 보지 않고(서명으로 검증) Host는 webhook 공개 주소의 호스트도 받는다.
- **Q10** 신원 확인 경로를 이 티켓에서 만든다. 비밀이 아닌 값만 돌려주고, 이름과 응답 모양을 아래 계약으로 적는다.
- **Q11** 페어링 QR은 후속(0046에 적는다).
- **Q12** "다른 기기에서 열 주소"와 "webhook 공개 주소"를 따로 둔다. 온보딩 1단계의 webhook 주소는 브라우저 주소창이 아니라 webhook 공개 주소로 그린다. Host 허용 목록은 이 설정에서 나온다.
- **Q13** 0046의 (b)는 `http://<기기>:3000` 먼저, 그다음 HTTPS 443(Tailscale Serve), 기기당 1초 시간 제한(0046에 적는다).

## 범위

- **주소 설정.** DB 설치 설정(`install_settings`, 한 줄)에 `web_address`·`webhook_address`(origin)와 설치 ID를 둔다. Settings 설치 전체에 「주소」 항목을 더하고, 온보딩 1단계에 webhook 공개 주소 칸을 둔다.
  - `.env`가 아니라 DB에 두는 까닭: 부팅에 필요한 값이 아니고(ADR 0005의 `.env` 최소값), 운영자가 화면에서 고치면 서버를 다시 띄우지 않아도 다음 요청부터 맞는다. 온보딩 중에는 Settings에 들어갈 수 없어 1단계에서 바로 넣어야 하는데, `.env`면 화면에서 넣을 수 없다.
  - `init` 옵션은 더하지 않는다. `init`은 `.env`만 쓰고 DB를 열지 않는다. 처음에는 서버 기계의 `http://127.0.0.1`(또는 ssh 포트 전달)로 Settings를 연다.
  - 경로·쿼리·사용자 정보가 붙은 주소와 http·https가 아닌 주소는 받지 않는다. 저장하면 지금 보는 화면의 호스트가 허용 목록에서 빠지는 값은 저장하지 않는다(`locks-out`).
- **Host·Origin 검사.** web 서버 진입(`apps/web/src/server.ts`, TanStack Start server entry)이 라우터 앞에서 모든 요청을 거른다. 규칙은 `apps/web/src/server/request-guard.ts`.
  - 늘 받는 호스트: `127.0.0.1`, `localhost`, `[::1]`. 바인드 주소(`WEB_HOST`)가 특정 주소면 그 주소도 받는다(`pnpm dev`·`init --host`로 tailnet IP에 연 경우). `0.0.0.0`·`::`는 받지 않는다.
  - 다른 기기에서 열 주소의 호스트는 모든 경로에서, webhook 공개 주소의 호스트는 webhook 경로(`/api/webhooks/`)에서만 받는다. 포트는 비교하지 않는다(Serve·프록시가 바꿔 넘긴다).
  - GET·HEAD·OPTIONS가 아닌 요청은 Origin의 호스트가 다른 기기에서 열 주소·늘 받는 호스트여야 한다. Origin이 없으면 브라우저가 아닌 클라이언트라 받는다. `null`과 http·https가 아닌 Origin은 거절한다. webhook 경로는 Origin을 보지 않는다.
  - 거절은 `403`과 까닭 글(영어)이고, web 서버 로그에 `request rejected: 403 <host-not-allowed|origin-not-allowed> <방법> <경로> host=… origin=…`을 남긴다.
  - 서버 배포물의 정적 파일(`srvx -s`)은 이 검사 앞에서 나간다. 비밀이 없는 JS·CSS다.
- **신원 확인 경로.** 아래 계약. Host 검사를 받지 않는다.
- README Self-hosting에 두 주소와 Host 검사 단락(영어).

## 신원 확인 경로 계약

`GET /api/identity` — 인증 없음, `cache-control: no-store`, 어떤 Host로 물어도 `200`.

```json
{
  "product": "factory-orchestrator",
  "version": "0.1.0",
  "instanceId": "3f1c2b9e-…",
  "webAccess": "allowed"
}
```

| 필드         | 뜻                                                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product`    | 늘 `"factory-orchestrator"`. 다르면 우리 서버가 아니다                                                                                                                                         |
| `version`    | 제품 버전(루트 `package.json`, 서버 배포물 이름과 같다). 앱과 서버 버전 차이 알림에 쓴다                                                                                                       |
| `instanceId` | 설치마다 처음 한 번 만든 임의 UUID. 주소가 여러 개(MagicDNS 이름, Tailscale IP, Serve HTTPS)여도 같은 서버로 묶는다                                                                            |
| `webAccess`  | `"allowed"`: 물은 Host로 화면을 열 수 있다. `"host-not-allowed"`: 서버는 맞지만 그 Host는 Host 검사에 막힌다. 앱은 "그 서버의 Settings > 주소에서 다른 기기에서 열 주소를 정하세요"를 안내한다 |

- 호스트명·주소·경로·계정 같은 운영자 값은 담지 않는다(ADR 0005). 그래서 정한 주소를 알려 주지 않는다. Host 검사를 받지 않아 DNS 리바인딩으로도 읽힐 수 있기 때문이다.
- 필드를 더하는 것은 하위 호환이다. 앱은 모르는 필드를 무시하고, 위 네 필드를 zod로 파싱한다(`apps/web/src/identity/identity.ts`의 `identitySchema`). 이름을 바꾸거나 빼려면 0046과 함께 바꾼다.

### Host 검사와의 관계 (판단)

Host 검사를 받게 하면 바깥 주소를 정하기 전의 서버는 (b)의 질의에 `403`만 주어 "우리 서버가 아님"과 구별되지 않는다. 운영자는 서버를 찾지 못한 까닭을 모른 채 (a) 주소 입력으로 넘어간다. 그래서 신원 확인 경로만 Host 검사에서 빼고, 대신 `webAccess`로 "찾았지만 이 주소로는 열 수 없음"을 알린다. 상태를 바꾸지 않고 비밀이 아닌 값만 주므로 리바인딩으로 읽혀도 잃는 것은 제품 이름·버전·임의 ID다(research 0013 2.1절에서 이미 받아들인 범위).

## 개발 진입점(0047)

`demo/`의 시드가 두 주소를 가상 값(`https://orchestrator.example.ts.net`, `https://hooks.example.com`)으로 채우고, 「가짜 값 채우기」가 주소 칸도 채운다. `pnpm dev`는 127.0.0.1·localhost·`WEB_HOST`로 열어 Host 검사에 막히지 않는다.

## 완료 조건

- 허용하지 않은 Host는 `403 host-not-allowed`, 허용하지 않은 Origin의 POST는 `403 origin-not-allowed`로 거절하고 로그에 까닭을 남긴다는 시험이 통과한다(`apps/web/src/server/request-guard.test.ts`, 번들한 서버는 `scripts/smoke-web-prod.ts`).
- 허용한 Host·Origin, Origin 없는 webhook, 주소를 잘못 넣어도 127.0.0.1은 통과한다는 시험이 통과한다.
- 신원 확인 경로의 응답 모양 시험과, 번들한 서버가 바깥 Host로 물어도 `200`과 `webAccess: "host-not-allowed"`를 준다는 시험이 통과한다.
- 온보딩 1단계가 설정한 webhook 공개 주소로 webhook 주소를 보이고, 비었으면 그 사실과 정하는 방법을 보인다는 시험이 통과한다.
- 브라우저 e2e와 smoke(`smoke:web`, `smoke:cli`, `smoke:bundle`), demo 시험이 그대로 통과한다.
