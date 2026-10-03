// 렉처북: 준비도, 집중 타이머, 암기 카드, 무료 AI 연결
(() => {
  const app = document.getElementById('app'), toastEl = document.getElementById('toast');
  const THEME_KEY = 'lecturebook-theme';
  let theme = (() => { try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; } })();
  function applyTheme() { document.documentElement.dataset.theme = theme === 'system' ? '' : theme; }
  function toggleTheme() {
    theme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
    applyTheme();
    document.querySelectorAll('.theme-toggle').forEach(button => {
      button.textContent = theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐';
      button.setAttribute('aria-label', `테마 전환, 현재 ${theme}`);
    });
  }
  applyTheme();

  // ---------- 도구 ----------
  function h(tag, attrs, ...kids) {
    const [name, ...cls] = tag.split('.');
    const el = document.createElement(name);
    if (cls.length) el.className = cls.join(' ');
    if (attrs !== undefined && (attrs === null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
      else if (k === 'value') el.value = v;
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
    return el;
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function toast(msg, ms = 3000) { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove('on'), ms); }
  const pageChip = pages => (pages && pages.length ? h('span.pg', `p.${pages.join(', ')}`) : null);
  const esc = s => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').trim();
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const secTitle = (label, more) => h('div.sec-title', label, more || null);

  async function saveFile(filename, data) {
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null;
    if (dl) {
      try { await dl.save({ filename, data }); return true; }
      catch (e) { if (e && e.code !== 'declined') toast('파일을 저장하지 못했어요.'); return false; }
    }
    const blob = data instanceof Blob ? data : new Blob([data]);
    const a = h('a', { href: URL.createObjectURL(blob), download: filename }); document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  }

  // ---------- 날짜 ----------
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const z = n => String(n).padStart(2, '0');
  const localISO = (d = new Date()) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  const parseDay = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const examAt = ex => { const d = parseDay(ex.date); const [hh, mm] = (ex.time || '09:00').split(':').map(Number); d.setHours(hh, mm, 0, 0); return d.getTime(); };
  const ddayNum = ex => { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((parseDay(ex.date) - t) / 864e5); };
  const ddayLabel = ex => { const n = ddayNum(ex); return n > 0 ? `D-${n}` : n === 0 ? 'D-DAY' : `D+${-n}`; };
  const fmtMD = iso => { const d = parseDay(iso); return `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`; };
  const upcoming = exams => (exams || []).filter(e => ddayNum(e) >= 0).sort((a, b) => examAt(a) - examAt(b));
  function remaining(ex) {
    const ms = examAt(ex) - Date.now();
    if (ms <= 0) return '시작 시간이 지났어요';
    const d = Math.floor(ms / 864e5), hh = Math.floor((ms % 864e5) / 36e5), mm = Math.floor((ms % 36e5) / 6e4);
    return d ? `${d}일 ${hh}시간 남음` : hh ? `${hh}시간 ${mm}분 남음` : `${mm}분 남음`;
  }
  const dchip = ex => h('span.dchip', { class: ddayNum(ex) < 0 ? 'past' : ddayNum(ex) <= 3 ? 'urgent' : '' }, ddayLabel(ex));
  const evdate = (top, big) => h('div.evdate', h('span.m', top), h('span.dd', big));

  // ---------- 집중 타이머 ----------
  let focusEnd = 0, focusDuration = 25, focusSaving = false, focusTicker = null;
  try { focusEnd = Number(sessionStorage.getItem('lecturebook-focus-end')) || 0; focusDuration = Number(sessionStorage.getItem('lecturebook-focus-minutes')) || 25; } catch {}
  const saveFocusSession = () => { try { sessionStorage.setItem('lecturebook-focus-end', String(focusEnd)); sessionStorage.setItem('lecturebook-focus-minutes', String(focusDuration)); } catch {} };
  function beginFocus(minutes) {
    focusDuration = minutes; focusEnd = Date.now() + minutes * 60000; saveFocusSession(); startFocusTicker(); updateFocusDisplay();
    toast(`${minutes}분 집중을 시작했어요.`);
  }
  function stopFocus() {
    focusEnd = 0; saveFocusSession(); stopFocusTicker(); updateFocusDisplay(); toast('집중 타이머를 멈췄어요.');
  }
  function startFocusTicker() { if (!focusTicker) focusTicker = setInterval(tickFocus, 1000); }
  function stopFocusTicker() { clearInterval(focusTicker); focusTicker = null; }
  function updateFocusDisplay() {
    const active = focusEnd > Date.now(), left = active ? (focusEnd - Date.now()) / 1000 : focusDuration * 60;
    document.querySelectorAll('.focus-time').forEach(el => { el.textContent = Study.clock(left); });
    document.querySelectorAll('.focus-start').forEach(el => { el.textContent = active ? '멈추기' : '시작'; el.setAttribute('aria-pressed', String(active)); });
  }
  async function tickFocus() {
    updateFocusDisplay();
    if (!focusEnd || focusEnd > Date.now() || focusSaving) return;
    focusSaving = true; focusEnd = 0; saveFocusSession();
    const stats = (await Store.get('focus:stats')) || { sessions: 0, minutes: 0, byDay: {} };
    stats.sessions++; stats.minutes += focusDuration; stats.byDay ||= {}; stats.byDay[localISO()] = (stats.byDay[localISO()] || 0) + focusDuration;
    await Store.set('focus:stats', stats);
    document.querySelectorAll('.focus-stat').forEach(el => { el.textContent = `오늘 ${stats.byDay[localISO()]}분 · 총 ${stats.sessions}회`; });
    toast(`${focusDuration}분 집중 완료. 잠깐 쉬어가세요.`, 5000); focusSaving = false; stopFocusTicker(); updateFocusDisplay();
  }
  if (focusEnd > Date.now()) startFocusTicker();

  // ---------- 데이터 ----------
  const KINDS = ['시험', '퀴즈', '과제'];
  const DB = {
    async courses() { return (await Store.get('courses')) || []; },
    async course(id) { const c = await Store.get('course:' + id); return c ? migrate(c) : c; },
    async saveCourse(c) { await Store.set('course:' + c.id, c); const list = await this.courses(); const i = list.findIndex(x => x.id === c.id); const meta = { id: c.id, name: c.name, updated: Date.now() }; if (i >= 0) list[i] = meta; else list.push(meta); await Store.set('courses', list); },
    async deleteCourse(c) { for (const id of [...c.lectures, ...c.jokbos]) await Store.del('item:' + id); for (const k of ['quiz:', 'attempts:']) await Store.del(k + c.id); await Store.del('course:' + c.id); await Store.set('courses', (await this.courses()).filter(x => x.id !== c.id)); },
    item: id => Store.get('item:' + id),
    saveItem: it => Store.set('item:' + it.id, it),
    delItem: id => Store.del('item:' + id),
    async lectures(c) { return (await Store.getMany(c.lectures.map(id => 'item:' + id))).filter(Boolean); },
    async jokbos(c) { return (await Store.getMany(c.jokbos.map(id => 'item:' + id))).filter(Boolean); },
    async attempts(cid) { return (await Store.get('attempts:' + cid)) || { answered: 0, correct: 0, wrong: [] }; },
    async record(cid, q, ok) {
      const a = await this.attempts(cid); a.answered++; if (ok) a.correct++;
      const i = a.wrong.findIndex(w => w.q.question === q.question);
      if (!ok) { if (i < 0) a.wrong.unshift({ q, at: Date.now(), tries: 1 }); else { a.wrong[i].tries++; a.wrong[i].at = Date.now(); } }
      else if (i >= 0) a.wrong.splice(i, 1);
      await Store.set('attempts:' + cid, a); return a;
    }
  };
  function migrate(c) {
    c.exam = c.exam || {}; c.exam.counts = c.exam.counts || { 객관식: 5, 단답형: 3, 서술형: 2, 계산: 0 };
    c.exams = c.exams || []; c.reviewed = c.reviewed || {};
    c.summarize = { detail: 'basic', custom: '', autoPdf: false, ...(c.summarize || {}) };
    return c;
  }
  const newCourse = name => migrate({ id: uid(), name, lectures: [], jokbos: [], exam: { counts: { 객관식: 5, 단답형: 3, 서술형: 2, 계산: 0 }, choices: 4, difficulty: '실제 시험 수준', style: '', scope: null }, created: Date.now() });
  const scopeOf = (c, ex) => (ex && ex.scope ? ex.scope : c.exam.scope) || c.lectures;

  // ---------- AI 상태 ----------
  let aiReady = null;
  async function refreshAIState() {
    aiReady = AI.isConfigured() || !!(await AI.getSample());
    document.querySelectorAll('.ai-pill').forEach(renderPill);
    document.querySelectorAll('.need-ai').forEach(b => { b.disabled = !aiReady; });
  }
  refreshAIState();
  document.addEventListener('lecturebook:ai-change', refreshAIState);
  function renderPill(el) {
    el.className = 'ai-pill ' + (aiReady ? 'on' : aiReady === false ? 'off' : '');
    const linked = AI.connections();
    const n = AI.providers().filter(p => linked[p.id]).length;
    const ready = Object.values(AI.status()).filter(x => x === 'ready').length;
    el.textContent = aiReady ? (n ? `AI ${ready || n}곳 ${ready ? '확인' : '설정'}` : 'AI 연결됨') : aiReady === false ? 'AI 미연결' : 'AI 확인 중';
    el.title = aiReady === false ? 'AI 설정에서 무료 모델을 연결할 수 있어요.' : '자료에 맞는 모델을 자동으로 골라 사용합니다.';
  }
  const aiButton = (label, onclick, cls = 'btn') => h('button.' + cls + '.need-ai', { type: 'button', disabled: !aiReady, onclick }, label);

  // ---------- 작업 대기열 (AI 호출은 한 번에 하나씩) ----------
  const jobs = [];
  let queue = Promise.resolve();
  function addJob(job) { job.id = uid(); job.stage = '대기 중'; job.pct = 0; jobs.push(job); renderJobs(); queue = queue.then(() => runJob(job)).catch(() => {}); }
  async function runJob(job) {
    job.ctl = new AbortController();
    try { await job.run(job, () => renderJobs()); job.done = true; job.stage = '완료'; job.pct = 1; }
    catch (e) { job.error = (e && (e.friendly || e.message)) || '오류가 났어요.'; job.stage = '실패'; }
    renderJobs();
    if (job.done) setTimeout(() => { const i = jobs.indexOf(job); if (i >= 0) jobs.splice(i, 1); renderJobs(); route(); }, 800);
  }
  function renderJobs() {
    document.querySelectorAll('.jobs').forEach(box => {
      const list = jobs.filter(j => j.courseId === box.dataset.course && j.kind === box.dataset.kind);
      box.replaceChildren(...list.map(j => h('div.job', { class: j.error ? 'err' : j.done ? 'ok' : '' },
        h('div.job-top', h('strong', j.name), h('span.stage', j.stage)),
        h('div.bar', h('span', { style: `width:${Math.round((j.pct || 0) * 100)}%` })),
        j.error ? h('p.small', j.error) : null,
        h('div.row',
          !j.done && !j.error ? h('button.btn.quiet.sm', { type: 'button', onclick: () => j.ctl && j.ctl.abort() }, '중지') : null,
          j.error ? h('button.btn.ghost.sm', { type: 'button', onclick: () => { jobs.splice(jobs.indexOf(j), 1); addJob({ ...j, error: null, done: false }); } }, '다시 시도') : null,
          j.error ? h('button.btn.quiet.sm', { type: 'button', onclick: () => { jobs.splice(jobs.indexOf(j), 1); renderJobs(); } }, '닫기') : null))));
    });
  }
  async function extractAndChunk(job, update) {
    let pages = job.pages;
    if (!pages) {
      job.stage = '파일 읽는 중'; update();
      pages = (await Extract.file(job.file, (n, t) => { job.stage = `파일 읽는 중 ${n}/${t}쪽`; job.pct = 0.2 * n / t; update(); })).pages;
    }
    if (!pages.length) throw new Error('파일에서 내용을 찾지 못했어요.');
    const lim = await AI.limits();
    const maxImages = (lim && lim.images && lim.images.maxCount) || 0;
    const imagePages = pages.filter(p => p.image);
    if (imagePages.length && !maxImages && imagePages.length === pages.length) throw new Error(AI.message({ code: 'images_unavailable' }));
    job.pagesText = pages.map(p => ({ n: p.n, text: p.text }));
    job.scanned = imagePages.length;
    return AI.chunkPages(pages, maxImages, AI.recommendedChars());
  }
  async function callChunks(job, update, chunks, makePrompt, label, task) {
    const parts = [];
    for (let i = 0; i < chunks.length; i++) {
      const base = 0.2 + 0.8 * (i / chunks.length), tag = `${label}${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''}`;
      job.stage = `${tag}: 생각하는 중`; job.pct = base; update();
      parts.push(await AI.json(makePrompt(chunks[i], i + 1, chunks.length), {
        images: chunks[i].images.map(p => p.image), signal: job.ctl.signal,
        task,
        onProvider: (name, provider) => { job.stage = `${tag}: ${name} · ${provider}`; update(); },
        onText: n => { job.stage = `${tag}: 쓰는 중 ${n.toLocaleString()}자`; job.pct = base + (0.8 / chunks.length) * Math.min(0.95, n / 6000); update(); }
      }));
    }
    return parts;
  }
  function lectureJob(course, source) {
    return { courseId: course.id, kind: 'lecture', name: source.file ? source.file.name : source.title, file: source.file, pages: source.pages, itemId: source.itemId, autoPdf: !!source.autoPdf,
      async run(job, update) {
        const chunks = await extractAndChunk(job, update);
        const settings = ((await DB.course(course.id)) || course).summarize || {};
        const parts = await callChunks(job, update, chunks, (ch, i, n) => AI.lecturePrompt(course.name, job.name, ch, i, n, settings), 'AI 정리', chunks.some(ch => ch.images.length) ? 'vision' : 'summary');
        const c = await DB.course(course.id); if (!c) return;
        const id = job.itemId || uid(), prev = job.itemId ? await DB.item(id) : null;
        const item = { id, type: 'lecture', courseId: c.id, fileName: job.name, pages: job.pagesText, scanned: job.scanned, summary: AI.mergeSummaries(parts), style: settings.detail, created: prev ? prev.created : Date.now(), updated: Date.now() };
        await DB.saveItem(item);
        if (!c.lectures.includes(id)) { c.lectures.push(id); await DB.saveCourse(c); }
        if (job.autoPdf || settings.autoPdf) { job.stage = 'PDF 저장 중'; update(); await lecturePdf(c, item, c.lectures.indexOf(id) + 1); }
      } };
  }
  function jokboJob(course, source) {
    return { courseId: course.id, kind: 'jokbo', name: source.file ? source.file.name : source.title, file: source.file, pages: source.pages,
      async run(job, update) {
        const chunks = await extractAndChunk(job, update);
        const c0 = await DB.course(course.id), lectures = c0 ? await DB.lectures(c0) : [];
        const parts = await callChunks(job, update, chunks, ch => AI.jokboPrompt(course.name, job.name, ch, lectures), '족보 분석', chunks.some(ch => ch.images.length) ? 'vision' : 'analysis');
        const c = await DB.course(course.id); if (!c) return;
        const id = uid();
        await DB.saveItem({ id, type: 'jokbo', courseId: c.id, fileName: job.name, pages: job.pagesText, analysis: AI.mergeJokbo(parts), created: Date.now() });
        c.jokbos.push(id); await DB.saveCourse(c);
      } };
  }

  // ---------- 공통 틀 ----------
  function appbar(sub) {
    const pill = h('span.ai-pill'); renderPill(pill);
    return h('header.appbar',
      h('a.brand', { href: '#/', 'aria-label': '렉처북 처음 화면' }, h('span.logo', { 'aria-hidden': 'true' }, '렉'), h('span.brand-name', '렉처북'), sub ? h('span.brand-sub', sub) : null),
      pill, h('span.spacer'),
      h('div.menu',
        h('button.btn.sm.search-open', { type: 'button', onclick: openGlobalSearch, 'aria-label': '모든 자료 검색' }, h('span', { 'aria-hidden': 'true' }, '⌕'), h('span.label', ' 검색'), h('kbd', 'Ctrl K')),
        h('button.btn.sm.ai-team-open', { type: 'button', onclick: openAISettings, 'aria-label': 'AI 설정' }, h('span', { 'aria-hidden': 'true' }, '✦'), h('span.label', ' AI 설정')),
        h('button.btn.sm.theme-toggle', { type: 'button', onclick: toggleTheme, 'aria-label': `테마 전환, 현재 ${theme}` }, theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'),
        h('details.tools-menu',
          h('summary', { 'aria-label': '더 보기' }, '•••'),
          h('div.tools-pop',
            h('button', { type: 'button', onclick: exportBackup }, h('span', '⤓'), '백업 저장'),
            h('label', h('input.visually-hidden', { type: 'file', accept: '.json,application/json', onchange: importBackup }), h('span', '⤒'), '백업 불러오기'),
            h('button', { type: 'button', onclick: openShortcuts }, h('span', '?'), '단축키')))));
  }
  const TABS = [['home', '⌂', '홈'], ['lectures', '▤', '강의'], ['exam', '◷', '시험'], ['jokbo', '◎', '족보'], ['quiz', '✎', '문제'], ['book', '▣', '책']];
  const bnav = (c, tab) => h('nav.bnav', { 'aria-label': '과목 메뉴' }, TABS.map(([k, ico, label]) =>
    h('a', { href: k === 'home' ? `#/c/${c.id}` : `#/c/${c.id}/${k}`, class: k === tab ? 'on' : '', 'aria-current': k === tab ? 'page' : null }, h('span.ico', { 'aria-hidden': 'true' }, ico), label)));
  function coursePage(c, tab, sub, ...content) {
    app.replaceChildren(appbar(c.name), h('main.page.with-nav', { tabindex: '-1', class: animate ? 'view-enter' : '' }, content), bnav(c, tab));
    renderJobs();
  }
  const courseHead = (c, stats, kicker) => h('div.course-head', h('div', kicker ? h('a.back', { href: `#/c/${c.id}` }, kicker) : h('a.back', { href: '#/' }, '← 내 과목'), h('h1', c.name), h('p.small', stats)));
  const sectionHero = (eyebrow, title, sub, cls = '') => h('div.section-hero', { class: cls }, h('div.sh-eyebrow', eyebrow), h('div.sh-title', title), sub ? h('div.sh-sub', sub) : null);

  async function openAISettings() {
    document.querySelector('.ai-dialog')?.remove();
    const meta = AI.providers();
    const inputs = {};
    const statusText = { off: '미설정', configured: '설정됨', ready: '사용 확인', error: '확인 실패' };
    const apply = id => {
      const next = {};
      if (id === 'ollama') {
        const saved = AI.localSettings();
        if (inputs.ollamaUrl.value.trim() !== saved.url || inputs.ollamaModel.value.trim() !== saved.model) {
          next.ollamaUrl = inputs.ollamaUrl.value.trim(); next.ollamaModel = inputs.ollamaModel.value.trim();
        }
      } else if (inputs[id].value.trim()) {
        next[meta.find(p => p.id === id).key || `${id}Key`] = inputs[id].value.trim();
        inputs[id].value = '';
      }
      if (Object.keys(next).length) AI.configure(next);
    };
    const cards = meta.map(p => {
      const state = h('span.provider-state', { 'data-state': AI.status()[p.id] }, statusText[AI.status()[p.id]]);
      const input = p.id === 'ollama' ? null : h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: AI.connections()[p.id] ? '새 키를 입력하면 교체돼요' : 'API 키 붙여넣기', 'aria-label': `${p.name} API 키` });
      if (input) inputs[p.id] = input;
      const test = h('button.btn.ghost.sm.provider-test', { type: 'button', onclick: async () => {
        apply(p.id);
        if (!AI.connections()[p.id]) { state.textContent = '먼저 정보를 입력해 주세요'; return; }
        test.disabled = true; state.textContent = '확인 중…'; state.dataset.state = 'testing';
        const result = await AI.testConnection(p.id);
        state.dataset.state = result.ok ? 'ready' : 'error';
        state.textContent = result.ok ? '사용 확인' : AI.message({ code: result.code });
        test.disabled = false; refreshAIState();
      } }, '연결 확인');
      const local = AI.localSettings();
      if (p.id === 'ollama') {
        inputs.ollamaUrl = h('input', { type: 'url', value: local.url || 'http://127.0.0.1:11434', 'aria-label': 'Ollama 주소' });
        inputs.ollamaModel = h('input', { type: 'text', value: local.model, placeholder: '예: qwen3:8b', 'aria-label': 'Ollama 모델' });
      }
      return h('article.provider-field', h('div.provider-top', h('strong.provider-name', p.name), state),
        h('p.provider-note', p.note), input || h('div.local-inputs', inputs.ollamaUrl, inputs.ollamaModel),
        h('div.provider-foot', h('a.provider-link', { href: p.site, target: '_blank', rel: 'noopener noreferrer' }, '키 받기 ↗'), test));
    });
    const team = AI.roster();
    const dialog = h('dialog.ai-dialog',
      h('form.ai-settings', { method: 'dialog', onsubmit: e => {
        e.preventDefault();
        meta.forEach(p => apply(p.id)); dialog.close(); toast('설정을 적용했어요. 연결 확인으로 작동 여부를 볼 수 있어요.'); route();
      } },
        h('header.dialog-head', h('div', h('span.kicker', 'AI 연결'), h('h2', '한 곳만 연결해도 돼요'), h('p', '내 키로 사용하고, 실패하면 연결한 다른 공급자에 같은 자료를 보낼 수 있어요.')), h('button.dialog-close', { type: 'button', onclick: () => dialog.close(), 'aria-label': '닫기' }, '×')),
        h('section.connect-panel', h('div.connect-copy', h('h3', '사용할 곳 고르기'), h('p', '키는 이 탭의 메모리에만 남고 백업되지 않습니다. “연결 확인”은 짧은 시험 요청을 보냅니다. 무료 한도와 브라우저 허용 여부는 공급자마다 달라요.')), h('div.provider-grid', cards)),
        h('details.agent-details', h('summary', '렉처북이 맡는 10가지 작업 보기'), h('p', '10개는 독립된 모델 수가 아니라 작업 역할입니다. 연결한 공급자 사이에서 작업을 나눠 처리해요.'),
          h('div.team-roster', team.map((a, i) => h('article.agent', h('span.agent-no', String(i + 1).padStart(2, '0')), h('div', h('strong', a.name), h('small', a.skill)), h('span.agent-model', `${a.provider} · ${String(a.model).split('/').pop()}`))))),
        h('footer.dialog-actions', h('button.btn.ghost', { type: 'button', onclick: () => { AI.configure({ openrouterKey: '', groqKey: '', geminiKey: '', mistralKey: '', cerebrasKey: '', sambanovaKey: '', ollamaUrl: '', ollamaModel: '' }); dialog.close(); toast('연결 정보를 지웠어요.'); route(); } }, '모두 해제'), h('button.btn', { type: 'submit' }, '설정 적용'))));
    document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
  }

  function aiTeamCard() {
    const labels = { openrouter: 'OpenRouter', groq: 'Groq', gemini: 'Gemini', mistral: 'Mistral', cerebras: 'Cerebras', sambanova: 'SambaNova', ollama: 'Ollama', claude: 'Claude' };
    const connected = Object.entries(AI.connections()).filter(([, on]) => on).map(([k]) => labels[k]);
    return h('section.ai-team-card', h('div.ai-team-copy', h('span.kicker', 'AI STUDIO'), h('h2', '공부에 맞는 AI, 직접 고르세요.'),
      h('p', connected.length ? `${connected.join(' · ')} 설정됨. 연결 확인에서 실제 작동 여부를 볼 수 있어요.` : '사용할 모델을 연결하면 자료 정리부터 문제 풀이까지 이어집니다.'), h('button.btn.ghost.sm', { type: 'button', onclick: openAISettings }, connected.length ? '연결 관리' : 'AI 연결하기')),
      h('div.agent-strip', [
        ['01', '자료 정리', '강의에서 핵심만'],
        ['02', '문제 연습', '시험 방식에 맞게'],
        ['03', '근거 확인', '원문 페이지까지']
      ].map(([no, title, detail]) => h('span', h('b', no), h('span', h('strong', title), h('small', detail))))));
  }

  async function buildSearchIndex() {
    const meta = await DB.courses();
    const courses = (await Store.getMany(meta.map(c => 'course:' + c.id))).filter(Boolean).map(migrate);
    const ids = [...new Set(courses.flatMap(c => [...c.lectures, ...c.jokbos]))];
    const items = (await Store.getMany(ids.map(id => 'item:' + id))).filter(Boolean);
    const byCourse = new Map(courses.map(c => [c.id, c]));
    const rows = courses.map(c => ({ type: '과목', title: c.name, detail: `강의 ${c.lectures.length}개 · 족보 ${c.jokbos.length}개`, href: `#/c/${c.id}`, text: c.name }));
    for (const it of items) {
      const c = byCourse.get(it.courseId), course = c ? c.name : '과목';
      if (it.type === 'lecture') {
        const s = it.summary || {}, terms = (s.terms || []).map(x => `${x.term} ${x.definition}`).join(' '), points = (s.examPoints || []).map(x => x.text).join(' ');
        rows.push({ type: '강의', title: s.title || it.fileName, detail: `${course} · ${it.fileName}`, href: `#/c/${it.courseId}/lecture/${it.id}`, text: `${s.title || ''} ${s.overview || ''} ${terms} ${points}` });
      } else {
        const a = it.analysis || {}, topics = (a.topics || []).map(x => `${x.topic} ${x.note || ''}`).join(' ');
        rows.push({ type: '족보', title: it.fileName, detail: `${course} · ${(a.questions || []).length}문제`, href: `#/c/${it.courseId}/jokbo/${it.id}`, text: `${it.fileName} ${a.summary || ''} ${topics}` });
      }
    }
    return rows;
  }

  async function openGlobalSearch() {
    const current = document.querySelector('.search-dialog');
    if (current) { current.querySelector('input')?.focus(); return; }
    const input = h('input.search-input', { type: 'search', placeholder: '과목, 강의 제목, 핵심 용어, 시험 포인트 검색', 'aria-label': '모든 자료 검색', autocomplete: 'off' });
    const count = h('span.search-count', '자료를 불러오는 중…');
    const results = h('div.search-results', { role: 'listbox', 'aria-label': '검색 결과' });
    const dialog = h('dialog.search-dialog', h('div.search-shell',
      h('header.search-head', h('span', { 'aria-hidden': 'true' }, '⌕'), input, h('button.dialog-close', { type: 'button', onclick: () => dialog.close(), 'aria-label': '검색 닫기' }, '×')),
      h('div.search-meta', count, h('span', 'Enter로 열기 · Esc로 닫기')),
      results));
    document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal(); input.focus();
    let rows;
    try { rows = await buildSearchIndex(); }
    catch { count.textContent = '자료를 읽지 못했어요.'; return; }
    let frame = 0, visible = [];
    const render = () => {
      const q = input.value.trim().toLocaleLowerCase('ko');
      visible = q ? rows.map(r => {
        const title = r.title.toLocaleLowerCase('ko'), body = r.text.toLocaleLowerCase('ko');
        return { ...r, score: title === q ? 4 : title.startsWith(q) ? 3 : title.includes(q) ? 2 : body.includes(q) ? 1 : 0 };
      }).filter(r => r.score).sort((a, b) => b.score - a.score).slice(0, 40) : rows.slice(0, 12);
      count.textContent = q ? `${visible.length}개 결과` : `전체 ${rows.length}개 · 최근 12개 표시`;
      results.replaceChildren(...visible.map((r, i) => h('a.search-result', { href: r.href, role: 'option', 'aria-selected': i === 0 ? 'true' : 'false', onclick: () => dialog.close() },
        h('span.search-type', r.type), h('span.search-copy', h('strong', r.title), h('small', r.detail)), h('span.search-arrow', '↗'))));
      if (!visible.length) results.append(h('div.search-empty', h('strong', '검색 결과가 없어요.'), h('span', '다른 핵심 용어나 강의 제목으로 찾아보세요.')));
    };
    input.addEventListener('input', () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(render); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && visible[0]) { e.preventDefault(); location.hash = visible[0].href; dialog.close(); } });
    render();
  }
  function openShortcuts() {
    document.querySelector('.shortcut-dialog')?.remove();
    const items = [
      ['Ctrl K', '전체 자료 검색'], ['T', '화면 테마 전환'], ['?', '단축키 보기'], ['Space', '암기 카드 뒤집기'], ['←  →', '암기 카드 이동']
    ];
    const dialog = h('dialog.shortcut-dialog',
      h('header', h('div', h('span.kicker', '빠른 실행'), h('h2', '키보드 단축키')), h('button.dialog-close', { type: 'button', onclick: () => dialog.close(), 'aria-label': '닫기' }, '×')),
      h('div.shortcut-list', items.map(([key, label]) => h('div', h('kbd', key), h('span', label)))));
    document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
  }
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLocaleLowerCase() === 'k') { e.preventDefault(); openGlobalSearch(); }
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === '?') { e.preventDefault(); openShortcuts(); }
    if (e.key.toLocaleLowerCase() === 't') { e.preventDefault(); toggleTheme(); }
  });

  async function exportBackup() {
    const ok = await saveFile(`렉처북-백업-${localISO()}.json`, JSON.stringify(await Store.dump()));
    if (ok) toast('백업 파일을 저장했어요.');
  }
  async function importBackup(e) {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.courses)) throw new Error();
      if (!confirm('백업을 불러오면 같은 과목은 백업 내용으로 바뀌어요. 계속할까요?')) return;
      const cur = await DB.courses(); await Store.load(data);
      await Store.set('courses', [...cur.filter(c => !data.courses.some(d => d.id === c.id)), ...data.courses]);
      toast('백업을 불러왔어요.'); route();
    } catch { toast('렉처북 백업 파일이 아니에요.'); }
    e.target.value = '';
  }

  // ---------- 이동 ----------
  let ticker = null, lastHash = null, animate = true;
  window.addEventListener('hashchange', route);
  async function route() {
    clearInterval(ticker);
    animate = location.hash !== lastHash; lastHash = location.hash;
    const [a, id, tab, sub] = location.hash.replace(/^#\/?/, '').split('/');
    if (a === 'c' && id) {
      const c = await DB.course(id);
      if (!c) { location.hash = '#/'; return; }
      const views = { lectures: lecturesTab, exam: examTab, jokbo: jokboTab, quiz: quizTab, book: bookTab };
      if (tab === 'lecture' && sub) await lectureView(c, sub);
      else if (tab === 'jokbo' && sub) await jokboView(c, sub);
      else await (views[tab] || dashboard)(c, sub);
    } else await home();
    app.removeAttribute('aria-busy');
    if (animate) { window.scrollTo(0, 0); document.querySelector('main')?.focus({ preventScroll: true }); }
  }
  function startTicker() {
    ticker = setInterval(() => document.querySelectorAll('[data-count]').forEach(el => {
      const ex = JSON.parse(el.dataset.count); el.textContent = remaining(ex);
    }), 30000);
  }
  const countdown = ex => h('div.countdown', { class: ddayNum(ex) <= 3 ? 'urgent' : '' }, h('span.live-dot'), h('b', ddayLabel(ex)), h('span', { 'data-count': JSON.stringify({ date: ex.date, time: ex.time }) }, remaining(ex)));

  // ---------- 처음 화면 ----------
  async function home() {
    const list = await DB.courses();
    const courses = (await Store.getMany(list.map(m => 'course:' + m.id))).filter(Boolean).map(migrate);
    const all = courses.flatMap(c => c.exams.map(ex => ({ ...ex, course: c })));
    const next = upcoming(all)[0];
    const name = h('input', { type: 'text', placeholder: '과목 이름 (예: 운영체제, 미시경제학)', 'aria-label': '새 과목 이름', maxlength: 60 });
    const add = async e => { e.preventDefault(); const n = name.value.trim(); if (!n) return name.focus(); const c = newCourse(n); await DB.saveCourse(c); location.hash = `#/c/${c.id}`; };
    const now = new Date();
    const hero = next
      ? h('section.hero', h('span.hero-mark', { 'aria-hidden': 'true' }, '✏️'),
          h('div.d', `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 · 가장 가까운 ${next.kind || '시험'}`),
          h('h1.t', `${next.course.name} ${next.title}`), h('p.sub', `${fmtMD(next.date)} ${next.time || ''}`),
          countdown(next), h('div.row', h('a.btn.ball.sm', { href: `#/c/${next.course.id}` }, '대비 현황 보기')))
      : h('section.hero', h('span.hero-mark', { 'aria-hidden': 'true' }, 'L'),
          h('div.d', '렉처북'), h('h1.t', '수업 자료, 시험 전에 한 권으로'),
          h('p.sub', '강의자료와 족보를 모아두세요. 핵심 정리부터 예상 문제, PDF까지 한곳에서 준비할 수 있어요.'));
    const [stats, focusStats] = await Promise.all([
      Promise.all(courses.map(async c => ({ c, a: await DB.attempts(c.id) }))),
      Store.get('focus:stats').then(v => v || { sessions: 0, minutes: 0, byDay: {} })
    ]);
    app.replaceChildren(appbar(), h('main.page.home-page', { tabindex: '-1', class: animate ? 'view-enter' : '' },
      h('div.home-top', hero, h('section.quick-wrap', secTitle('자료 정리'), quickCard(courses))),
      h('section.quick-wrap', secTitle('번역 PPT 만들기'), translateCard()),
      studyFlow(courses, stats, next, focusStats),
      secTitle('내 과목'),
      h('form.newcourse', { onsubmit: add }, name, h('button.btn', { type: 'submit' }, '과목 만들기')),
      courses.length ? h('ul.course-grid', stats.map(({ c, a }) => {
        const ex = upcoming(c.exams)[0], scope = scopeOf(c, ex), rev = scope.filter(id => c.reviewed[id]).length;
        return h('li', h('a.card.course-card', { href: `#/c/${c.id}` },
          h('div.top', h('strong', c.name), ex ? dchip(ex) : null),
          ex ? h('span.small', `${ex.title} · ${fmtMD(ex.date)}`) : h('span.small', '시험 일정 없음'),
          h('div', h('div.bar', h('span', { style: `width:${pct(rev, scope.length)}%` })), h('span.small', `복습 ${rev}/${scope.length}강`)),
          h('div.stat-line', h('span', '강의 ', h('b', c.lectures.length)), h('span', '족보 ', h('b', c.jokbos.length)), h('span', '정답률 ', h('b', a.answered ? pct(a.correct, a.answered) + '%' : '-')), h('span', '오답 ', h('b', a.wrong.length)))));
      })) : h('div.empty', h('p', '아직 과목이 없어요.'), h('p.small', '과목을 만들고 강의자료를 올리면 여기에 대비 현황이 쌓여요.')),
      aiTeamCard(),
      upcoming(all).length ? [secTitle('다가오는 일정'), h('div.card.timeline', upcoming(all).slice(0, 6).map(ex => {
        const d = parseDay(ex.date);
        return h('a.evline', { href: `#/c/${ex.course.id}`, style: 'text-decoration:none;color:inherit' }, evdate(`${d.getMonth() + 1}월`, d.getDate()),
          h('div.evbody', h('div.evtitle', `${ex.course.name} ${ex.title}`), h('div.evsub', `${fmtMD(ex.date)} ${ex.time || ''}`)), dchip(ex));
      }))] : null,
      !courses.length ? [secTitle('이렇게 써요'), h('div.card', h('ol.steps',
        [['과목 만들기', '과목마다 강의, 족보, 시험 일정이 따로 쌓여요'], ['강의자료 올리기', 'PDF, PPTX, DOCX, 사진. 요점마다 근거 페이지가 붙어요'], ['시험 일정과 족보 넣기', 'D-day와 자주 나온 주제를 보여 줘요'], ['문제 풀고 책 만들기', '틀린 문제는 오답 노트로, 정리는 한 권의 PDF로']].map(([t, s], i) =>
          h('li', h('span.n', i + 1), h('div', h('strong', t), h('span', s))))))] : null,
      h('p.small', { style: 'margin-top:28px' }, '올린 자료와 정리 결과는 이 브라우저에만 저장돼요. 다른 기기로 옮기려면 백업 저장을 쓰세요. AI 정리는 틀릴 수 있으니 페이지 번호로 원본을 확인하세요. 강의자료와 족보의 공유는 학교 규정을 따라 주세요.'),
      !Store.persistent ? h('p.warn', '이 환경에서는 브라우저 저장소를 쓸 수 없어서, 페이지를 닫으면 자료가 사라져요.') : null));
    startTicker();
  }

  function studyFlow(courses, stats, next, focusStats) {
    const first = next?.course || courses[0];
    const total = courses.reduce((n, c) => n + c.lectures.length, 0);
    const reviewed = courses.reduce((n, c) => n + c.lectures.filter(id => c.reviewed[id]).length, 0);
    const answered = stats.reduce((n, x) => n + x.a.answered, 0);
    const wrong = stats.reduce((n, x) => n + x.a.wrong.length, 0);
    const base = first ? `#/c/${first.id}` : '#/';
    const nodes = [
      ['01', '자료', `강의 ${total}개`, base, total ? 'ready' : ''],
      ['02', '핵심', `복습 ${reviewed}/${total}`, first ? `${base}/lectures` : '#/', reviewed ? 'ready' : ''],
      ['03', '연습', answered ? `${answered}문제 풀이` : '문제 만들기', first ? `${base}/quiz` : '#/', answered ? 'ready' : ''],
      ['04', '책', wrong ? `오답 ${wrong}개 포함` : 'PDF 만들기', first ? `${base}/book` : '#/', wrong ? 'alert' : '']
    ];
    const prompt = next
      ? `${next.course.name} ${next.title} ${ddayLabel(next)} · ${reviewed < total ? '정리한 내용을 먼저 훑어보세요.' : wrong ? '남은 오답부터 다시 풀어보세요.' : '시험용 PDF를 만들어두세요.'}`
      : courses.length ? '시험 날짜를 등록하면 가까운 일정부터 보여드려요.' : '과목을 만들고 첫 강의자료를 추가해 보세요.';
    const ready = Study.readiness(courses, stats), plan = Study.plan(courses, stats);
    const todayFocus = (focusStats.byDay && focusStats.byDay[localISO()]) || 0;
    const focusPanel = h('div.focus-panel',
      h('div.panel-label', '집중 타이머'), h('strong.focus-time', Study.clock(focusEnd > Date.now() ? (focusEnd - Date.now()) / 1000 : focusDuration * 60)),
      h('div.focus-presets', [25, 50].map(min => h('button', { type: 'button', 'aria-pressed': String(focusDuration === min), onclick: () => { if (focusEnd > Date.now()) stopFocus(); focusDuration = min; saveFocusSession(); updateFocusDisplay(); document.querySelectorAll('.focus-presets button').forEach(b => b.setAttribute('aria-pressed', String(Number(b.textContent) === min))); } }, String(min)))),
      h('button.btn.sm.focus-start', { type: 'button', 'aria-pressed': String(focusEnd > Date.now()), onclick: () => focusEnd > Date.now() ? stopFocus() : beginFocus(focusDuration) }, focusEnd > Date.now() ? '멈추기' : '시작'),
      h('small.focus-stat', `오늘 ${todayFocus}분 · 총 ${focusStats.sessions || 0}회`));
    const readinessPanel = h('div.readiness-panel',
      h('div.readiness-ring', { style: `--score:${ready.score}`, role: 'img', 'aria-label': `시험 준비도 ${ready.score}점` }, h('strong', ready.score), h('span', '준비도')),
      h('div', h('span.panel-label', '전체 현황'), h('strong.readiness-title', ready.score >= 80 ? '마무리 단계' : ready.score >= 50 ? '좋은 흐름' : ready.lectures ? '기초 다지기' : '시작 전'),
        h('small', `복습 ${ready.reviewed}/${ready.lectures} · 풀이 ${ready.answered} · 오답 ${ready.wrong}`)));
    const planPanel = h('div.plan-panel', h('div.panel-label', '추천 순서'), h('div.plan-list', plan.slice(0, 3).map((item, i) =>
      h('a', { href: item.href }, h('span', String(i + 1).padStart(2, '0')), h('div', h('strong', item.title), h('small', item.detail))))));
    return h('section.study-flow',
      h('div.flow-head', h('div', h('span.kicker', '학습 현황'), h('h2', '지금 할 공부')), h('p', prompt)),
      h('div.study-command', readinessPanel, planPanel, focusPanel),
      h('div.flow-track', nodes.map(([no, title, meta, href, state], i) =>
        h('a.flow-node', { href, class: state, 'aria-label': `${title}: ${meta}` },
          h('span.flow-no', no), h('span.flow-icon', { 'aria-hidden': 'true' }, ['↗', '◇', '✓', '▣'][i]),
          h('strong', title), h('small', meta), i < nodes.length - 1 ? h('i', { 'aria-hidden': 'true' }, '→') : null))));
  }

  // 처음 화면에서 과목만 고르고 올리면, 정리가 끝나는 대로 PDF까지 저장한다
  let quickCourseId = null;
  function quickCard(courses) {
    const sel = h('select.sel', { 'aria-label': '정리할 과목' },
      courses.map(c => h('option', { value: c.id, selected: c.id === quickCourseId }, c.name)), h('option', { value: '' }, '+ 새 과목'));
    const newName = h('input', { type: 'text', placeholder: '새 과목 이름', 'aria-label': '새 과목 이름 (바로 정리)', maxlength: 60 });
    const nameBox = h('label.field', h('span', '새 과목 이름'), newName);
    const auto = h('input', { type: 'checkbox', checked: true });
    const jobsBox = h('div.jobs', { 'data-course': sel.value || '', 'data-kind': 'lecture' });
    const sync = () => { nameBox.hidden = !!sel.value; quickCourseId = sel.value || null; jobsBox.dataset.course = sel.value || ''; renderJobs(); };
    sel.addEventListener('change', sync);
    const onFiles = async files => {
      if (!needAI()) return;
      let c = sel.value ? await DB.course(sel.value) : null;
      if (!c) { c = newCourse(newName.value.trim() || '새 과목'); await DB.saveCourse(c); }
      quickCourseId = c.id; jobsBox.dataset.course = c.id;
      files.forEach(f => addJob(lectureJob(c, { file: f, autoPdf: auto.checked })));
      toast(`${c.name}에 올렸어요. 정리가 끝나면 ${auto.checked ? 'PDF를 저장해요.' : '강의 목록에 쌓여요.'}`);
    };
    const card = h('div.card.quick',
      h('div.two', h('label.field', h('span', '과목'), sel), nameBox),
      dropzone('강의자료 추가', 'PDF, PPTX, DOCX, 이미지, 텍스트', onFiles, '+'),
      h('label.check', auto, '정리 후 PDF 저장'),
      jobsBox);
    sync();
    return card;
  }

  // ---------- 번역 PPT (영어 PPTX → 같은 디자인의 한국어 PPTX) ----------
  // 카드 하나를 계속 재사용한다. 번역 중에 화면이 다시 그려져도 진행 상태가 남는다.
  let trCard = null;
  function translateCard() {
    if (trCard) return trCard;
    let file = null, ctl = null;
    const name = h('strong', '영어 PPT 추가'), hint = h('span.small', 'PPTX 파일을 끌어다 놓거나 눌러서 선택');
    const shorten = h('input', { type: 'checkbox', checked: true }), notes = h('input', { type: 'checkbox' });
    const stage = h('p.small', { role: 'status', 'aria-live': 'polite', hidden: true }), fill = h('span'), bar = h('div.bar', { hidden: true }, fill);
    const result = h('div.job.ok', { hidden: true });
    const say = text => { stage.hidden = !text; stage.textContent = text || ''; };
    const setFile = f => {
      if (!f || ctl) return;
      if (!/\.pptx$/i.test(f.name)) return say('PPTX 파일만 번역할 수 있어요. 구버전 PPT는 PowerPoint에서 PPTX로 저장한 뒤 올려 주세요.');
      file = f; name.textContent = f.name; hint.textContent = f.size < 1048576 ? Math.ceil(f.size / 1024) + ' KB' : (f.size / 1048576).toFixed(1) + ' MB';
      run.disabled = false; result.hidden = true; say('');
    };
    const input = h('input.visually-hidden', { type: 'file', accept: '.pptx', 'aria-label': '번역할 영어 PPTX', onchange: e => { setFile(e.target.files[0]); e.target.value = ''; } });
    const zone = h('label.drop', input, h('span.ico', { 'aria-hidden': 'true' }, '가'), name, hint);
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); setFile(e.dataTransfer.files[0]); });
    const PHASE = { read: ['파일 읽는 중', 0, 5], translate: ['번역하는 중', 5, 70], shorten: ['긴 문장 줄이는 중', 75, 17], write: ['PPT에 써넣는 중', 92, 8] };
    const stop = h('button.btn.quiet.sm', { type: 'button', hidden: true, onclick: () => ctl && ctl.abort() }, '중지');
    const run = h('button.btn', { type: 'button', disabled: true, onclick: async () => {
      if (!file || !needAI()) return;
      run.disabled = true; result.hidden = true; bar.hidden = stop.hidden = false; fill.style.width = '0%';
      ctl = new AbortController();
      let friendly = '';
      try {
        await Assets.translate();
        const { blob, report: r } = await PptxTranslate.translatePptx(file, {
          shorten: shorten.checked, includeNotes: notes.checked, signal: ctl.signal,
          callAI: p => AI.json(p, { task: 'summary', signal: ctl.signal }).then(JSON.stringify, e => { friendly = (e && e.friendly) || ''; throw e; }),
          onProgress: p => { const [label, base, span] = PHASE[p.phase]; fill.style.width = base + span * (p.total ? p.done / p.total : 0) + '%'; say(p.phase === 'translate' || p.phase === 'shorten' ? `${label} ${p.done}/${p.total}` : label); }
        });
        if (!r.translated) { say(r.segments ? '번역된 문장이 없어요. 다시 시도해 주세요.' : '번역할 영어 문장을 찾지 못했어요.'); return; }
        const outName = file.name.replace(/\.pptx$/i, '') + '_ko.pptx';
        result.replaceChildren(h('div.job-top', h('strong', outName), h('span.stage', '완료')),
          h('ul.small', [`슬라이드 ${r.slides}장에서 ${r.translated}곳을 한국어로 바꿨어요.`,
            r.shortened && `글상자에 맞추려고 ${r.shortened}곳은 문장을 줄였어요.`,
            r.shrunk.length && `그래도 넘치는 글상자 ${r.shrunk.length}개는 글자 크기를 줄였어요.`,
            r.untranslated && `${r.untranslated}곳은 번역에 실패해 영어로 남겼어요.`,
            r.checkSlides.length && `${r.checkSlides.join(', ')}번 슬라이드는 글자가 넘칠 수 있으니 열어서 확인해 주세요.`].filter(Boolean).map(t => h('li', t))),
          h('div.row', h('button.btn.sm', { type: 'button', onclick: () => saveFile(outName, blob) }, '한국어 PPT 받기')));
        result.hidden = false; say('');
      } catch (e) {
        say(ctl.signal.aborted ? '중지했어요.' : friendly || (e && e.message) || '번역 중 문제가 생겼어요. 다시 시도해 주세요.');
      } finally { ctl = null; bar.hidden = stop.hidden = true; run.disabled = !file; }
    } }, '한국어 PPT 만들기');
    return trCard = h('div.card.quick',
      h('p.small', '영어 수업자료를 디자인은 그대로 두고 글자만 한국어로 바꿔요. 그림·차트 속 글자는 바뀌지 않아요.'),
      zone,
      h('label.check', shorten, '넘치면 문장 줄이기'), h('label.check', notes, '발표자 노트도 번역'),
      h('div.row', run, stop), stage, bar, result);
  }

  // ---------- 과목 홈 (대시보드) ----------
  async function dashboard(c) {
    const lectures = await DB.lectures(c), jokbos = await DB.jokbos(c), a = await DB.attempts(c.id);
    const next = upcoming(c.exams)[0], scope = scopeOf(c, next), rev = scope.filter(id => c.reviewed[id]).length;
    const topics = topTopics(jokbos);
    const hero = next
      ? h('section.hero', h('span.hero-mark', { 'aria-hidden': 'true' }, '✏️'),
          h('div.d', `다음 ${next.kind || '시험'} · 범위 ${scope.length}강`), h('div.t', next.title), h('p.sub', `${fmtMD(next.date)} ${next.time || ''}`), countdown(next),
          h('div.row', h('a.btn.ball.sm', { href: `#/c/${c.id}/quiz` }, '예상 문제 풀기'), h('a.btn.ghost.sm', { href: `#/c/${c.id}/book` }, '정리집 만들기')))
      : h('section.hero', h('span.hero-mark', { 'aria-hidden': 'true' }, '🗓️'),
          h('div.d', '시험 일정이 아직 없어요'), h('div.t', '시험 날짜를 넣으면 D-day와 범위 진도를 보여 줘요'),
          h('div.row', h('a.btn.ball.sm', { href: `#/c/${c.id}/exam` }, '시험 일정 넣기')));
    coursePage(c, 'home', null,
      courseHead(c, `강의 ${lectures.length}개 · 족보 ${jokbos.length}개`), hero,
      secTitle('내 공부 현황'),
      h('div.card',
        h('div.status-grid',
          h('div', h('span', '범위 복습'), h('strong', `${rev}/${scope.length}`, h('small', '강'))),
          h('div', h('span', '문제 정답률'), h('strong', a.answered ? pct(a.correct, a.answered) : '-', a.answered ? h('small', '%') : null)),
          h('div', h('span', '남은 오답'), h('strong', a.wrong.length, h('small', '문제')))),
        h('div.bar', h('span', { style: `width:${pct(rev, scope.length)}%` })),
        h('p.small', scope.length ? (rev < scope.length ? `복습할 강의가 ${scope.length - rev}개 남았어요.` : '범위 강의를 모두 복습했어요.') : '강의를 올리면 복습 진도가 쌓여요.'),
        h('div.row', a.wrong.length ? h('a.btn.ghost.sm', { href: `#/c/${c.id}/quiz/wrong` }, `오답 ${a.wrong.length}문제 다시 풀기`) : null, h('a.btn.ghost.sm', { href: `#/c/${c.id}/lectures` }, '강의 복습 체크'))),
      c.exams.length ? [secTitle('다가오는 일정', h('a.more', { href: `#/c/${c.id}/exam` }, '관리')), h('div.card.timeline', [...c.exams].sort((x, y) => examAt(x) - examAt(y)).map(ex => {
        const d = parseDay(ex.date);
        return h('div.evline', evdate(`${d.getMonth() + 1}월`, d.getDate()), h('div.evbody', h('div.evtitle', ex.title), h('div.evsub', `${fmtMD(ex.date)} ${ex.time || ''} · 범위 ${scopeOf(c, ex).length}강`)),
          h('span.pill', { class: ex.kind === '과제' ? 'amber' : ex.kind === '퀴즈' ? 'gray' : '' }, ex.kind || '시험'), dchip(ex));
      }))] : null,
      topics.length ? [secTitle('족보에 자주 나온 주제 TOP 3', h('a.more', { href: `#/c/${c.id}/jokbo` }, '전체')), h('div.card', h('ol.top3', topics.slice(0, 3).map((t, i) =>
        h('li', h('span.medal', { class: 'm' + (i + 1), 'aria-hidden': 'true' }, ['🥇', '🥈', '🥉'][i]), h('div.grow', h('strong', t.topic), h('div.bar.ball', h('span', { style: `width:${pct(t.count, topics[0].count)}%` })),
          t.lectures.length ? h('span.small', t.lectures.map(n => `${n}강`).join(', ')) : null), h('span.cnt', `${t.count}회`)))))] : null,
      secTitle('최근 정리한 강의', lectures.length ? h('a.more', { href: `#/c/${c.id}/lectures` }, '전체') : null),
      lectures.length ? h('div.card.timeline', [...lectures].sort((x, y) => (y.updated || y.created) - (x.updated || x.created)).slice(0, 3).map(l => {
        const n = c.lectures.indexOf(l.id) + 1;
        return h('a.evline', { href: `#/c/${c.id}/lecture/${l.id}`, style: 'text-decoration:none;color:inherit' }, evdate('강의', n),
          h('div.evbody', h('div.evtitle', l.summary.title), h('div.evsub', l.fileName)), c.reviewed[l.id] ? h('span.pill', '복습 완료') : h('span.pill.gray', '복습 전'));
      })) : h('div.empty', h('p', '아직 올린 강의가 없어요.'), h('a.btn', { href: `#/c/${c.id}/lectures` }, '강의자료 올리기')));
    startTicker();
  }
  function topTopics(jokbos) {
    const m = new Map();
    for (const j of jokbos) for (const t of j.analysis.topics) { const e = m.get(t.topic); if (e) { e.count += t.count; e.lectures = [...new Set([...e.lectures, ...t.lectures])]; } else m.set(t.topic, { ...t }); }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }

  // ---------- 올리기 ----------
  function dropzone(label, hint, onFiles, ico = '📄') {
    const input = h('input.visually-hidden', { type: 'file', multiple: true, accept: '.pdf,.pptx,.docx,.txt,.md,image/*', onchange: e => { onFiles([...e.target.files]); e.target.value = ''; } });
    const zone = h('label.drop', input, h('span.ico', { 'aria-hidden': 'true' }, ico), h('strong', label), h('span.small', hint));
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); onFiles([...e.dataTransfer.files]); });
    return zone;
  }
  function pasteBox(label, onSubmit) {
    const title = h('input', { type: 'text', placeholder: '제목 (예: 5주차 프로세스 스케줄링)', 'aria-label': '제목' });
    const text = h('textarea', { rows: 6, placeholder: '내용을 붙여넣으세요', 'aria-label': '붙여넣을 내용' });
    return h('details.paste', h('summary', label), h('div.paste-body', title, text, aiButton('정리하기', () => {
      const t = text.value.trim(); if (t.length < 50) return toast('내용을 조금 더 붙여넣어 주세요.');
      onSubmit(title.value.trim() || '붙여넣은 자료', Extract.text(t)); title.value = ''; text.value = '';
    })));
  }
  const needAI = () => { if (!aiReady) { toast('무료 AI를 연결하거나 claude.ai 공개 링크로 열어 주세요.'); openAISettings(); return false; } return true; };

  // ---------- 강의 ----------
  async function lecturesTab(c) {
    const lectures = await DB.lectures(c), rev = lectures.filter(l => c.reviewed[l.id]).length;
    coursePage(c, 'lectures', null,
      courseHead(c, `강의 ${lectures.length}개 · 족보 ${c.jokbos.length}개`),
      sectionHero('Lectures', '강의 정리', `정리 ${lectures.length}개 · 복습 완료 ${rev}개`),
      styleCard(c),
      dropzone('강의자료를 끌어다 놓거나 눌러서 고르기', 'PDF, PPTX, DOCX, 사진, 텍스트 · 여러 개를 한 번에 올려도 돼요', files => { if (needAI()) files.forEach(f => addJob(lectureJob(c, { file: f }))); }),
      pasteBox('파일 대신 텍스트 붙여넣기', (title, pages) => addJob(lectureJob(c, { title, pages }))),
      h('div.jobs', { 'data-course': c.id, 'data-kind': 'lecture' }),
      lectures.length ? h('ol.item-list', lectures.map((l, i) => h('li.card.item',
        evdate('강의', i + 1),
        h('div.item-main', h('a.item-title', { href: `#/c/${c.id}/lecture/${l.id}` }, l.summary.title),
          h('p.small', `${l.fileName} · ${l.pages.length}쪽 · 요점 ${l.summary.sections.reduce((s, x) => s + x.points.length, 0)}개 · 용어 ${l.summary.terms.length}개${l.scanned ? ` · 스캔 ${l.scanned}쪽` : ''}`)),
        h('div.item-actions',
          reviewToggle(c, l.id),
          h('button.icon', { type: 'button', 'aria-label': `${i + 1}강 위로`, disabled: i === 0, onclick: () => move(c, i, -1) }, '↑'),
          h('button.icon', { type: 'button', 'aria-label': `${i + 1}강 아래로`, disabled: i === lectures.length - 1, onclick: () => move(c, i, 1) }, '↓'),
          h('a.btn.ghost.sm', { href: `#/c/${c.id}/lecture/${l.id}` }, '보기'),
          h('button.btn.ghost.sm', { type: 'button', onclick: () => lecturePdf(c, l, i + 1) }, 'PDF'))))) :
        h('div.empty', h('p', '아직 강의가 없어요.'), h('p.small', '매주 받은 렉쳐노트를 올리면 강의 순서대로 쌓여요. 순서는 화살표로 바꿀 수 있어요.')));
  }
  // 과목마다 저장되는 "내 정리 형식". 올리는 모든 강의에 적용된다
  const DETAIL_LABEL = { brief: '핵심만', basic: '기본', full: '자세히' };
  function styleCard(c) {
    const st = c.summarize;
    let timer;
    const saved = h('span.small', '');
    const persist = () => { clearTimeout(timer); saved.textContent = '저장 중…'; timer = setTimeout(async () => { await DB.saveCourse(c); saved.textContent = '저장됨. 다음에 올리는 강의부터 적용돼요.'; line.textContent = summaryLine(); }, 400); };
    const summaryLine = () => `${DETAIL_LABEL[st.detail]} 정리${st.custom.trim() ? ' · 내 형식 적용' : ''}${st.autoPdf ? ' · PDF 자동 저장' : ''}`;
    const line = h('span.style-line', summaryLine());
    const segs = h('div.subtabs', { role: 'group', 'aria-label': '정리 분량' }, Object.entries(DETAIL_LABEL).map(([k, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(st.detail === k), 'data-k': k, onclick: ev => { st.detail = k; segs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k))); hint.textContent = HINT[k]; persist(); } }, label)));
    const HINT = { brief: '시험에 나올 핵심만. 설명과 예시는 빼요.', basic: '흐름을 따라 요점을 정리해요.', full: '정의, 조건, 예시, 예외, 절차까지 빠짐없이.' };
    const hint = h('p.small', HINT[st.detail]);
    return h('details.card.style-card', { open: !st.custom.trim() && !c.lectures.length ? true : null },
      h('summary', h('strong', '내 정리 형식'), line),
      h('div.form', { style: 'margin-top:12px' },
        h('div.field', h('span', '정리 분량'), segs, hint),
        h('label.field', h('span', '항상 이렇게 정리해 줘 (AI에게 매번 하던 말을 여기에 한 번만)'),
          h('textarea', { rows: 4, value: st.custom, maxlength: 1200, placeholder: '예) 개념마다 정의 → 왜 중요한지 → 시험에 나올 포인트 순서로. 영어 용어는 괄호로. 비슷한 개념은 차이점을 꼭 비교해 줘. 교수님이 강조한 슬라이드는 시험 포인트에 넣어 줘.',
            oninput: ev => { st.custom = ev.target.value; persist(); } })),
        h('label.check', h('input', { type: 'checkbox', checked: st.autoPdf, onchange: ev => { st.autoPdf = ev.target.checked; persist(); } }), '정리가 끝나면 PDF 자동 저장'),
        saved));
  }

  function reviewToggle(c, id) {
    const on = !!c.reviewed[id];
    return h('button.rev', { type: 'button', 'aria-pressed': String(on), onclick: async e => {
      const btn = e.currentTarget; // await 뒤에는 currentTarget이 비므로 먼저 잡아 둔다
      if (c.reviewed[id]) delete c.reviewed[id]; else c.reviewed[id] = Date.now();
      await DB.saveCourse(c);
      btn.setAttribute('aria-pressed', String(!!c.reviewed[id])); btn.textContent = c.reviewed[id] ? '✓ 복습 완료' : '복습 체크';
      toast(c.reviewed[id] ? '복습 완료로 표시했어요.' : '복습 표시를 지웠어요.');
    } }, on ? '✓ 복습 완료' : '복습 체크');
  }
  async function move(c, i, d) { const a = c.lectures; [a[i], a[i + d]] = [a[i + d], a[i]]; await DB.saveCourse(c); route(); }
  async function lecturePdf(c, l, n) {
    await Assets.pdfExport();
    const r = Book.build({ course: `${c.name} ${n}강`, lectures: [l] });
    if (await saveFile(`${esc(c.name)} ${n}강 ${esc(l.summary.title)}.pdf`, r.blob)) toast(`PDF ${r.pages}쪽을 만들었어요.${r.missing ? ` 표시할 수 없는 글자 ${r.missing}개는 ?로 바꿨어요.` : ''}`, 5000);
  }
  function summaryView(s) {
    return h('article.summary',
      s.overview ? h('p.overview', s.overview) : null,
      h('div.card', s.sections.map(sec => h('section', h('h3', sec.heading), h('ul', sec.points.map(p => h('li', p.text, ' ', pageChip(p.pages))))))),
      s.terms.length ? h('div.card', h('section.terms', h('h3', '핵심 용어'), h('dl', s.terms.map(t => [h('dt', t.term), h('dd', t.definition, ' ', pageChip(t.pages))])))) : null,
      s.formulas.length ? h('div.card', h('section.formulas', h('h3', '공식'), h('ul', s.formulas.map(f => h('li', h('code', f.expr), h('span', f.meaning), pageChip(f.pages)))))) : null,
      s.examPoints.length ? h('div.card', h('section.exam', h('h3', '시험 포인트'), h('ul', s.examPoints.map(p => h('li', p.text, ' ', pageChip(p.pages)))))) : null);
  }
  function openLectureAsk(c, l) {
    if (!needAI()) return;
    const ctl = new AbortController();
    const question = h('textarea', { rows: 3, maxlength: 500, placeholder: '예: FCFS와 SJF는 어떤 점이 달라?', 'aria-label': '강의에 질문' });
    const result = h('div.ask-result', h('p.small', '답은 이 강의의 요약과 원문에서 찾습니다. 근거가 부족하면 그대로 알려드려요.'));
    const status = h('span.ask-status', { role: 'status' }, '');
    const submit = h('button.btn', { type: 'submit' }, '질문하기');
    const dialog = h('dialog.ask-dialog', h('form.ask-form', { onsubmit: async e => {
      e.preventDefault();
      const q = question.value.trim(); if (q.length < 5) { status.textContent = '질문을 조금 더 자세히 적어 주세요.'; return; }
      submit.disabled = true; status.textContent = '답을 찾는 중…'; result.replaceChildren();
      try {
        const raw = await AI.json(AI.answerPrompt(c.name, l, q), { task: 'analysis', signal: ctl.signal,
          onProvider: (role, provider) => { status.textContent = `${provider}에서 답을 찾는 중…`; } });
        const answer = AI.normalizeAnswer(raw), valid = new Set(l.pages.map(p => p.n));
        if (!answer.answer) throw new Error('답을 만들지 못했어요. 다시 질문해 주세요.');
        result.replaceChildren(...[h('p.ask-answer', answer.answer),
          answer.pages.filter(n => valid.has(n)).length ? h('p.ask-sources', 'AI가 참조한 페이지 ', pageChip(answer.pages.filter(n => valid.has(n)))) : h('p.ask-sources', '표시된 원문 페이지 없음'),
          answer.uncertainty ? h('p.ask-uncertainty', `확인할 점 · ${answer.uncertainty}`) : null].filter(Boolean));
        status.textContent = '답을 만들었어요. 중요한 내용은 원문과 대조해 주세요.';
      } catch (err) { if (!ctl.signal.aborted) { status.textContent = err.friendly || err.message || '답을 만들지 못했어요.'; } }
      finally { submit.disabled = false; }
    } },
      h('header.dialog-head', h('div', h('span.kicker', '강의 질문'), h('h2', l.summary.title), h('p', '원문에 있는 내용만 물어보세요.')), h('button.dialog-close', { type: 'button', onclick: () => dialog.close(), 'aria-label': '닫기' }, '×')),
      h('div.ask-body', h('label.field', h('span', '궁금한 점'), question), h('div.ask-suggestions', ['핵심 개념을 쉽게 설명해 줘', '시험에 나올 비교 포인트는 뭐야?', '가장 중요한 공식은 언제 써?'].map(q => h('button.btn.quiet.sm', { type: 'button', onclick: () => { question.value = q; question.focus(); } }, q))), h('div.row', submit, status), result)));
    dialog.addEventListener('close', () => { ctl.abort(); dialog.remove(); });
    document.body.append(dialog); dialog.showModal(); question.focus();
  }
  async function lectureView(c, id) {
    const l = await DB.item(id); if (!l) { location.hash = `#/c/${c.id}/lectures`; return; }
    const n = c.lectures.indexOf(id) + 1;
    coursePage(c, 'lectures', null,
      h('div.course-head', h('div', h('a.back', { href: `#/c/${c.id}/lectures` }, `← ${c.name} 강의`), h('h1', l.summary.title), h('p.small', `${n}강 · ${l.fileName} · ${l.pages.length}쪽`))),
      h('div.row',
        h('button.btn', { type: 'button', onclick: () => lecturePdf(c, l, n) }, 'PDF로 저장'),
        aiButton('이 강의에 질문', () => openLectureAsk(c, l), 'btn.ghost'),
        reviewToggle(c, id),
        aiButton('다시 정리', () => { addJob(lectureJob(c, { title: l.fileName, pages: l.pages, itemId: l.id })); location.hash = `#/c/${c.id}/lectures`; }, 'btn.ghost'),
        h('button.btn.quiet', { type: 'button', onclick: async () => { if (!confirm('이 강의를 삭제할까요?')) return; c.lectures = c.lectures.filter(x => x !== id); delete c.reviewed[id]; await DB.saveCourse(c); await DB.delItem(id); location.hash = `#/c/${c.id}/lectures`; } }, '삭제')),
      l.scanned ? h('p.note', `스캔본 ${l.scanned}쪽은 이미지로 읽어서 정리했어요. 다시 정리하면 그 쪽은 빠져요.`) : null,
      summaryView(l.summary),
      h('details.raw.card', h('summary', `원문 보기 (${l.pages.length}쪽)`), h('div.raw-body', l.pages.map(p => h('div.rawpage', h('span.pg', `p.${p.n}`), h('p', p.text || '(스캔 이미지: 원문 텍스트 없음)'))))));
  }

  // ---------- 시험 ----------
  async function examTab(c) {
    const lectures = await DB.lectures(c), e = c.exam;
    let timer;
    const saved = h('span.small', '자동 저장돼요');
    const persist = () => { clearTimeout(timer); saved.textContent = '저장 중…'; timer = setTimeout(async () => { await DB.saveCourse(c); saved.textContent = '저장됨'; }, 400); };
    const scopeChecks = (sel, onChange) => h('div.checks', lectures.map((l, i) => h('label.check',
      h('input', { type: 'checkbox', checked: sel.includes(l.id), onchange: ev => onChange(l.id, ev.target.checked) }), `${i + 1}강. ${l.summary.title}`)));

    // 일정 추가
    const title = h('input', { type: 'text', placeholder: '예: 중간고사', 'aria-label': '일정 이름', maxlength: 40 });
    const date = h('input', { type: 'date', 'aria-label': '날짜', value: localISO(new Date(Date.now() + 14 * 864e5)) });
    const time = h('input', { type: 'time', 'aria-label': '시작 시간', value: '09:00' });
    const kind = h('select.sel', { 'aria-label': '종류' }, KINDS.map(k => h('option', { value: k }, k)));
    const newScope = new Set(lectures.map(l => l.id));
    const addExam = async ev => {
      ev.preventDefault();
      if (!title.value.trim() || !date.value) return toast('이름과 날짜를 넣어 주세요.');
      c.exams.push({ id: uid(), title: title.value.trim(), date: date.value, time: time.value || '09:00', kind: kind.value, scope: lectures.length ? [...newScope] : null });
      await DB.saveCourse(c); toast(`${title.value.trim()} 일정을 추가했어요.`); route();
    };
    const exams = [...c.exams].sort((x, y) => examAt(x) - examAt(y));
    const num = t => h('label.field.num', h('span', t), h('input', { type: 'number', min: 0, max: 15, value: e.counts[t] || 0, oninput: ev => { e.counts[t] = Math.max(0, Math.min(15, Number(ev.target.value) || 0)); persist(); } }));
    const baseScope = e.scope || lectures.map(l => l.id);

    coursePage(c, 'exam', null,
      courseHead(c, `강의 ${lectures.length}개 · 족보 ${c.jokbos.length}개`),
      sectionHero('Exams', '시험 준비', exams.length ? `일정 ${exams.length}개 · 가장 가까운 일정 ${upcoming(exams)[0] ? ddayLabel(upcoming(exams)[0]) : '없음'}` : '시험 일정과 문제 형식을 정해요'),
      secTitle('시험 일정'),
      h('div.card',
        exams.length ? h('div.timeline', exams.map(ex => { const d = parseDay(ex.date); return h('div.evline', evdate(`${d.getMonth() + 1}월`, d.getDate()),
          h('div.evbody', h('div.evtitle', ex.title), h('div.evsub', `${fmtMD(ex.date)} ${ex.time || ''} · ${ex.kind} · 범위 ${scopeOf(c, ex).length}강`)), dchip(ex),
          h('button.icon', { type: 'button', 'aria-label': `${ex.title} 삭제`, onclick: async () => { if (!confirm(`${ex.title} 일정을 지울까요?`)) return; c.exams = c.exams.filter(x => x.id !== ex.id); await DB.saveCourse(c); route(); } }, '✕')); })) : h('p.small', '아직 일정이 없어요. 아래에서 추가하세요.'),
        h('form.form', { onsubmit: addExam, style: 'margin-top:14px' },
          h('div.exam-add', h('label.field', h('span', '이름'), title), h('label.field', h('span', '날짜'), date), h('label.field', h('span', '종류'), kind)),
          h('label.field', { style: 'max-width:180px' }, h('span', '시작 시간'), time),
          lectures.length ? h('details', h('summary.small', '시험 범위 고르기 (기본: 모든 강의)'), scopeChecks([...newScope], (id, on) => { on ? newScope.add(id) : newScope.delete(id); })) : null,
          h('div.row', h('button.btn', { type: 'submit' }, '일정 추가')))),
      secTitle('문제 형식'),
      h('div.form',
        h('p.lead', '실제 시험 형식을 알려 주면 예상 문제와 정리집이 이 형식을 따라요.'),
        h('fieldset.card', h('legend', '문항 구성'), h('div.nums', AI.QTYPES.map(num)), h('p.small', '한 번에 최대 25문항까지 만들어요.')),
        h('div.card', h('div.two',
          h('label.field', h('span', '객관식 보기 수'), h('select', { onchange: ev => { e.choices = Number(ev.target.value); persist(); } }, [4, 5].map(v => h('option', { value: v, selected: (e.choices || 4) === v }, `${v}지선다`)))),
          h('label.field', h('span', '난이도'), h('select', { onchange: ev => { e.difficulty = ev.target.value; persist(); } }, ['기초 확인', '실제 시험 수준', '어렵게 (심화)'].map(v => h('option', { value: v, selected: (e.difficulty || '실제 시험 수준') === v }, v))))),
          h('label.field', { style: 'margin-top:12px' }, h('span', '시험 형식, 교수님 스타일, 주의사항 (자유롭게)'),
            h('textarea', { rows: 5, value: e.style || '', placeholder: '예) 중간고사 75분. 서술형은 개념을 비교하는 문제가 꼭 나옴. 계산 문제는 풀이 과정 점수 있음. 영어 용어로 물어봄.', oninput: ev => { e.style = ev.target.value; persist(); } }))),
        lectures.length ? h('fieldset.card', h('legend', '기본 시험 범위 (일정을 고르지 않을 때)'), scopeChecks(baseScope, (id, on) => { const s = new Set(e.scope || lectures.map(x => x.id)); on ? s.add(id) : s.delete(id); e.scope = [...s]; persist(); })) : null,
        saved),
      secTitle('과목 관리'),
      h('div.card.row',
        h('button.btn.ghost.sm', { type: 'button', onclick: async () => { const n = prompt('새 과목 이름', c.name); if (n && n.trim()) { c.name = n.trim(); await DB.saveCourse(c); route(); } } }, '이름 바꾸기'),
        h('button.btn.quiet.sm', { type: 'button', onclick: async () => { if (!confirm(`${c.name} 과목과 모든 자료를 지울까요? 되돌릴 수 없어요.`)) return; await DB.deleteCourse(c); location.hash = '#/'; } }, '과목 삭제')));
  }

  // ---------- 족보 ----------
  async function jokboTab(c) {
    const jokbos = await DB.jokbos(c), topics = topTopics(jokbos);
    coursePage(c, 'jokbo', null,
      courseHead(c, `강의 ${c.lectures.length}개 · 족보 ${jokbos.length}개`),
      sectionHero('Past exams', '족보 분석', jokbos.length ? `족보 ${jokbos.length}개 · 주제 ${topics.length}개` : '지난 시험지에서 출제 경향을 찾아요', 'amber'),
      h('p.lead', '지난 시험지를 올리면 자주 나온 주제와 출제 방식을 분석하고, 문제마다 모범답안과 작성 요령을 정리해요. 강의를 먼저 올려 두면 문제와 강의를 연결해 줘요.'),
      dropzone('족보 파일을 끌어다 놓거나 눌러서 고르기', 'PDF, 사진(스캔본), 텍스트', files => { if (needAI()) files.forEach(f => addJob(jokboJob(c, { file: f }))); }, '🔍'),
      pasteBox('족보 내용을 텍스트로 붙여넣기', (title, pages) => addJob(jokboJob(c, { title, pages }))),
      h('div.jobs', { 'data-course': c.id, 'data-kind': 'jokbo' }),
      topics.length ? [secTitle('전체 족보에서 자주 나온 주제'), h('div.card', h('ol.top3', topics.slice(0, 5).map((t, i) =>
        h('li', h('span.medal', { class: i < 3 ? 'm' + (i + 1) : '', 'aria-hidden': 'true' }, i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1), h('div.grow', h('strong', t.topic), h('div.bar.ball', h('span', { style: `width:${pct(t.count, topics[0].count)}%` }))), h('span.cnt', `${t.count}회`)))))] : null,
      jokbos.length ? [secTitle('분석한 족보'), h('ul.item-list', jokbos.map(j => h('li.card.item', evdate('족보', j.analysis.questions.length),
        h('div.item-main', h('a.item-title', { href: `#/c/${c.id}/jokbo/${j.id}` }, j.fileName), h('p.small', `문제 ${j.analysis.questions.length}개 · 주제 ${j.analysis.topics.length}개`)),
        h('div.item-actions', h('button.btn.ghost.sm', { type: 'button', onclick: () => practiceJokbo(c, j) }, '문제 풀기'), h('a.btn.ghost.sm', { href: `#/c/${c.id}/jokbo/${j.id}` }, '분석 보기')))))] : null);
  }
  async function practiceJokbo(c, j) {
    const qs = AI.jokboToQuiz(j.analysis, c.lectures.length);
    if (!qs.length) return toast('풀 수 있는 문제가 없어요 (모범답안이 있는 문제만 가능해요).');
    await Store.set('quiz:' + c.id, { questions: qs, created: Date.now(), target: `족보 ${j.fileName}` });
    location.hash = `#/c/${c.id}/quiz`;
  }
  async function jokboView(c, id) {
    const j = await DB.item(id); if (!j) { location.hash = `#/c/${c.id}/jokbo`; return; }
    const a = j.analysis, lectures = await DB.lectures(c), maxTopic = Math.max(1, ...a.topics.map(t => t.count));
    const lecLink = ns => ns.map(n => lectures[n - 1] ? h('a.pg', { href: `#/c/${c.id}/lecture/${lectures[n - 1].id}` }, `${n}강`) : null);
    coursePage(c, 'jokbo', null,
      h('div.course-head', h('div', h('a.back', { href: `#/c/${c.id}/jokbo` }, `← ${c.name} 족보`), h('h1', j.fileName), h('p.small', `문제 ${a.questions.length}개 · 주제 ${a.topics.length}개`))),
      h('div.row', h('button.btn.ball', { type: 'button', onclick: () => practiceJokbo(c, j) }, `족보 문제 풀어보기 (${AI.jokboToQuiz(a, c.lectures.length).length})`),
        h('button.btn.quiet.sm', { type: 'button', onclick: async () => { if (!confirm('이 족보 분석을 삭제할까요?')) return; c.jokbos = c.jokbos.filter(x => x !== id); await DB.saveCourse(c); await DB.delItem(id); location.hash = `#/c/${c.id}/jokbo`; } }, '삭제')),
      h('article.summary',
        a.summary ? h('p.overview', a.summary) : null,
        a.typeMix.length ? h('div.card', h('section', h('h3', '문항 유형'), h('div.typebar', a.typeMix.map((t, i) => h('span', { class: 't' + (i % 5), style: `flex:${t.count}` }, `${t.type} ${t.count}`))))) : null,
        a.topics.length ? h('div.card', h('section', h('h3', '자주 나온 주제'), h('ol.top3.topics', a.topics.map((t, i) =>
          h('li', h('span.medal', { class: i < 3 ? 'm' + (i + 1) : '', 'aria-hidden': 'true' }, i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1),
            h('div.grow', h('strong', t.topic), h('div.bar.ball', h('span', { style: `width:${pct(t.count, maxTopic)}%` })), t.note ? h('span.small', t.note) : null, h('div', lecLink(t.lectures))), h('span.cnt', `${t.count}회`)))))) : null,
        a.patterns.length ? h('div.card', h('section', h('h3', '출제 방식'), h('ul', a.patterns.map(p => h('li', p))))) : null,
        a.questions.length ? h('section', h('div.sec-title', '문제별 모범답안'), h('p.small', 'AI 답안은 틀릴 수 있어요. "확실하지 않음" 표시는 강의자료로 꼭 확인하세요.'),
          a.questions.map(q => h('details.qa', h('summary', h('span.qno', q.no), h('span', q.text), q.type ? h('span.tag', q.type) : null, q.confidence === 'low' ? h('span.tag.warn', '확실하지 않음') : null),
            h('div.qa-body', h('p', h('strong', '모범답안 '), q.modelAnswer || '-'), q.answerTips ? h('p', h('strong', '작성 요령 '), q.answerTips) : null, q.lectures.length ? h('p.small', '관련 강의 ', lecLink(q.lectures)) : null)))) : null,
        a.predictions.length ? h('div.card', h('section.exam', h('h3', '이번 시험 대비 포인트'), h('ul', a.predictions.map(p => h('li', p.text, p.why ? h('span.small', ` (${p.why})`) : null))))) : null));
  }

  // ---------- 문제 카드 (풀이 결과를 기록해 정답률과 오답 노트를 만든다) ----------
  function questionCard(c, q, onRecord) {
    let recorded = false;
    const record = async ok => { if (recorded) return; recorded = true; const a = await DB.record(c.id, q, ok); onRecord && onRecord(a, ok); };
    const fb = h('div.fb', { 'aria-live': 'polite' });
    const src = q.source && q.source.lecture ? `${q.source.lecture}강${q.source.pages.length ? ' p.' + q.source.pages.join(',') : ''}` : '';
    const answerBlock = () => [
      h('p', h('strong', '정답 '), q.type === '객관식' ? `${q.answer}번. ${q.choices[Number(q.answer) - 1]}` : q.answer),
      q.explanation ? h('p', q.explanation) : null,
      q.rubric.length ? h('p.small', '채점 요소: ' + q.rubric.join(' / ')) : null,
      src ? h('p.small', '근거: ' + src) : null].filter(Boolean);
    let control;
    if (q.type === '객관식') {
      const btns = q.choices.map((ch, k) => h('button.choice', { type: 'button', onclick: () => {
        const ok = String(k + 1) === q.answer; record(ok);
        btns.forEach((b, bi) => { b.classList.toggle('right', String(bi + 1) === q.answer); b.classList.toggle('wrong', bi === k && !ok); });
        fb.replaceChildren(...answerBlock());
      } }, h('span.cn', String(k + 1)), h('span', ch)));
      control = h('div.choices', btns);
    } else {
      const ta = h('textarea', { rows: q.type === '단답형' ? 2 : 5, placeholder: '내 답안', 'aria-label': '내 답안' });
      const mark = h('div.selfmark',
        h('button.btn.sm', { type: 'button', onclick: () => { record(true); mark.replaceChildren(h('span.pill', '맞음으로 기록')); } }, '맞았어요'),
        h('button.btn.ghost.sm', { type: 'button', onclick: () => { record(false); mark.replaceChildren(h('span.pill.red', '오답 노트에 추가')); } }, '틀렸어요'));
      const grade = aiButton('AI 채점', async () => {
        if (ta.value.trim().length < 2) return toast('답안을 먼저 써 주세요.');
        grade.disabled = true; fb.replaceChildren(h('p.small', '채점하는 중…'));
        try {
          const g = AI.normalizeGrade(await AI.json(AI.gradePrompt(q, ta.value.trim()), { cache: false, task: 'grade' }));
          record(g.score >= 7);
          fb.replaceChildren(h('div.grade', h('strong.gs', `${g.score}/10`), h('div',
            g.feedback ? h('p', g.feedback) : null,
            g.hit.length ? h('p.small', '잘한 점: ' + g.hit.join(', ')) : null,
            g.missing.length ? h('p.small', '빠진 점: ' + g.missing.join(', ')) : null,
            g.better ? h('details', h('summary', '고쳐 쓴 답안 보기'), h('p', g.better)) : null)), ...answerBlock());
        } catch (err) { fb.replaceChildren(h('p.small', err.friendly || '채점하지 못했어요.')); }
        finally { grade.disabled = !aiReady; }
      }, 'btn.ghost');
      control = h('div', ta, h('div.row', h('button.btn.ghost', { type: 'button', onclick: () => { fb.replaceChildren(...answerBlock(), recorded ? null : mark); } }, '정답 보기'), grade));
    }
    return h('li.card.q', h('div.qmeta', h('span.tag', q.type), q.fromJokbo ? h('span.tag', `족보 ${q.fromJokbo}번`) : h('span.tag', '난이도 ' + q.difficulty),
      q.uncertain ? h('span.tag.warn', '모범답안 확인 필요') : null, src ? h('span.small', src) : null), h('p.qtext', q.question), control, fb);
  }

  // ---------- 문제 ----------
  function flashcardDeck(cards) {
    if (!cards.length) return h('div.empty', h('p', '아직 암기 카드가 없어요.'), h('p.small', '강의 정리에 핵심 용어가 생기면 자동으로 카드가 만들어져요.'));
    let deck = [...cards], index = 0, flipped = false;
    const progress = h('span.flash-progress');
    const frontTerm = h('strong'), frontMeta = h('small'), backDef = h('p'), backMeta = h('small');
    const card = h('button.flashcard', { type: 'button', 'aria-pressed': 'false', onclick: () => { flipped = !flipped; paint(); }, onkeydown: e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipped = !flipped; paint(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
    } }, h('span.flash-face.flash-front', h('span.flash-hint', '용어'), frontTerm, frontMeta), h('span.flash-face.flash-back', h('span.flash-hint', '뜻'), backDef, backMeta));
    const move = step => { index = (index + step + deck.length) % deck.length; flipped = false; paint(); };
    const paint = () => {
      const item = deck[index]; card.classList.toggle('flipped', flipped); card.setAttribute('aria-pressed', String(flipped));
      card.setAttribute('aria-label', `${item.term} 카드, ${flipped ? '뜻 표시 중' : '용어 표시 중'}`);
      frontTerm.textContent = item.term; frontMeta.textContent = `${item.lectureNo}강 · 눌러서 뜻 보기`;
      backDef.textContent = item.definition; backMeta.textContent = `${item.lecture}${item.pages.length ? ` · p.${item.pages.join(', ')}` : ''}`;
      progress.textContent = `${index + 1} / ${deck.length}`;
    };
    const shuffle = () => { for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; } index = 0; flipped = false; paint(); toast('카드 순서를 섞었어요.'); };
    paint();
    return h('div.flash-deck',
      h('div.flash-toolbar', h('div', h('strong', '핵심 용어'), h('small', `${cards.length}장 · 추가 AI 호출 없음`)), h('div.row', progress, h('button.btn.ghost.sm', { type: 'button', onclick: shuffle }, '섞기'))),
      card,
      h('div.flash-nav', h('button.btn.ghost', { type: 'button', onclick: () => move(-1) }, '이전'), h('button.btn', { type: 'button', onclick: () => move(1) }, '다음')));
  }

  async function quizTab(c, sub) {
    const lectures = await DB.lectures(c), jokbos = await DB.jokbos(c);
    const studyCards = Study.cards(lectures);
    let att = await DB.attempts(c.id);
    const mode = sub === 'wrong' ? 'wrong' : sub === 'cards' ? 'cards' : 'new';
    const scoreText = () => (att.answered ? `누적 정답률 ${pct(att.correct, att.answered)}% (${att.correct}/${att.answered}) · 오답 ${att.wrong.length}` : '아직 푼 문제가 없어요');
    const heroSub = h('div.sh-sub', scoreText());
    const hero = h('div.section-hero', h('div.sh-eyebrow', 'Practice'), h('div.sh-title', '문제 풀기'), heroSub);
    const wrongTab = h('button', { type: 'button', 'aria-pressed': String(mode === 'wrong'), onclick: () => { location.hash = `#/c/${c.id}/quiz/wrong`; } }, `오답 노트 ${att.wrong.length}`);
    const cardTab = h('button', { type: 'button', 'aria-pressed': String(mode === 'cards'), onclick: () => { location.hash = `#/c/${c.id}/quiz/cards`; } }, `암기 카드 ${studyCards.length}`);
    const onRecord = (a, ok) => { att = a; heroSub.textContent = scoreText(); wrongTab.textContent = `오답 노트 ${a.wrong.length}`; toast(ok ? '정답! 기록했어요.' : '오답 노트에 넣었어요.', 1800); };
    const tabs = h('div.subtabs', { role: 'group', 'aria-label': '문제 보기' },
      h('button', { type: 'button', 'aria-pressed': String(mode === 'new'), onclick: () => { location.hash = `#/c/${c.id}/quiz`; } }, '새 문제'), wrongTab, cardTab);

    if (mode === 'cards') {
      coursePage(c, 'quiz', null, courseHead(c, `강의 ${lectures.length}개 · 핵심 용어 ${studyCards.length}개`), hero, tabs, flashcardDeck(studyCards));
      return;
    }

    if (mode === 'wrong') {
      coursePage(c, 'quiz', null, courseHead(c, `강의 ${lectures.length}개 · 족보 ${jokbos.length}개`), hero, tabs,
        att.wrong.length ? [h('p.lead', '틀린 문제를 다시 풀어 맞히면 오답 노트에서 빠져요.'), h('ol.questions', att.wrong.map(w => questionCard(c, w.q, onRecord)))]
          : h('div.empty', h('p', '오답 노트가 비어 있어요.'), h('p.small', '문제를 풀다 틀린 문제가 여기에 모여요.')));
      return;
    }
    const e = c.exam, exams = upcoming(c.exams);
    const target = h('select.sel', { 'aria-label': '출제 범위' },
      exams.map(ex => h('option', { value: ex.id }, `${ex.title} 범위 (${scopeOf(c, ex).length}강, ${ddayLabel(ex)})`)),
      h('option', { value: '' }, `기본 범위 (${(e.scope || c.lectures).length}강)`));
    const total = AI.QTYPES.reduce((s, t) => s + (Number(e.counts[t]) || 0), 0);
    const saved = await Store.get('quiz:' + c.id);
    const area = h('div'), status = h('p.small', { 'aria-live': 'polite' });
    let ctl = null;
    const stop = h('button.btn.quiet', { type: 'button', hidden: true, onclick: () => ctl && ctl.abort() }, '중지');
    const gen = aiButton('문제 만들기', async () => {
      const ex = c.exams.find(x => x.id === target.value), ids = scopeOf(c, ex);
      const inScope = lectures.map((l, i) => ({ ...l, no: i + 1 })).filter(l => ids.includes(l.id));
      if (!inScope.length) return toast('범위에 강의가 없어요. 강의를 올리거나 범위를 고쳐 주세요.');
      if (!total || total > 25) return toast('시험 탭에서 문항 수를 1~25개로 정해 주세요.');
      ctl = new AbortController(); gen.disabled = true; stop.hidden = false; status.textContent = '생각하는 중… (1분 가까이 걸릴 수 있어요)';
      try {
        const out = await AI.json(AI.quizPrompt({ course: c.name, lectures: inScope, exam: e, jokbo: AI.jokboDigest(jokbos.map(j => j.analysis)) }),
          { signal: ctl.signal, cache: false, task: 'quiz', onProvider: (name, provider) => { status.textContent = `${name} · ${provider}가 출제 중`; }, onText: n => { status.textContent = `문제 쓰는 중… ${n.toLocaleString()}자`; } });
        const qs = AI.normalizeQuiz(out, lectures.length);
        if (!qs.length) throw { friendly: '문제를 만들지 못했어요. 다시 시도해 주세요.' };
        await Store.set('quiz:' + c.id, { questions: qs, created: Date.now(), target: ex ? ex.title : '기본 범위' });
        status.textContent = `${ex ? ex.title + ' 범위로 ' : ''}${qs.length}문항을 만들었어요.`; renderQuiz(qs);
      } catch (err) { status.textContent = err.friendly || '문제를 만들지 못했어요.'; }
      finally { gen.disabled = !aiReady; stop.hidden = true; }
    });
    function renderQuiz(qs) {
      const score = h('p.score', { 'aria-live': 'polite' });
      let objRight = 0, objDone = 0; const obj = qs.filter(q => q.type === '객관식').length;
      const upd = () => { score.textContent = obj ? `객관식 ${objRight}/${obj} 정답 (${objDone}문제 풂)` : ''; };
      area.replaceChildren(score, h('ol.questions', qs.map(q => questionCard(c, q, (a, ok) => { onRecord(a, ok); if (q.type === '객관식') { objDone++; if (ok) objRight++; upd(); } }))));
      upd();
    }
    coursePage(c, 'quiz', null, courseHead(c, `강의 ${lectures.length}개 · 족보 ${jokbos.length}개`), hero, tabs,
      h('div.card.quiz-head',
        h('label.field', h('span', '출제 범위'), target),
        h('p.small', `${AI.QTYPES.filter(t => e.counts[t]).map(t => `${t} ${e.counts[t]}`).join(', ') || '문항 없음'}${jokbos.length ? ` · 족보 ${jokbos.length}개 경향 반영` : ''} · `, h('a', { href: `#/c/${c.id}/exam` }, '형식 바꾸기')),
        h('div.row', gen, stop), status),
      area);
    if (saved && saved.questions && saved.questions.length) { status.textContent = `지난번에 만든 ${saved.questions.length}문항이에요 (${saved.target || '기본 범위'}). 새로 만들면 바뀌어요.`; renderQuiz(saved.questions); }
    else if (!lectures.length) area.append(h('div.empty', h('p', '강의를 먼저 올려 주세요.'), h('a.btn', { href: `#/c/${c.id}/lectures` }, '강의자료 올리기')));
  }

  // ---------- 책 ----------
  async function bookTab(c) {
    const lectures = await DB.lectures(c), jokbos = await DB.jokbos(c), quiz = await Store.get('quiz:' + c.id), att = await DB.attempts(c.id);
    const pick = new Set(lectures.map(l => l.id));
    const opt = { digest: lectures.length > 1, terms: true, jokbo: jokbos.length > 0, quiz: !!(quiz && quiz.questions.length), wrong: att.wrong.length > 0 };
    const result = h('p.small', { 'aria-live': 'polite' });
    const go = h('button.btn.big', { type: 'button', onclick: async () => {
      const ls = lectures.filter(l => pick.has(l.id));
      if (!ls.length) return toast('책에 넣을 강의를 골라 주세요.');
      go.disabled = true; result.textContent = 'PDF를 만드는 중…';
      await new Promise(r => setTimeout(r, 30));
      try {
        result.textContent = 'PDF 도구를 준비하는 중…';
        await Assets.pdfExport();
        result.textContent = 'PDF를 만드는 중…';
        const r = Book.build({ course: c.name, lectures: ls, jokbos: opt.jokbo ? jokbos : [], quiz: opt.quiz ? quiz.questions : [], wrongs: opt.wrong ? att.wrong.map(w => w.q) : [], options: { terms: opt.terms, digest: opt.digest } });
        const ok = await saveFile(`${esc(c.name)} 정리집.pdf`, r.blob);
        result.textContent = ok ? `${r.pages}쪽짜리 PDF를 만들었어요.${r.missing ? ` 폰트에 없는 글자 ${r.missing}개는 ?로 표시됐어요.` : ''}` : '저장을 취소했어요.';
      } catch (err) { result.textContent = 'PDF를 만들지 못했어요: ' + (err.message || err); }
      finally { go.disabled = false; }
    } }, 'PDF 책 만들기');
    const check = (label, key, disabled, note) => h('label.check', h('input', { type: 'checkbox', checked: opt[key], disabled, onchange: ev => { opt[key] = ev.target.checked; } }), label, note ? h('span.small', ' ' + note) : null);
    coursePage(c, 'book', null,
      courseHead(c, `강의 ${lectures.length}개 · 족보 ${jokbos.length}개`),
      sectionHero('Book', '정리집 만들기', '표지, 목차, 쪽 번호가 들어간 한글 PDF 한 권'),
      lectures.length ? h('div.form',
        h('fieldset.card', h('legend', '넣을 강의'), h('div.checks', lectures.map((l, i) => h('label.check',
          h('input', { type: 'checkbox', checked: true, onchange: ev => { ev.target.checked ? pick.add(l.id) : pick.delete(l.id); } }), `${i + 1}강. ${l.summary.title}`, c.reviewed[l.id] ? h('span.pill', '복습 완료') : null)))),
        h('fieldset.card', h('legend', '함께 넣기'),
          h('div.checks',
            check('맨 앞에 시험 직전 핵심 모음', 'digest', false, '(모든 강의의 시험 포인트와 용어)'),
            check('강의별 핵심 용어', 'terms', false),
            check('족보 분석과 모범답안', 'jokbo', !jokbos.length, jokbos.length ? '' : '(족보 없음)'),
            check('연습 문제와 정답', 'quiz', !opt.quiz, opt.quiz ? `(${quiz.questions.length}문항, 정답은 책 맨 뒤)` : '(문제 탭에서 먼저 만들기)'),
            check('오답 노트', 'wrong', !att.wrong.length, att.wrong.length ? `(${att.wrong.length}문제)` : '(틀린 문제 없음)'))),
        h('div.row', go), result) : h('div.empty', h('p', '강의를 올리면 한 권으로 묶을 수 있어요.'), h('a.btn', { href: `#/c/${c.id}/lectures` }, '강의자료 올리기')));
  }

  route();
})();
