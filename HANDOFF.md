# HANDOFF

## 현재
- 렉처북 v0.8. v0.7 기능 전체 + 7곳 무료 공급자 설정·개별 연결 확인 + 강의 질문
- 공개 링크: https://claude.ai/artifact/2a7Z8hoRuAES5LqWXEUSF4 (같은 링크로 업데이트)
- 무료 공급자: Gemini, Groq, OpenRouter 무료 모델, Mistral, Cerebras, SambaNova, 로컬 Ollama. Claude 아티팩트에서는 내장 AI 사용. 작업별 역할 배정 후 최대 5회 실패 전환
- 보안: 외부 API 키는 모듈 메모리에만 저장하며 IndexedDB·localStorage·백업에 포함하지 않음
- 검증: ai.test.js 16개, providers.test.js 5개, study.test.js, perf.test.js 통과. 브라우저 스모크 테스트로 설정·연결 확인·강의 질문·390px 화면을 확인. 실제 외부 공급자는 키 없이 검증하지 못함
- 성능: 이번 실행본 약 203KB(250KB 예산 안). 설정 화면을 열 때 모델 목록 네트워크 요청을 제거. 기존 로컬 측정은 PERFORMANCE.md 참고
- Figma: `Lecturebook — Dynamic Study OS v0.6` 파일 생성. Starter 플랜 MCP 호출 한도 때문에 캔버스 자동 작성은 완료하지 못했고 코드 디자인을 기준본으로 유지 (`DESIGN.md`)
- 미검증: 실제 외부 무료 모델 호출(키 없음), Safari·모바일 실기기, 큰 PDF 속도, 기존 Python e2e.py(실행 환경에 Playwright 모듈 없음)

## 데이터 (IndexedDB, 키-값)
- courses: 과목 목록 / course:<id>: 과목(lectures, jokbos, exam 형식, exams 일정, reviewed 복습)
- item:<id>: 강의(pages, summary) 또는 족보(pages, analysis)
- quiz:<courseId>: 마지막으로 만든 문제 / attempts:<courseId>: 누적 풀이와 오답 노트
- v0.1 과목은 열 때 자동으로 새 항목(exams, reviewed)이 채워짐

## 다음
1. Claude 아티팩트에는 `dist/standalone.html` 내용을 반영. 일반 웹 호스팅은 `dist/index.html`과 `dist/font.js`를 함께 배포
2. 무료 키 하나씩 실제 호출 → 공급자 CORS, JSON 형식, 품질과 한도 기록
3. 실제 강의자료로 역할 배정과 실패 전환 확인 후 프롬프트 조정 (`site/ai.js`)
4. 친구 테스트
