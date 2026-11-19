# 웹은 TanStack Start, 상시 작업은 별도 worker 데몬

오케스트레이터는 운영자의 상시 머신 한 대에서 돈다(설치 하나당 운영자 한 명, ADR 0005). 화면과 server function, Linear webhook 수신은 `apps/web`(TanStack Start)이 맡고, 할당 큐·ssh로 러너(Orca)에 명령하기·런과 PR 상태 폴링은 `apps/worker` 데몬이 맡는다. 두 프로세스는 SQLite(WAL) 파일 하나를 공유한다. 계속 도는 작업은 웹 요청 수명과 맞지 않아 분리했고, 별도 API 서버(Hono)는 Start의 server function과 겹쳐 두지 않았다.

web이 DB에 쓴 일을 worker가 빨리 처리하도록 web은 쓰기가 끝난 뒤 worker에 내용 없는 "깨어나" 신호를 보낸다(티켓 0058). 기준은 여전히 DB다. worker는 신호에서 아무것도 꺼내지 않고 지금처럼 DB를 읽어 바퀴 전체를 돈다. 신호는 잃어도 되는 힌트다. worker가 재시작 중이거나 web과 worker를 `start` 없이 따로 띄워 신호가 닿지 않아도 다음 폴링이 처리하므로 정확성은 바뀌지 않고 반응 속도만 바뀐다. 그래서 폴링은 그대로 둔다. 러너 쪽 감지는 ssh로 물어야 알 수 있어 계속 폴링이 맡는다. 신호는 `start`가 web과 worker 사이에 둔 IPC 통로로 중계하고, 2xx로 응답한 POST 요청만 보낸다. 신호를 떼어 내도 동작이 그대로라 새 ADR로 두지 않았다.

## Considered Options

- **React Server Components**: 운영자 한 사람이 보는 대시보드라 SEO·첫 화면 최적화 이득이 작고, StyleX·UI SDK와의 경계만 복잡해져 쓰지 않는다.
- **러너 쪽 콜백**: 러너에 따로 설치할 것이 없도록 ssh 폴링을 택했다.
