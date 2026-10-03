# HANDOFF

## 현재
- 렉처북 v0.9. 기존 기능 전체 + 화면 개편 + 한 폴더 자동 빌드/새로고침
- 기준 작업 폴더: `C:\Users\User\Desktop\lecturebook`. `site/`를 수정하고 `node tools/dev.js`로 같은 `dist/`에 자동 반영한다. 새 버전 폴더를 만들지 않는다.
- 공개 링크: https://claude.ai/artifact/2a7Z8hoRuAES5LqWXEUSF4 (같은 링크로 업데이트)
- 무료 공급자: Gemini, Groq, OpenRouter 무료 모델, Mistral, Cerebras, SambaNova, 로컬 Ollama. Claude 아티팩트에서는 내장 AI 사용. 작업별 역할 배정 후 최대 5회 실패 전환
- 보안: 외부 API 키는 모듈 메모리에만 저장하며 IndexedDB·localStorage·백업에 포함하지 않음
- 검증: AI·공급자·학습·성능·개발 서버 테스트 통과. 브라우저에서 설정·질문 흐름과 320/390/1440px 화면, 다크 모드, 콘솔 오류를 확인. 실제 외부 공급자는 키 없이 검증하지 못함
- 성능: 이번 실행본 약 211KB(250KB 예산 안). 무한 장식 애니메이션·포인터별 히어로 갱신·스크롤 숨김 효과를 제거. 로컬 수치는 PERFORMANCE.md 참고
- Figma: 이전 디자인 파일의 Page 1은 현재 비어 있다. Adobe Fonts 한글 추천 결과도 없어 코드와 시스템 글꼴을 기준본으로 유지 (`DESIGN.md`)
- 미검증: 실제 외부 무료 모델 호출(키 없음), Safari·모바일 실기기, 큰 PDF 속도, 기존 Python e2e.py(실행 환경에 Playwright 모듈 없음)

## 데이터 (IndexedDB, 키-값)
- courses: 과목 목록 / course:<id>: 과목(lectures, jokbos, exam 형식, exams 일정, reviewed 복습)
- item:<id>: 강의(pages, summary) 또는 족보(pages, analysis)
- quiz:<courseId>: 마지막으로 만든 문제 / attempts:<courseId>: 누적 풀이와 오답 노트
- v0.1 과목은 열 때 자동으로 새 항목(exams, reviewed)이 채워짐

## 다음
1. 로컬 작업은 `node tools/dev.js`로 계속한다. Claude 아티팩트나 일반 웹 배포는 별도 요청 시 진행한다. 일반 웹 호스팅에는 `dist/index.html`과 `dist/font.js`를 함께 배포
2. 무료 키 하나씩 실제 호출 → 공급자 CORS, JSON 형식, 품질과 한도 기록
3. 실제 강의자료로 역할 배정과 실패 전환 확인 후 프롬프트 조정 (`site/ai.js`)
4. 친구 테스트
