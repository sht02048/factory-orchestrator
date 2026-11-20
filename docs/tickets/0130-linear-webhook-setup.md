---
status: done
blocked_by: []
---

# 0130 Linear webhook 켜기를 트래커 연결 상세 한 곳에서

## 목표

트래커 연결 상세(`/settings/connections/$connectionId`)의 Webhook 구역 한 곳에서 webhook을 켠다. Linear가 이 서버에 닿을 주소를 만들고 확인하고, Linear에 webhook을 만들고, signing secret을 넣는 세 단계를 차례로 보이고, 켠 뒤에는 실제로 받는지 보인다.

## 배경

운영자 보고(2026-11-20): webhook을 켜려면 Settings › 고급(Webhook 공개 주소)과 Settings › 연결 › Linear "관리"(Webhook 경로, signing secret)를 오가며 주소를 손으로 이어 붙여야 했다. "공개 주소"라는 말을 이해하기 어렵고, 그 주소를 만드는 방법은 앱·README 어디에도 없었다(예시 이름 Tailscale Funnel·Cloudflare Tunnel만 있었다). 켠 뒤 실제로 오는지 알 길도 없었다(서명 실패는 서버 로그에만).

운영자가 시안 "Ganger Linear Webhook" 보드 다섯 장(켜기 전 세 단계, 주소 만들기와 확인 실패, 켠 직후 기다림, Settings 연결 줄의 상태와 서명 실패, 400px)을 승인했다. 시안 뒤에 더 승인한 것: ①에 처음 허용 안내 한 줄과 링크, 이 맥에 Tailscale이 있으면 주소를 미리 채우기, 확인 실패 이유 나눠 보이기.

## 흐름

1. **Linear가 이 서버에 닿을 주소**(예전 "Webhook 공개 주소"). Tailscale이 있으면 "Tailscale Funnel로 열기"(처음 허용 안내+링크, 포트·경로를 채운 명령과 복사, "명령이 끝나면 확인하기를 눌러요"). 주소 입력(미리 채움)+확인하기. 다른 방법은 Cloudflare Tunnel 공식 문서로 가는 바깥 링크 하나와 리버스 프록시 ⓘ 툴팁 한 줄(웹 앱은 공개 저장소 주소를 몰라 README로 보내지 않는다, 코디네이터 결정 2026-11-20). 자세한 단계는 README `Turn on the webhook` 절. 확인에 성공해야 저장하고 ✓"닿는 걸 확인했어요". 서버에 하나라 모든 트래커 연결이 같이 쓴다. Settings › 고급의 줄은 뺀다.
2. **Linear에서 webhook 만들기**: 완성한 주소(닿을 주소+이 연결의 경로)와 복사, "Data change events에서 Issues만 골라요", Linear webhook 설정 링크(조직 urlKey를 알면 그 조직, 모르면 `https://linear.app/settings/api`). 1이 끝나기 전에는 잠근다.
3. **signing secret 넣고 켜기**. 켜면 "켰어요 · 첫 webhook을 기다려요". 기다리는 동안 3초마다 수신 상태만 묻고(15분까지), 바뀌면 지금 router 로더를 다시 읽어 그 자리에서 바뀐다.

- 켜진 뒤: 마지막으로 받은 때, 서명이 맞지 않아 받지 못한 수와 처음 실패 시각(마지막 성공 뒤), secret 다시 넣기, 주소 복사, 끄기(확인 창, secret을 지우고 폴링으로).
- Settings 연결 줄은 상세로 가는 링크 줄이고 둘째 글줄이 "webhook으로 바로 받아요 · 마지막으로 받은 때 …" / "webhook 서명이 맞지 않아 받지 못해요 · …부터"(문제, 목차 점) / "webhook을 켰어요 · 첫 webhook을 기다려요" / "1분마다 읽어요 · webhook 켜기"다.

## Tailscale 확인(2026-11-20, 이 맥 Tailscale 1.104.4, 읽기 명령과 `--help`만)

