# 코딩 표준

리뷰 단계에서 읽는 문서다. 자동 리뷰(`.agents/pr-gates.json`의 독립 리뷰)는 PR을 받은 뒤 diff를 이 규칙과 대조한다.

- 위반은 기본적으로 머지를 막지 않는다. 리뷰어는 규칙 제목을 인용해 "막지 않는 항목"으로 보고한다.
- diff에서 새로 쓰거나 고친 줄에만 적용한다. 손대지 않은 기존 코드를 고치라고 하지 않는다. 파일을 옮기거나 이름만 바꿔 추가된 줄로 보이는 것은 기존 코드로 본다.
- 규칙을 더하는 조건: lint·format·typecheck가 잡지 못하고, 리뷰 지적이나 CI 실패로 두 번 이상 드러났고, diff와 저장소 검색만으로 판정할 수 있다.
- 처음 규칙은 아직 리뷰 이력이 없어 이 저장소의 결정(ADR, `docs/research/`)에서 근거가 분명한 것만 두었다.
- lint 규칙으로 옮길 수 있게 되면 옮기고 여기서 지운다.
- `AGENTS.md`에 있는 작업 규칙은 여기에 다시 적지 않는다.

예시의 이름은 설명용이다.

## ID는 branded type으로 쓴다

티켓 키, 러너 ID, 러너 쪽 프로젝트 ID, 워크트리 참조처럼 뜻이 다른 문자열 ID는 각자 branded type으로 둔다. 맨 `string`으로 주고받지 않는다.

```ts
// 피한다
function startRun(runner: string, project: string, ticket: string) {}

// 이렇게 쓴다
type Brand<T, B extends string> = T & { readonly __brand: B };
type TicketKey = Brand<string, "TicketKey">;
type RunnerId = Brand<string, "RunnerId">;
type RunnerProjectId = Brand<string, "RunnerProjectId">;

function startRun(runner: RunnerId, project: RunnerProjectId, ticket: TicketKey) {}
```

이유: 모두 `string`이면 인자 순서를 바꿔 넘겨도 typecheck가 통과한다.

근거: `docs/research/0002-external-contracts.md` 「어댑터 인터페이스 초안」

## 외부 열거값은 모르는 값이 와도 깨지지 않게 둔다

Orca와 Linear가 주는 상태·종류 값은 관측한 값만으로 닫힌 유니온을 만들지 않는다. 모르는 값을 받는 자리를 타입에 열어 두고, 처리할 때는 모르는 값을 안전한 쪽(예: 런은 "진행 중")으로 보낸다.

```ts
// 피한다: 문서에 없던 값이 오면 파싱이 실패하거나 분기에서 빠진다
type TrackerStateType = "backlog" | "started" | "completed";

// 이렇게 쓴다
type TrackerStateType = "backlog" | "started" | "completed" | (string & {});
```

이유: 외부 시스템은 예고 없이 값을 더한다. Orca `worktree ps`의 상태 값은 전체 열거가 문서·스키마에 없다.

근거: `docs/research/0002-external-contracts.md` A.6(관측한 값만으로 상태 기계를 닫지 않는다), 「어댑터 인터페이스 초안」

## 요약 결과는 계산 함수 하나로만 정한다

런이 끝날 때 기록한 두 축(에이전트 결과, PR 상태)에서 요약 결과(Merged·Human Check·Failed)와 워크트리를 남길지를 정하는 일은 순수 함수 하나가 맡는다. 다른 곳에서 두 축을 직접 보고 요약 결과를 정하지 않는다. 요약 결과는 저장하지 않고 필요할 때 이 함수로 계산한다.

```ts
// 피한다: 화면·통계·폴러가 각자 두 축을 해석한다
const outcome = run.prState === "merged" ? "merged" : "human-check";

// 이렇게 쓴다
const { outcome } = summarizeRunOutcome(run.agentResult, run.prState);
```

이유: 요약 계산 표(스펙 4.2)가 여러 곳에 흩어지면 한쪽만 바뀌어 통계와 화면이 어긋난다.

근거: ADR 0004, `docs/spec/0001-phase-1.md` 4.2

## ssh로 보내는 명령은 인자 배열로 만들고 한 곳에서 이스케이프한다

러너에 보낼 명령은 인자 배열로 만들고, 원격 셸에 넘길 문자열로 바꾸는 일은 이스케이프 함수 하나가 맡는다. 티켓 제목·본문 같은 값을 셸 문자열에 이어 붙이지 않는다.

```ts
// 피한다
await ssh(target, `orca worktree create --prompt "${ticket.body}"`);

// 이렇게 쓴다
await ssh(target, ["orca", "worktree", "create", "--prompt", ticket.body]);
```

이유: 원격 명령 문자열은 원격 셸이 한 번 더 해석한다. 티켓 본문의 따옴표·백틱·줄바꿈이 명령을 깨거나 원격에서 실행된다.

근거: `docs/research/0002-external-contracts.md` A.5(`--prompt` 이스케이프), A.8(인자 전달)
