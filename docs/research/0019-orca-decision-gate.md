# 0019 Orca `decision_gate` 보내고 받기

티켓 [0148](../tickets/0148-human-check-request.md)의 스파이크다. 에이전트가 Human Check를 `decision_gate`로 보낼 때 Orca가 무엇을 저장하고, 답이 어떻게 돌아오며, 답을 기다리는 동안 에이전트가 무엇을 해야 하는지 확인했다.

## 확인한 환경

2026-11-21, Orca CLI 1.4.253. 실제 코디네이터와 워커 사이에서 시험 메시지 두 개를 보냈다. 아래 값의 ID는 자리표시자다.

## 보내기

```sh
orca orchestration send --type decision_gate --subject "<무엇을 확인할지>" --body "<내용과 링크>"
```

```json
{
  "id": "msg_example",
  "to_handle": "run:run_example",
  "subject": "PR #1 머지를 확인해 주세요",
  "body": "https://github.com/acme/widgets/pull/1",
  "type": "decision_gate",
  "thread_id": null,
  "payload": "{\"dispatchId\":\"ctx_example\"}",
  "created_at": "2026-11-21T01:28:02Z"
}
```

- 워커가 `--dispatch-id`를 넘기지 않아도 Orca가 payload에 `dispatchId`를 채운다. `taskId`는 `--task-id`를 넘겼을 때만 들어간다. Ganger는 `dispatchId`로 메일을 런에 잇는다.
- payload는 JSON 문자열이다. 기존 `mailPayloadSchema`로 읽는다.

## 답

코디네이터가 `orca orchestration reply --id <메시지 id> --body <답>`을 부르면 워커의 메일함에 온다.

```json
{
  "id": "msg_reply_example",
  "to_handle": "dispatch:ctx_example",
  "subject": "Re: PR #1 머지를 확인해 주세요",
  "body": "확인했어요",
  "type": "status",
  "thread_id": "msg_example",
  "payload": null
}
```

## 기다리기

- **차례를 끝내면 답이 와도 깨어나지 않는다.** 첫 시험에서 워커가 `decision_gate`를 보내고 차례를 끝내자 Orca가 코디네이터에게 "Worker stopped without reporting" escalation을 보냈고, 답은 다음 배정 때에야 읽혔다. `ask`는 Orca가 답으로 깨우지만 `send`는 그렇지 않다.
- **`orca orchestration check --wait`로 차례를 끝내지 않고 기다리면 답을 받는다.** 둘째 시험에서 워커가 보낸 뒤 `check --wait --timeout-ms 420000`을 돌렸고, 코디네이터의 reply가 약 6초 뒤 그 명령의 출력으로 왔다.
- 시간이 지나면 출력의 `timedOut`이 참이다. 이 경우는 이번에 돌려 보지 않았고 CLI 도움말로만 확인했다. 통신 규약은 같은 명령을 다시 돌리게 한다.

## 결정

- 통신 규약은 `send --type decision_gate`로 보낸 뒤 `check --wait`로 기다리게 한다. ID 인자는 넣지 않는다.
- `gate-create`는 쓰지 않는다. 태스크를 막는 별도 기록이고 ADR 0023이 정한 메시지 종류가 아니다.
- 답은 질문과 같은 `reply` 경로로 보낸다. 러너 어댑터에 새 명령을 더하지 않는다.
- 에이전트가 규약을 어기고 차례를 끝낸 채(`turn-ended`, `interrupted`) 답을 받으면, worker가 `reply` 뒤에 재개와 같은 터미널 입력으로 답을 한 번 더 넣어 깨운다. 깨우지 못하면 답을 보낸 것으로 적지 않아 런은 Waiting for Input에 남고 다음 차례에 다시 깨운다.

## 남은 위험

터미널 입력으로 깨우는 경로는 가짜 러너 시험으로만 확인했고 실제 Orca 에이전트에서는 돌려 보지 않았다.