- `tailscale funnel --help`: 옵션 `--bg`, `--https <port>`, `--set-path <path>`, `--tcp`, `--tls-terminated-tcp`, `--proxy-protocol`, `--yes`. 하위 명령 `status [--json]`, `reset`. 대상은 포트, `localhost:3000`, `http://localhost:3000/foo` 같은 경로 붙은 URL을 받는다. `serve --help`도 같은 `--https`·`--set-path`·`--bg`를 쓴다.
- Funnel은 경로가 아니라 **포트 단위로** 공개한다: "If the most recent command to configure the port was `funnel`, then the port will be completely public." "If the most recent command to configure the port was `serve`, then the port will be completely private." 같은 포트를 Serve와 Funnel이 함께 쓸 수 없다([Funnel](https://tailscale.com/kb/1223/funnel)). 그래서 Serve로 Ganger 화면을 443에 연 설치에서 443에 funnel을 걸면 화면 전체가 공개된다.
- Funnel이 듣는 포트는 443, 8443, 10000뿐이다([Funnel](https://tailscale.com/kb/1223/funnel), [`tailscale funnel`](https://tailscale.com/kb/1311/tailscale-funnel)).
- 처음 허용: Tailscale v1.38.3 이상, MagicDNS, HTTPS 인증서, 정책 파일의 `funnel` 노드 속성. 명령을 처음 돌리면 관리 화면에서 Funnel을 허용하라는 웹 화면이 뜨고, 허용하면 인증서와 노드 속성을 더한다. 새 이름의 공개 DNS는 퍼지는 데 10분까지 걸린다([Funnel](https://tailscale.com/kb/1223/funnel)). 이 맥의 `status --json` `Self.CapMap`에는 `https`가 있고 `funnel`은 없었다(아직 허용 전).
- `--bg`는 재부팅·`tailscale down/up` 뒤에도 유지한다. 끄려면 켠 명령 끝에 `off`를 붙인다(원래 플래그 모두 필요) 또는 `tailscale funnel reset`([`tailscale funnel`](https://tailscale.com/kb/1311/tailscale-funnel)). `--set-path` 뜻은 "Appends the specified path to the base URL for accessing the underlying service"이고 대상 경로와 합치는 규칙은 문서에 없다. 프록시 대상은 `http://127.0.0.1`만 지원한다고 적혀 있다.
- `tailscale status --json`: 최상위 `BackendState`(`Running`), `Self`, `Peer`, `MagicDNSSuffix`, `CertDomains`. 이 기기 이름은 `Self.DNSName`이고 끝에 점이 붙는다(`<기기>.<tailnet>.ts.net.`).
- 정한 명령: `tailscale funnel --bg --https=8443 --set-path /api/webhooks/ http://127.0.0.1:<port>/api/webhooks/`. 8443에는 webhook 경로만 매핑해 그 밖의 경로는 닿지 않고, 443의 Serve(화면)는 tailnet 안에 남는다. 실제로 Funnel을 켜 보지는 않았다(운영 중인 설정을 바꾸지 않음).
- 데스크톱 앱(0046 "다른 서버에 붙기")이 이미 `status --json`을 읽고 있어 그 모듈을 `packages/app/src/tailscale.ts`로 옮겨 함께 쓰고 `Self.DNSName`을 더 읽는다. 시간 제한 3초, 없거나 못 읽으면 조용히 빈 값.

## 확인하기

- 서버가 `<주소>/api/webhooks/ping/<설치 ID>`에 GET을 보낸다. 이 경로는 묻는 설치 ID가 같으면 200 `{product:"ganger",match:true}`, 다르면 404이고 설치 ID를 돌려주지 않는다. webhook 경로 아래라 터널이 webhook 경로만 열어도 닿는다. 아직 저장하지 않은 주소로 묻기 때문에 이 GET은 신원 확인 경로처럼 Host 검사를 받지 않는다. 닿을 주소 호스트로는 webhook 경로만 받는 규칙은 그대로다(시험).
- SSRF 막기: https만, 사용자 정보·경로·쿼리·조각 없는 origin만, IP 리터럴·`localhost`·`*.localhost`·`.local`·`.internal`·점 없는 이름은 묻지 않고 거절, 리다이렉트를 따라가지 않음(3xx는 다른 서버), 응답 1KB 넘으면 읽기를 멈춤, 8초 시간 제한, 응답 본문을 화면에 돌려주지 않음.
- 실패 이유: 이름을 찾지 못함(`ENOTFOUND`·`EAI_AGAIN`), 닿지 못함(연결 거부·끊김·시간 초과), 다른 서버가 답함(200이 아니거나 Ganger 답이 아니거나 다른 설치), 그 밖(인증서 오류 등), 주소 형식 오류.
- 남은 한계: 확인은 서버 자신이 보내 tailnet으로 닿으므로 인터넷에서 닿는지까지는 증명하지 않는다(`serve --https=8443`도 통과). README에 `tailscale funnel status`로 확인하라고 적었다.

## 수신 기록(one-way 마이그레이션)

- 표 `tracker_webhook_receipts`(연결 ID PK, 연결을 지우면 같이 지움): `last_received_at`, `rejected_count`, `first_rejected_at`. 0122의 `tracker_read_generations`(트래커 읽기 다시 하기)와 다른 이름·뜻이다.
- `apps/web/src/webhooks/receive.ts`가 서명이 맞으면 받은 때를 남기고 실패 수를 지우며, `bad-signature`면 수를 하나 올리고 처음 실패 시각을 지킨다. 다른 거절 이유(오래된 타임스탬프 등)는 기록하지 않는다.
- 새 signing secret을 저장하거나 끄면 그 연결의 기록을 지워 다시 기다림에서 시작한다.
- 되돌리는 법: 이 마이그레이션 앞 커밋으로 앱을 되돌리고 `DROP TABLE tracker_webhook_receipts;` 와 drizzle 마이그레이션 기록(`__drizzle_migrations`)에서 `20261120003446_tracker_webhook_receipts` 줄을 지운다. 표만 있고 앞 코드가 읽지 않으므로 지우지 않아도 앞 버전은 돈다.

## 고칠 파일

- `packages/db`(`schema.ts`, `webhook-receipts.ts`, 마이그레이션), `packages/core`(`TrackerConnectionCheck.webhookSettingsUrl`), `packages/tracker-linear`(조직 `urlKey`)
- `packages/app`(`tailscale.ts` 옮김, `webhook-address.ts`, `request-guard.ts`, `settings/*`)
- `apps/web`: `webhooks/receive.ts`, `routes/api/webhooks/ping/$instanceId.ts`, `routes/_app/settings_.connections.$connectionId.tsx`, `server/settings-functions.ts`, `server/webhook-reach.ts`, `settings/*`, `messages/ko/settings.json`·`onboarding.json`·`ds.json`, `ds/block-preview.tsx`
- `apps/desktop`(Tailscale 모듈 import), `demo`(가짜 Tailscale·확인, 수신 기록 시드), `e2e/src/settings*.ts`
- `packages/ui`(`SettingsSteps`·`SettingsStep`, `SettingsSection detail`), `DESIGN.md`
- GLOSSARY, README

## 완료 조건

- 시험: 확인하기 성공·실패 이유별(가짜 서버), SSRF 막기, Tailscale 있음·없음·이상한 출력, 수신 기록(성공·서명 실패·성공 뒤 초기화), 단계 잠김·풀림, 켜기·끄기, Settings 연결 줄 세 상태와 목차 점, 고급에서 빠진 줄, 400px, e2e(가짜 어댑터로 webhook 받기 → 기다림이 켜짐으로).
- 스크린숏: 켜기 전 ①(Tailscale 있음, 확인 실패), ② 열린 상태, 켠 직후 기다림, 켜짐(마지막으로 받은 때), 서명 실패, Settings 연결 줄, 400px.
- `better-interface` 리뷰(1728·1280·1100·800·400px)의 HIGH·MEDIUM을 고치고, `interface-review`로 Introduced·Regression이 0인지 확인한다.
