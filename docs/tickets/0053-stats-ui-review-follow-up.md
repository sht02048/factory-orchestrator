---
status: done
blocked_by: []
---

# 0053 Stats UI 리뷰 후속

## 목표

날짜별 처리량을 마우스 없이도 읽을 수 있게 하고, 좁은 폭에서 Stats가 무너지지 않게 한다.

## 배경

UI 리뷰 판정은 Blocked였다. 날짜별 숫자를 마우스 hover로만 볼 수 있다.

## 범위

### 반드시(Blocking)

1. **차트 값 접근성.** `throughput-chart.tsx`는 `<svg role="img" aria-label>` 안에 날짜마다 `<title>`을 둔다. `role="img"`라 자식이 접근성 트리에서 빠지고, `<title>`은 마우스 기본 툴팁으로만 보인다. 날짜별 값은 다른 곳에 글로 없다. 같은 `daily` 데이터로 화면 밖 표(날짜, Merged, Human Check, Failed, Canceled)를 두어 차트와 잇고, 키보드·터치로 날짜별 값을 볼 길(표로 보기, 또는 날짜 묶음에 포커스와 공용 `Tooltip`)을 둔다.

### 고칠 것(Should fix)

2. **차트 글자 크기.** `viewBox` 폭 720에 `width: 100%`라 축 글자(11px)가 화면 폭에 비례해 줄어든다(목록 폭 436px에서 약 6.7px). 축 라벨을 SVG 밖 HTML로 빼거나 실제 폭으로 viewBox를 맞춘다.
3. **요약 칸.** `stats-screen.tsx`의 `gridTemplateColumns: "repeat(5, minmax(0, 1fr))"`가 좁은 폭에서 접히지 않는다. `repeat(auto-fit, minmax(140px, 1fr))`처럼 접히게 한다.
4. **범례 줄바꿈.** `legend: { display: "inline-flex" }`에 `flexWrap`이 없다.
5. **Failed와 Canceled 구분.** `problem`(L 0.7)과 `idle`(L 0.72)의 밝기 차이가 0.02라 색각이상이면 구분이 어렵다. 토큰 색은 두고 Canceled 조각과 범례 견본에 빗금 패턴을 넣는다.
6. **용어.** `messages/ko/stats.json`의 `day` 툴팁이 `취소 {canceled}`라 다른 상태 이름(영어 용어)과 어긋난다(ADR 0010 1번). `Canceled {canceled}`로 바꾼다.

### 하면 좋은 것(Nits)

- 조각 높이 `Math.max(0, h - 1)`이 큰 값에서 1런 조각을 0px로 만든다. 최소 높이를 둔다.
- 14일 내내 0이면 빈 격자만 보인다. 묶음 표처럼 빈 상태 문구를 보이거나 차트를 숨긴다.
- `stats-screen.tsx`의 열 수 주석(6개)을 실제(7개)와 맞춘다.

## 완료 조건

- 날짜별 값이 접근성 트리에 표로 있다는 시험.
- 키보드로 날짜별 값을 볼 수 있다는 브라우저 시험.
- 좁은 폭(목록 폭 약 440px) 스크린숏을 PR에 붙인다.
