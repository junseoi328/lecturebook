// 실행: node tests/ai.test.js — 자료 나누기, 결과 검사, 프롬프트 규칙
const assert = require('assert');
global.window = {};
const AI = require('../site/ai.js');
let fails = 0;
const test = (n, f) => { try { f(); console.log('통과  ' + n); } catch (e) { fails++; console.log('실패  ' + n + '\n      ' + e.message); } };
const pages = (n, len, img = []) => Array.from({ length: n }, (_, i) => ({ n: i + 1, text: 'ㄱ'.repeat(len), image: img.includes(i + 1) ? {} : undefined }));

test('긴 자료는 여러 호출로 나뉘고 페이지가 빠지지 않는다', () => {
  const ps = pages(60, 2000), ch = AI.chunkPages(ps, 0);
  assert.ok(ch.length > 1);
  assert.deepStrictEqual(ch.flatMap(c => c.pages.map(p => p.n)), ps.map(p => p.n));
  for (const c of ch) assert.ok(AI.pagesText(c).length <= AI.MAX_CHARS + 2000);
});
test('한 호출의 프롬프트는 256KB 제한보다 작다 (한글 3바이트 기준)', () => {
  for (const c of AI.chunkPages(pages(60, 2000), 0)) assert.ok(Buffer.byteLength(AI.lecturePrompt('과목', '파일', c, 1, 2)) < 200 * 1024);
});
test('스캔 쪽은 호출당 이미지 수 한도를 지킨다', () => {
  const ch = AI.chunkPages(pages(12, 10, [1, 2, 3, 4, 5, 6, 7]), 3);
  for (const c of ch) assert.ok(c.images.length <= 3);
  assert.strictEqual(ch.reduce((s, c) => s + c.images.length, 0), 7);
});
test('프롬프트는 페이지 번호, 근거 규칙, 이미지 순서를 담는다', () => {
  const [c] = AI.chunkPages([{ n: 1, text: '본문' }, { n: 2, text: '', image: {} }], 5);
  const p = AI.lecturePrompt('운영체제', 'os.pdf', c, 1, 1);
  assert.ok(p.includes('[p.1]') && p.includes('[p.2]'));
  assert.ok(p.includes('지어내지 않는다') && p.includes('근거 페이지'));
  assert.ok(p.includes('p.2 페이지의 스캔본'));
});
test('요약 정리: 빠진 항목과 잘못된 페이지를 걸러낸다', () => {
  const s = AI.normalizeSummary({ title: '', sections: [{ heading: 'A', points: ['문자열 요점', { text: '', pages: [1] }, { text: '좋음', pages: ['3', -1, 'x'] }] }, { heading: 'B', points: [] }], terms: [{ term: '' }], examPoints: 'x' });
  assert.strictEqual(s.title, '제목 없음');
  assert.strictEqual(s.sections.length, 1);
  assert.deepStrictEqual(s.sections[0].points.map(p => p.text), ['문자열 요점', '좋음']);
  assert.deepStrictEqual(s.sections[0].points[1].pages, [3]);
  assert.deepStrictEqual(s.terms, []); assert.deepStrictEqual(s.examPoints, []);
});
test('여러 조각의 요약을 합치면 용어가 중복되지 않는다', () => {
  const m = AI.mergeSummaries([{ title: '1', sections: [{ heading: 'a', points: ['x'] }], terms: [{ term: 'SJF', definition: 'd' }] }, { title: '2', sections: [{ heading: 'b', points: ['y'] }], terms: [{ term: 'sjf', definition: 'd2' }, { term: 'RR', definition: 'r' }] }]);
  assert.strictEqual(m.title, '1'); assert.strictEqual(m.sections.length, 2); assert.strictEqual(m.terms.length, 2);
});
test('문제 검사: 정답 번호가 보기 밖인 객관식은 버리고, 근거 강의 번호를 확인한다', () => {
  const qs = AI.normalizeQuiz({ questions: [
    { type: '객관식', question: 'Q1', choices: ['a', 'b', 'c', 'd'], answer: '2번', source: { lecture: 1, pages: [2] } },
    { type: '객관식', question: 'Q2', choices: ['a', 'b'], answer: '5' },
    { type: '서술형', question: 'Q3', answer: '모범', rubric: ['요소'], source: { lecture: 9 } },
    { type: '이상한', question: 'Q4', answer: 'x' }] }, 2);
  assert.deepStrictEqual(qs.map(q => q.question), ['Q1', 'Q3', 'Q4']);
  assert.strictEqual(qs[0].answer, '2'); assert.strictEqual(qs[1].source.lecture, null); assert.strictEqual(qs[2].type, '단답형');
});
test('문제 프롬프트는 문항 구성과 족보 경향을 담는다', () => {
  const lec = { summary: AI.normalizeSummary({ title: 'T', sections: [{ heading: 'h', points: [{ text: 'p', pages: [1] }] }] }) };
  const p = AI.quizPrompt({ course: 'OS', lectures: [lec], exam: { counts: { 객관식: 3, 서술형: 2 }, choices: 5, style: '서술형은 비교' }, jokbo: '자주 나온 주제: SJF(2회)' });
  assert.ok(p.includes('객관식 3문항') && p.includes('서술형 2문항') && !p.includes('계산 0'));
  assert.ok(p.includes('5개') && p.includes('서술형은 비교') && p.includes('SJF(2회)') && p.includes('베끼지 않는다'));
});
test('족보 여러 개를 합치면 주제 횟수가 더해진다', () => {
  const m = AI.mergeJokbo([{ topics: [{ topic: 'SJF', count: 2, lectures: [1] }], typeMix: [{ type: '서술형', count: 2 }] }, { topics: [{ topic: 'SJF', count: 1, lectures: [2] }], typeMix: [{ type: '서술형', count: 1 }] }]);
  assert.strictEqual(m.topics[0].count, 3); assert.deepStrictEqual(m.topics[0].lectures, [1, 2]); assert.strictEqual(m.typeMix[0].count, 3);
});
test('채점 결과 점수는 0~10 정수', () => {
  assert.strictEqual(AI.normalizeGrade({ score: 14.6 }).score, 10);
  assert.strictEqual(AI.normalizeGrade({ score: '7.4' }).score, 7);
  assert.strictEqual(AI.normalizeGrade({}).score, 0);
});
test('오류 코드는 한국어 안내로 바뀐다', () => {
  assert.ok(AI.message({ code: 'rate_limited' }).includes('사용량'));
  assert.ok(AI.message({ code: '처음 보는 코드' }).includes('다시'));
});
test('내 정리 형식과 분량이 프롬프트에 들어간다', () => {
  const [c] = AI.chunkPages([{ n: 1, text: '본문' }], 0);
  const base = AI.lecturePrompt('OS', 'f', c, 1, 1);
  const mine = AI.lecturePrompt('OS', 'f', c, 1, 1, { detail: 'brief', custom: '정의 → 예시 순서로' });
  assert.ok(!base.includes('사용자가 항상 원하는') && base.includes(AI.DETAIL.basic));
  assert.ok(mine.includes('정의 → 예시 순서로') && mine.includes(AI.DETAIL.brief) && mine.includes('JSON 형태 안에서'));
  assert.ok(AI.lecturePrompt('OS', 'f', c, 1, 1, { custom: 'x'.repeat(5000) }).length < base.length + 1500, '내 형식은 1200자로 자른다');
});
test('족보 문제를 연습 문제로: 모범답안이 정답, 객관식은 단답형으로', () => {
  const a = AI.normalizeJokbo({ questions: [
    { no: '1', text: 'FCFS와 SJF 비교', type: '서술형', modelAnswer: '도착 순 vs 짧은 순', answerTips: '장단점', lectures: [1], confidence: 'high' },
    { no: '2', text: '보기 고르기', type: '객관식', modelAnswer: '3번', lectures: [9], confidence: 'low' },
    { no: '3', text: '답 없음', type: '단답형', modelAnswer: '' }] });
  const qs = AI.jokboToQuiz(a, 2);
  assert.strictEqual(qs.length, 2);
  assert.strictEqual(qs[0].answer, '도착 순 vs 짧은 순'); assert.deepStrictEqual(qs[0].rubric, ['장단점']); assert.strictEqual(qs[0].source.lecture, 1);
  assert.strictEqual(qs[1].type, '단답형'); assert.strictEqual(qs[1].source.lecture, null); assert.ok(qs[1].uncertain);
});

test('무료 AI 팀은 서로 다른 역할 10개로 구성된다', () => {
  assert.strictEqual(AI.FREE_TEAM.length, 10);
  assert.strictEqual(new Set(AI.FREE_TEAM.map(x => x.id)).size, 10);
  assert.ok(AI.FREE_TEAM.every(x => x.name && x.skill && x.tasks.length));
});
test('무료 공급자 연결 상태는 키 원문 없이 불리언으로만 노출된다', () => {
  AI.configure({ openrouterKey: 'test-key', groqKey: '', geminiKey: '' });
  const c = AI.connections();
  assert.strictEqual(c.openrouter, true); assert.strictEqual(c.groq, false);
  assert.ok(!JSON.stringify(c).includes('test-key'));
  AI.configure({ openrouterKey: '' });
});
test('모델의 코드펜스 JSON 응답을 안전하게 파싱한다', () => {
  assert.deepStrictEqual(AI.cleanJson('```json\n{"ok":true}\n```'), { ok: true });
  assert.throws(() => AI.cleanJson('JSON 아님'));
});

console.log(fails ? `\n${fails}개 실패` : '\n전부 통과'); process.exit(fails ? 1 : 0);
