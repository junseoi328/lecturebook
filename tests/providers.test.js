const assert = require('assert');
global.window = {};
const AI = require('../site/ai.js');

async function main() {
  const providers = AI.providers();
  assert.deepStrictEqual(providers.map(p => p.id), ['gemini', 'groq', 'openrouter', 'mistral', 'cerebras', 'sambanova', 'ollama']);
  assert.ok(providers.every(p => p.name && p.url));
  console.log('통과  일곱 공급자를 구분해 표시한다');

  let request;
  global.fetch = async (url, opts) => {
    request = { url, opts };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
  };
  AI.configure({ mistralKey: 'private-test-key' });
  assert.strictEqual(AI.status().mistral, 'configured');
  const result = await AI.testConnection('mistral');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(AI.status().mistral, 'ready');
  assert.ok(request.url.startsWith('https://api.mistral.ai/'));
  assert.ok(!request.url.includes('private-test-key'));
  assert.strictEqual(request.opts.headers.Authorization, 'Bearer private-test-key');
  AI.configure({ mistralKey: '' });
  assert.strictEqual(AI.status().mistral, 'off');
  console.log('통과  실제 요청 뒤에만 사용 가능으로 표시하고 키를 URL에 넣지 않는다');

  global.fetch = async () => ({ ok: false, status: 401 });
  AI.configure({ cerebrasKey: 'wrong-key' });
  const failed = await AI.testConnection('cerebras');
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.code, 'auth_failed');
  assert.strictEqual(AI.status().cerebras, 'error');
  AI.configure({ cerebrasKey: '' });
  console.log('통과  인증 실패를 연결 성공으로 오인하지 않는다');

  AI.configure({ cerebrasKey: 'only-key' });
  assert.strictEqual(AI.recommendedChars(), 16000);
  AI.configure({ cerebrasKey: '' });
  assert.strictEqual(AI.recommendedChars(), AI.MAX_CHARS);
  console.log('통과  작은 무료 문맥 한도에 맞춰 강의자료를 더 작게 나눈다');

  global.fetch = async (url, opts) => {
    request = { url, opts };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }) };
  };
  AI.configure({ geminiKey: 'private-gemini-key' });
  assert.strictEqual((await AI.testConnection('gemini')).ok, true);
  assert.ok(!request.url.includes('private-gemini-key'));
  assert.strictEqual(request.opts.headers['x-goog-api-key'], 'private-gemini-key');
  AI.configure({ geminiKey: '' });
  console.log('통과  Gemini 키도 URL에 넣지 않는다');

  const prompt = AI.answerPrompt('운영체제', { summary: AI.normalizeSummary({ title: '스케줄링', sections: [{ heading: 'FCFS', points: [{ text: '도착 순 처리', pages: [2] }] }] }), pages: [{ n: 2, text: 'FCFS는 먼저 도착한 작업부터 처리한다.' }] }, 'FCFS는 어떻게 동작해?');
  assert.ok(prompt.includes('자료에 없는 내용은'));
  assert.ok(prompt.includes('[p.2]'));
  assert.ok(prompt.includes('FCFS는 어떻게 동작해?'));
  assert.deepStrictEqual(AI.normalizeAnswer({ answer: '답', pages: [2, -1, 'x'], uncertainty: '' }), { answer: '답', pages: [2], uncertainty: '' });
  console.log('통과  강의 질문은 원문과 페이지 근거를 사용한다');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
