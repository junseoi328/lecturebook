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
