# 렉처북 디자인 방향

## 현재 기준: v0.9

코드 기준본은 `site/styles.css` 한 장이다. 예전 테마 네 겹(`refresh.css` 포함)을 결과가 같은 한 장으로 합쳤다.
홈은 소개보다 업로드를 우선해 두 칼럼으로 배치하고, 모바일에서는 소개 → 업로드 → 오늘 할 일로 읽힌다.
색은 Ink `#191D2B`, Action `#4755D7`, Soft Lavender `#EAE8F6`, Coral `#E97759`, Canvas `#F6F5F2`로 제한한다.
애니메이션은 누름·호버 등 직접 조작에만 짧게 사용한다. 무한 장식 애니메이션과 스크롤 진입 시 콘텐츠 숨김은 사용하지 않는다.
Adobe Fonts 연결은 한글 추천 결과가 없어 사용하지 않았고, 성능과 오프라인 동작을 위해 시스템 글꼴을 유지했다.
Figma 파일은 이전 시안 기록이며, 현재 구현 기준본은 이 폴더의 HTML/CSS다.

## 이전 v0.6 방향 기록

## 한 문장

자료를 올리고, 다음에 할 공부를 바로 찾는 학습 작업 화면.

## 시스템

| 역할 | 값 |
|---|---|
| 기반 | Deep Navy `#0B1020` |
| 주요 행동 | Electric Blue `#315EFB` |
| 긴급·강조 | Coral `#FF5D4A` |
| 연결·성공 | Aqua `#53D8D0` |
| 바탕 | Warm White `#F5F4F1` |

- 본문은 시스템 산세리프, 식별자와 단계 번호는 모노스페이스를 쓴다.
- 중요한 행동은 파랑, 시간 압박과 시각적 마침표는 코랄, 연결 상태는 아쿠아로 역할을 고정한다.
- 애니메이션은 상태 변화와 이동 방향을 설명할 때만 쓰고, OS의 `동작 줄이기`를 따른다.

## 제품 레퍼런스에서 가져온 원칙

- Linear: 탐색 요소는 뒤로 물리고 현재 작업을 가장 선명하게 보이게 한다. 이를 상단의 짙은 앱 바와 큰 중앙 학습 루프로 적용했다.
- Quizlet: 같은 학습 자료가 여러 학습 모드로 자연스럽게 이어져야 한다. 이를 `자료 → 핵심 → 연습 → 책` 네 단계로 적용했다.
- Notion: 흩어진 상태를 한 화면에서 읽고 바로 행동할 수 있어야 한다. 과목별 수치를 홈의 학습 루프에 집계했다.
- Perplexity: 결과가 아니라 근거로 돌아갈 수 있어야 한다. 기존 페이지 근거 칩을 시각 체계 안에 유지했다.

참고: https://linear.app/now/behind-the-latest-design-refresh

참고: https://quizlet.com/en/features/flashcards

참고: https://www.notion.com/en-gb/help/dashboards?nxtPslug=dashboards
참고: https://www.perplexity.ai/hub

## Figma

- 파일: https://www.figma.com/design/uoncl4zhcKN1N1G59G5rp5
- 연결 라이브러리: Material 3, Simple Design System
- 확인한 컴포넌트: Button, Input Field, Card
- 당시 Starter 플랜 MCP 호출 한도에 도달해 캔버스 자동 작성은 중단됐다. 현재 구현된 HTML/CSS가 최신 기준본이다.
