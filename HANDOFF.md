# HANDOFF

## 현재
- 렉처북 v0.9. 기존 기능 전체 + 화면 개편 + 한 폴더 자동 빌드/새로고침
- 기준 작업 폴더: `C:\Users\User\Desktop\lecturebook`. `site/`를 수정하고 `node tools/dev.js`로 같은 `dist/`에 자동 반영한다. 새 버전 폴더를 만들지 않는다.
- Render 배포: https://lecturebook-2i3u.onrender.com (`render.yaml`, GitHub `junseoi328/lecturebook`의 main에 푸시하면 자동 배포)
- 공개 링크: https://claude.ai/artifact/2a7Z8hoRuAES5LqWXEUSF4 (같은 링크로 업데이트)
- 무료 공급자: Gemini, Groq, OpenRouter 무료 모델, Mistral, Cerebras, SambaNova, 로컬 Ollama. Claude 아티팩트에서는 내장 AI 사용. 작업별 역할 배정 후 최대 5회 실패 전환
- 보안: 외부 API 키는 모듈 메모리에만 저장하며 IndexedDB·localStorage·백업에 포함하지 않음
- 검증: AI·공급자·학습·성능·개발 서버 테스트 통과. 브라우저에서 설정·질문 흐름과 320/390/1440px 화면, 다크 모드, 콘솔 오류를 확인. 실제 외부 공급자는 키 없이 검증하지 못함
- 성능: 실행본 약 190KB(250KB 예산 안). PDF 생성기·번역 엔진·폰트는 쓸 때만 불러온다. 무한 장식 애니메이션·포인터별 히어로 갱신·스크롤 숨김 효과를 제거. 로컬 수치는 PERFORMANCE.md 참고
- Figma: 이전 디자인 파일의 Page 1은 현재 비어 있다. Adobe Fonts 한글 추천 결과도 없어 코드와 시스템 글꼴을 기준본으로 유지 (`DESIGN.md`)
- 미검증: 실제 외부 무료 모델 호출(키 없음), Safari·모바일 실기기, 큰 PDF 속도

- 번역 PDF: 처음 화면의 "번역 PDF 만들기" 카드(`site/translate.js` + `site/app.js`의 translateCard). 영어 PDF의 쪽을 그림으로 그린 뒤 영어 문단 자리를 배경색으로 덮고 한국어를 쓴다. 첨자는 `V_{G}` 표기로 AI에 넘겼다가 다시 작게 그리고, 수식 글꼴로 쓴 줄과 낱말 없는 줄(수식·단위·기호)은 번역하지 않고 원본 그대로 둔다. 따로 찍힌 글머리표도 원본 그대로 둔다. 요청이 실패하면 12→30→60초 기다렸다 다시 보내고, 한도가 바닥나면 받은 데까지 보여 주고 "남은 곳 다시 번역"으로 이어서 한다. 넘치면 문장 줄이기 → 글자 축소(하한 70%). 결과 PDF의 글자는 그림이라 선택·검색이 안 되고, 스캔본·사진 속 글자·회전된 글자는 바뀌지 않는다. 번역 문체는 전자공학·컴퓨터공학 강의자료에 맞췄다: 문체 지침과 예시, 전공 용어집 399개(묶음에 나온 말만 골라 붙임), 항목 종류(제목·라벨·본문), 앞 묶음에서 옮긴 말을 다음 묶음에 넘겨 용어를 통일한다(`buildPrompt`, `glossaryFor`). 용어를 바꾸려면 `site/translate.js`의 GLOSSARY에서 한 줄을 고친다. 가짜 AI와 직접 만든 견본 PDF(reportlab·LibreOffice 내보내기)로만 검증했고, 번역이 실제로 얼마나 자연스러워졌는지는 실제 모델로 확인하지 못했다. 실제 공급자 호출과 PowerPoint 수식(Cambria Math)이 든 실제 강의 PDF는 미검증
- 화면: 스타일은 `site/styles.css` 한 장. 320~1440px·밝은/어두운 테마에서 과목 화면 히어로 겹침, 족보 배너 색, 시험 일정 칸 겹침, `<details>` 안쪽 넘침을 고쳤다

## 데이터 (IndexedDB, 키-값)
- courses: 과목 목록 / course:<id>: 과목(lectures, jokbos, exam 형식, exams 일정, reviewed 복습)
- item:<id>: 강의(pages, summary) 또는 족보(pages, analysis)
- quiz:<courseId>: 마지막으로 만든 문제 / attempts:<courseId>: 누적 풀이와 오답 노트
- v0.1 과목은 열 때 자동으로 새 항목(exams, reviewed)이 채워짐

## 다음
1. 로컬 작업은 `node tools/dev.js`로 계속한다. Claude 아티팩트나 일반 웹 배포는 별도 요청 시 진행한다. 일반 웹 호스팅에는 `dist/` 전체를 배포
2. 무료 키 하나씩 실제 호출 → 공급자 CORS, JSON 형식, 품질과 한도 기록
3. 실제 강의자료로 역할 배정과 실패 전환 확인 후 프롬프트 조정 (`site/ai.js`)
4. 친구 테스트
