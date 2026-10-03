const assert = require('assert');
const Study = require('../site/study.js');

const courses = [{
  id: 'os', name: '운영체제', lectures: ['l1', 'l2', 'l3', 'l4'], reviewed: { l1: true, l2: true },
  exams: [{ id: 'mid', title: '중간고사', date: '2099-10-20', time: '09:00' }]
}];
const stats = [{ c: courses[0], a: { answered: 5, correct: 4, wrong: [{ q: { question: '교착상태' } }] } }];

const readiness = Study.readiness(courses, stats);
assert.equal(readiness.lectures, 4);
assert.equal(readiness.reviewed, 2);
assert.equal(readiness.wrong, 1);
assert(readiness.score > 40 && readiness.score < 90, '일부만 공부한 상태는 중간 점수여야 한다');

const plan = Study.plan(courses, stats);
assert.deepEqual(plan.slice(0, 2).map(x => x.kind), ['review', 'wrong']);
assert.equal(plan[0].href, '#/c/os/lectures');
assert.equal(plan[1].href, '#/c/os/quiz/wrong');

const empty = Study.plan([], []);
assert.equal(empty[0].kind, 'course');

const cards = Study.cards([
  { summary: { title: '1강', terms: [{ term: 'Process', definition: '실행 중인 프로그램', pages: [2] }] } },
  { summary: { title: '2강', terms: [{ term: 'process', definition: '작업의 실행 단위', pages: [3] }, { term: 'Thread', definition: '실행 흐름', pages: [5] }] } }
]);
assert.equal(cards.length, 2, '같은 용어는 대소문자와 관계없이 한 장으로 합친다');
assert.equal(cards[0].term, 'Process');
assert.equal(cards[1].lectureNo, 2);

assert.equal(Study.clock(1500), '25:00');
assert.equal(Study.clock(65), '01:05');

console.log('통과  준비도·추천 순서·플래시카드·집중 타이머 계산');
