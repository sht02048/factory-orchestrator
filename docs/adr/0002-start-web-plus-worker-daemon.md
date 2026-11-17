# 웹은 TanStack Start, 상시 작업은 별도 worker 데몬

오케스트레이터는 운영자의 상시 머신 한 대에서 돈다(설치 하나당 운영자 한 명, ADR 0005). 화면과 server function, Linear webhook 수신은 `apps/web`(TanStack Start)이 맡고, 할당 큐·ssh로 러너(Orca)에 명령하기·런과 PR 상태 폴링은 `apps/worker` 데몬이 맡는다. 두 프로세스는 SQLite(WAL) 파일 하나를 공유한다. 계속 도는 작업은 웹 요청 수명과 맞지 않아 분리했고, 별도 API 서버(Hono)는 Start의 server function과 겹쳐 두지 않았다.

## Considered Options

- **React Server Components**: 운영자 한 사람이 보는 대시보드라 SEO·첫 화면 최적화 이득이 작고, StyleX·UI SDK와의 경계만 복잡해져 쓰지 않는다.
- **러너 쪽 콜백**: 러너에 따로 설치할 것이 없도록 ssh 폴링을 택했다.
