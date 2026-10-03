// 번역 프롬프트 조립 검사 (브라우저 없이): node tests/translate.test.js
const assert = require('assert');
const T = require('../site/translate.js');

const items = [
  { id: 0, page: 1, t: 'title', en: 'MOS Capacitor: Energy Bands and Operating Modes', max: 20 },
  { id: 1, page: 1, t: 'text', en: 'The flat-band voltage V_{FB} and depletion regions; work-function difference', max: 40 },
  { id: 2, page: 2, t: 'text', en: 'Round Robin: context switches, deadlocks and the ready queue', max: 40 },
  { id: 3, page: 2, t: 'label', en: 'gateway', max: 5 },
];
const terms = T.glossaryFor(items);
for (const want of ['flat band voltage → 플랫밴드 전압', 'depletion region → 공핍 영역', 'work function → 일함수', 'context switch → 문맥 교환', 'deadlock → 교착 상태', 'energy band → 에너지 밴드'])
  assert(terms.includes(want), '용어집에서 골라야 한다: ' + want);
assert(!/^gate →/m.test(terms), 'gateway 때문에 gate를 고르면 안 된다');
assert(!terms.includes('신경망'), '나오지 않은 분야의 용어는 넣지 않는다');
console.log('통과  묶음에 나온 전공 용어만 용어집에서 고른다 (하이픈·복수형 포함)');

const prompt = T.buildPrompt(false, items, { title: 'MOS Capacitor', memo: 'gate metal → 게이트 금속' });
assert.deepStrictEqual(JSON.parse(prompt.slice(prompt.lastIndexOf('입력:\n') + 4)), items, '프롬프트는 입력 JSON으로 끝난다');
assert(prompt.includes('자료 제목: MOS Capacitor') && prompt.includes('gate metal → 게이트 금속') && prompt.includes('V_{G}'));
assert(prompt.length < 9000, '프롬프트 머리말이 너무 길면 무료 모델 한도를 넘는다: ' + prompt.length);
assert(T.buildPrompt(true, [{ id: 1, en: 'a', ko: '가', max: 1 }], {}).startsWith('아래 한국어 번역(ko)이'));
console.log('통과  번역·줄이기 프롬프트: 문체 지침, 용어집, 자료 제목, 앞선 번역, 입력 JSON 순서');

assert.deepStrictEqual(T.runsOf('V_{G}가'), [['V', 0], ['G', 1], ['가', 0]]);
assert.deepStrictEqual(T.runsOf('x^{2}'), [['x', 0], ['2', 2]]);
console.log('통과  첨자 표기를 본문·아래첨자·위첨자 조각으로 나눈다');

// 묶음 나누기: 짧은 자료는 한 번에, 긴 자료는 쪽 단위로 끊어 여러 번에
const mk = (n, page, len) => ({ id: n, page, t: 'text', en: 'x'.repeat(len), max: 10 });
assert.strictEqual(T.planBatches([mk(0, 1, 30), mk(1, 1, 40), mk(2, 2, 20)]).length, 1, '짧은 자료는 요청 한 번');
const long = [];
for (let page = 1; page <= 40; page++) for (let i = 0; i < 9; i++) long.push(mk(long.length, page, 110));
const batches = T.planBatches(long);
assert.strictEqual(batches.flat().length, long.length, '빠지는 항목이 없다');
assert(batches.length <= 8, '긴 자료(40쪽·360항목)도 요청 8번 이내: ' + batches.length);
assert(batches.every(b => b.length <= T.config.batchItems * 1.5));
for (let i = 1; i < batches.length; i++) assert.notStrictEqual(batches[i][0].page, batches[i - 1][batches[i - 1].length - 1].page, '쪽 중간에서 끊지 않는다');
const huge = T.planBatches([mk(0, 1, 9000), mk(1, 1, 50)]);
assert.strictEqual(huge.length, 2, '한 묶음보다 긴 문단은 혼자 한 묶음');
console.log('통과  묶음 나누기: 짧은 자료 1회, 긴 자료는 쪽 단위로 요청 수 최소화, 긴 문단은 따로');

const withPages = T.buildPrompt(false, items, { title: 'MOS', pages: '1쪽: MOS Capacitor\n2쪽: Scheduling' });
assert(withPages.includes('2쪽: Scheduling') && withPages.includes('긴 문단은 문장을 빼거나 합쳐 요약하지 않는다'));
console.log('통과  짧은 항목에는 쪽 제목을, 긴 문단에는 요약 금지 지침을 준다');

// 모델이 돌려준 글 다듬기와 검사
assert.strictEqual(T.tidy('as V_{G} changes', 'V_G가 변한다'), 'V_{G}가 변한다');
assert.strictEqual(T.tidy('E_{F} is flat', '$E_{F}$는 평탄하다'), 'E_{F}는 평탄하다');
assert.strictEqual(T.tidy('φ_{ms} bends the bands', '\\phi_{ms}가 밴드를 휘게 한다'), 'φ_{ms}가 밴드를 휘게 한다');
assert.strictEqual(T.tidy('depletion width x_{d}', '공핍 폭 x<sub>d</sub>'), '공핍 폭 x_{d}');
assert.strictEqual(T.tidy('call page_table here', 'page_table 호출'), 'page_table 호출', '변수명의 밑줄은 첨자로 바꾸지 않는다');
assert.strictEqual(T.faithful('See how V_{G} changes over time', '시간에 따라 V가 변하는 모습 확인'), false, '첨자를 빠뜨리면 다시 묻는다');
assert.strictEqual(T.faithful('See how V_{G} changes over time', '시간에 따라 V_{G}가 변하는 모습 확인'), true);
assert.strictEqual(T.faithful('The oxide blocks current flow completely', 'The oxide blocks the current flow'), false, '영어로 돌려주면 다시 묻는다');
assert.strictEqual(T.faithful('MOSFET', 'MOSFET'), true, '약어처럼 그대로 둘 말은 통과');
console.log('통과  모델 출력 다듬기(V_G, $…$, <sub>, \\phi)와 검사(첨자 누락, 미번역)');
