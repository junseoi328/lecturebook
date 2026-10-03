# 공개 페이지와 비슷한 보안 제한(외부 접속·eval·워커 차단) 아래에서, 가짜 Claude로 전체 흐름을 검증한다
# 실행: python tests/e2e.py [--shots 폴더]
import base64, http.server, json, pathlib, subprocess, sys, tempfile, threading, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIX = ROOT / 'tests' / 'fixtures'
SHOTS = pathlib.Path(sys.argv[sys.argv.index('--shots') + 1]) if '--shots' in sys.argv else None
CSP = ("default-src 'none'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src https://fonts.gstatic.com; img-src data: blob:; connect-src 'none'; worker-src 'none'")

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=str(ROOT / 'dist'), **k)
    def end_headers(s): s.send_header('Content-Security-Policy', CSP); super().end_headers()
    def log_message(s, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_port}/index.html'

MOCK = r"""
window.__calls = []; window.__saved = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
function pagesIn(p) { return [...new Set([...p.matchAll(/\[p\.(\d+)\]/g)].map(m => +m[1]))]; }
async function fake(prompt, opts = {}) {
  window.__calls.push({ kind: prompt.includes('시험 대비용으로 정리') ? 'lecture' : prompt.includes('기출문제(족보)') ? 'jokbo' : prompt.includes('연습 문제') ? 'quiz' : 'grade', images: opts.images ? opts.images.length : 0, bytes: new Blob([prompt]).size,
    custom: prompt.includes('사용자가 항상 원하는 정리 방식') && prompt.includes('비교표 대신'), brief: prompt.includes('핵심만 남기고') });
  const ps = pagesIn(prompt); let out;
  if (prompt.includes('시험 대비용으로 정리')) out = { title: '프로세스 스케줄링', overview: 'CPU 스케줄링 알고리즘과 평균 대기 시간을 다룬다. 똠방 學習 기호 테스트.',
    sections: [{ heading: '기본 알고리즘', points: [{ text: 'FCFS는 먼저 온 순서대로 처리하며 호위 효과(convoy effect)가 생길 수 있다.', pages: [ps[0]] }, { text: 'SJF는 평균 대기 시간이 최소다.', pages: [ps[0]] }] },
      { heading: '라운드 로빈', points: [{ text: '시간 할당량(time quantum)이 너무 작으면 문맥 교환 비용이 커진다.', pages: [ps[1] || ps[0]] }] }],
    terms: [{ term: '호위 효과 (convoy effect)', definition: '긴 작업 뒤에 짧은 작업들이 줄줄이 기다리는 현상', pages: [ps[0]] }],
    formulas: [{ expr: '평균 대기 시간 = Σ 대기 시간 / n', meaning: '프로세스들의 대기 시간 평균', pages: [ps[1] || ps[0]] }],
    examPoints: [{ text: '알고리즘별 평균 대기 시간 계산이 자주 나온다', pages: [ps[1] || ps[0]] }] };
  else if (prompt.includes('기출문제(족보)')) out = { summary: '서술형 비교 문제 중심.', typeMix: [{ type: '서술형', count: 2 }, { type: '단답형', count: 1 }],
    topics: [{ topic: 'SJF와 FCFS 비교', count: 2, lectures: [1], note: '차이를 서술' }], patterns: ['두 개념을 비교하게 한다'],
    questions: [{ no: '1', text: 'FCFS와 SJF의 차이를 서술하시오.', type: '서술형', topic: '비교', lectures: [1], modelAnswer: 'FCFS는 도착 순, SJF는 실행 시간이 짧은 순.', answerTips: '기준과 장단점을 함께', confidence: 'high' },
      { no: '3', text: '에이징이란?', type: '단답형', topic: '기아', lectures: [], modelAnswer: '오래 기다린 프로세스 우선순위를 높이는 기법', answerTips: '', confidence: 'low' }],
    predictions: [{ text: '라운드 로빈 할당량 문제', why: '강의 강조' }] };
  else if (prompt.includes('연습 문제')) out = { questions: [
    { type: '객관식', question: '평균 대기 시간이 최소인 알고리즘은?', choices: ['FCFS', 'SJF', 'RR', '우선순위'], answer: '2', explanation: 'SJF가 최소', source: { lecture: 1, pages: [1] }, difficulty: '하' },
    { type: '단답형', question: '호위 효과가 생기는 알고리즘은?', answer: 'FCFS', explanation: '', source: { lecture: 1, pages: [1] }, difficulty: '하' },
    { type: '서술형', question: '라운드 로빈 할당량의 영향을 서술하시오.', answer: '크면 FCFS, 작으면 문맥 교환 증가', rubric: ['큰 경우', '작은 경우'], source: { lecture: 1, pages: [2] }, difficulty: '중' },
    { type: '객관식', question: '잘못된 문항', choices: ['a'], answer: '3' }] };
  else out = { score: 7, hit: ['작은 경우'], missing: ['큰 경우'], feedback: '큰 할당량의 영향이 빠졌어요.', better: '할당량이 크면 FCFS처럼 되고, 작으면 문맥 교환이 늘어난다.' };
  const text = JSON.stringify(out);
  await wait(60); if (opts.onText) opts.onText({ text, delta: text }); await wait(80);
  return out;
}
const sample = async () => ({ text: 'ok', truncated: false });
sample.json = fake;
sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20000000, mediaTypes: ['image/jpeg', 'image/png'] } });
const downloads = { save: async ({ filename, data }) => {
  const buf = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new TextEncoder().encode(String(data));
  let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
  window.__saved.push({ filename, size: buf.length, b64: btoa(s) }); return { status: 'saved' }; } };
window.claude = { use: async n => (n === 'sample' ? sample : n === 'downloads' ? downloads : null) };
"""

errors, fails = [], []
def check(ok, msg): print(('통과  ' if ok else '실패  ') + msg); ok or fails.append(msg)
def shot(pg, name, full=False):
    if SHOTS: SHOTS.mkdir(parents=True, exist_ok=True); pg.screenshot(path=str(SHOTS / f'{name}.png'), full_page=full)
def wait_for(pg, fn, secs=30):
    end = time.time() + secs
    while time.time() < end:
        if fn(): return True
        pg.wait_for_timeout(200)
    return False
def pdf_text(saved):
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f: f.write(base64.b64decode(saved['b64'])); p = f.name
    info = subprocess.run(['pdfinfo', p], capture_output=True, text=True).stdout
    pages = int([l for l in info.splitlines() if l.startswith('Pages:')][0].split()[1])
    return subprocess.run(['pdftotext', '-layout', p, '-'], capture_output=True, text=True).stdout, pages, p

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}); ctx.add_init_script(MOCK)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'fonts.g' not in m.text and 'worker-src' not in m.text and errors.append(m.text))
    pg.goto(URL); pg.wait_for_timeout(800); shot(pg, '01_home')
    check(pg.inner_text('.ai-pill') == 'AI 연결됨', 'AI 연결 표시')
    check(pg.evaluate('!window.pdfjsLib && !window.jspdf && !window.JSZip && !window.Book && !window.PdfTranslate'), '첫 화면에서는 무거운 도구를 불러오지 않음')

    pg.fill('.newcourse input', '운영체제'); pg.click('button:has-text("과목 만들기")'); pg.wait_for_timeout(300)
    check('/c/' in pg.url, '과목 만들기')

    # 강의 3개: PDF(스캔 1쪽 포함), PPTX, DOCX
    check('시험 일정이 아직 없어요' in pg.inner_text('.hero'), '새 과목 홈: 시험 일정 안내')
    pg.click('.bnav a:has-text("강의")'); pg.wait_for_timeout(300)
    # 내 정리 형식: 핵심만 + 자유 형식
    pg.click('.style-card button:has-text("핵심만")'); pg.fill('.style-card textarea', '비교표 대신 차이점을 문장으로 비교해 줘'); pg.wait_for_timeout(700)
    check('핵심만 정리 · 내 형식 적용' in pg.inner_text('.style-card summary'), '내 정리 형식 저장')
    pg.set_input_files('.drop input', [str(FIX / 'os-week5.pdf'), str(FIX / 'os-week6.pptx'), str(FIX / 'os-week7.docx')])
    pg.wait_for_timeout(250); shot(pg, '02_jobs')
    check(wait_for(pg, lambda: pg.locator('.item-list .item').count() == 3, 40), '강의 3개 정리 완료 (PDF, PPTX, DOCX)')
    calls = pg.evaluate('window.__calls')
    lec = [c for c in calls if c['kind'] == 'lecture']
    check(len(lec) == 3 and lec[0]['images'] == 1, f"스캔 쪽은 이미지로 AI에 전달 (첫 파일 이미지 {lec[0]['images'] if lec else '-'}장)")
    check(all(c['bytes'] < 262144 for c in calls), '모든 호출이 256KB 이하')
    check(all(c['custom'] and c['brief'] for c in lec), '올린 모든 강의에 내 정리 형식과 분량 적용')
    shot(pg, '03_lectures')
    txt = pg.inner_text('.item-list')
    check('os-week6.pptx' in txt and '2쪽' in txt, 'PPTX 슬라이드 수 인식')

    # 강의 보기
    pg.click('.item-list .item >> nth=0 >> text=보기'); pg.wait_for_timeout(300); shot(pg, '04_lecture', True)
    check(pg.locator('.summary .pg').count() >= 3, '요점마다 근거 페이지 표시')
    pg.click('text=원문 보기 (3쪽)'); check('라운드 로빈' in pg.inner_text('.raw-body'), '원문 텍스트 보관')
    pg.click('text=PDF로 저장'); pg.wait_for_timeout(1500)
    saved = pg.evaluate('window.__saved')
    check(len(saved) == 1 and saved[0]['filename'].endswith('.pdf'), 'PDF 저장 요청')
    if saved:
        t, n, path = pdf_text(saved[0])
        check('프로세스 스케줄링' in t and '호위 효과' in t and 'p.1' in t, f'PDF 안 한글 텍스트 확인 ({n}쪽)')
        if SHOTS: subprocess.run(['pdftoppm', '-png', '-r', '60', '-f', '1', '-l', '3', path, str(SHOTS / 'pdf_lecture')])
    check('?로 바꿨어요' in pg.inner_text('#toast'), '폰트에 없는 글자 안내')

    cid = pg.url.split('#/c/')[1].split('/')[0]
    go = lambda path: (pg.goto(URL + f'#/c/{cid}' + path), pg.wait_for_timeout(350))

    # 복습 체크 → 대시보드 진도
    go('/lectures'); pg.click('.rev >> nth=0'); pg.wait_for_timeout(300)
    check(pg.get_attribute('.rev >> nth=0', 'aria-pressed') == 'true', '강의 복습 체크')

    # 시험 형식과 일정
    go('/exam')
    pg.fill('label.field.num:has-text("객관식") input', '2'); pg.fill('textarea', '서술형은 비교 문제가 나옴'); pg.wait_for_timeout(700)
    pg.fill('input[aria-label="일정 이름"]', '중간고사')
    import datetime
    d5 = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()
    pg.fill('input[aria-label="날짜"]', d5); pg.click('text=일정 추가'); pg.wait_for_timeout(500)
    check('중간고사' in pg.inner_text('.timeline') and 'D-5' in pg.inner_text('.timeline'), '시험 일정 추가와 D-day 계산')
    pg.reload(); pg.wait_for_timeout(500)
    check(pg.input_value('label.field.num:has-text("객관식") input') == '2' and '비교' in pg.input_value('textarea'), '문제 형식 자동 저장 후 유지')
    shot(pg, '05_exam', True)

    # 대시보드
    go('')
    hero = pg.inner_text('.hero')
    check('중간고사' in hero and 'D-5' in hero and '남음' in hero, '과목 홈: 다음 시험 D-day와 남은 시간')
    check('1/3' in pg.inner_text('.status-grid'), '과목 홈: 범위 복습 진도 1/3')
    shot(pg, '05b_dashboard', True)

    # 족보 (사진)
    pg.click('.bnav a:has-text("족보")'); pg.wait_for_timeout(300)
    pg.set_input_files('.drop input', str(FIX / 'jokbo-2025.jpg'))
    check(wait_for(pg, lambda: pg.locator('.item-list .item').count() == 1, 30), '족보 사진 분석 완료')
    jb = [c for c in pg.evaluate('window.__calls') if c['kind'] == 'jokbo']
    check(jb and jb[0]['images'] == 1, '족보 사진을 이미지로 전달')
    pg.click('text=분석 보기'); pg.wait_for_timeout(300)
    pg.click('.qa >> nth=1 >> summary'); shot(pg, '06_jokbo', True)
    check('확실하지 않음' in pg.inner_text('.summary') and '1강' in pg.inner_text('.topics'), '족보: 불확실 표시, 강의 연결')
    go('')
    check('SJF와 FCFS 비교' in pg.inner_text('.top3'), '과목 홈: 족보 TOP 3')

    # 문제 풀기
    go('/quiz')
    check('중간고사' in pg.inner_text('select'), '출제 범위로 시험 일정 선택')
    pg.click('text=문제 만들기')
    check(wait_for(pg, lambda: pg.locator('.q').count() > 0, 20), '문제 생성')
    check(pg.locator('.q').count() == 3, '잘못된 문항은 걸러짐 (4개 중 3개 표시)')
    pg.click('.q >> nth=0 >> .choice >> nth=0'); pg.wait_for_timeout(300)
    check('0/1' in pg.inner_text('.score') and '정답' in pg.inner_text('.q >> nth=0'), '객관식 채점과 정답 공개')
    pg.fill('.q >> nth=2 >> textarea', '작으면 문맥 교환이 많아진다'); pg.click('.q >> nth=2 >> text=AI 채점')
    check(wait_for(pg, lambda: '7/10' in pg.inner_text('.q >> nth=2'), 10), '서술형 AI 채점')
    pg.click('.q >> nth=1 >> text=정답 보기'); pg.click('.q >> nth=1 >> text=틀렸어요'); pg.wait_for_timeout(300)
    check('33%' in pg.inner_text('.section-hero') and '오답 2' in pg.inner_text('.section-hero'), '누적 정답률과 오답 수 갱신 (3문제 중 1정답)')
    check('오답 노트 2' in pg.inner_text('.subtabs'), '오답 노트 탭 숫자 즉시 갱신')
    check('null' not in pg.inner_text('.questions') and not pg.is_visible('text=중지'), '문제 화면에 빈 값 표시 없음, 중지 버튼 숨김')
    shot(pg, '07_quiz', True)

    # 책 만들기 (오답 노트 포함)
    pg.click('.bnav a:has-text("책")'); pg.wait_for_timeout(400); shot(pg, '08_book')
    pg.click('text=PDF 책 만들기')
    check(wait_for(pg, lambda: any(x.endswith('정리집.pdf') for x in pg.evaluate('window.__saved.map(s => s.filename)')), 20), '정리집 PDF 저장')
    s2 = [x for x in pg.evaluate('window.__saved') if x['filename'].endswith('정리집.pdf')][-1]
    t, n, path = pdf_text(s2)
    check(all(k in t for k in ['목차', '시험 직전 핵심 모음', '족보 분석', '연습 문제', '정답과 해설', '에이징', '오답 노트']) and n >= 9, f'정리집: 목차, 핵심 모음, 강의, 족보, 문제, 오답 노트 포함 ({n}쪽)')
    toc = t.split('시험 직전 핵심 모음')[0]
    check('목차' in toc, '목차가 핵심 모음보다 앞')
    if SHOTS: subprocess.run(['pdftoppm', '-png', '-r', '60', path, str(SHOTS / 'pdf_book')])

    # 오답 노트 다시 풀기
    go('/quiz/wrong')
    check(pg.locator('.q').count() == 2, '오답 노트에 틀린 2문제')
    pg.click('.q:has-text("평균 대기 시간") .choice:has-text("SJF")'); pg.wait_for_timeout(600)
    pg.reload(); pg.wait_for_timeout(500)  # 같은 주소라 다시 그리려면 새로고침
    check(pg.locator('.q').count() == 1, '다시 맞힌 문제는 오답 노트에서 빠짐')

    # 족보 문제 풀어보기
    go('/jokbo'); pg.click('.item-list >> text=문제 풀기'); pg.wait_for_timeout(600)
    check('/quiz' in pg.url and pg.locator('.q').count() == 2 and '족보 1번' in pg.inner_text('.questions'), '족보 문제를 연습 문제로 풀기')
    check('모범답안 확인 필요' in pg.inner_text('.questions'), '불확실한 모범답안 표시')

    # 처음 화면에서 바로 정리 → PDF 자동 저장
    pg.goto(URL); pg.wait_for_timeout(500)
    pg.set_input_files('.quick .drop input', str(FIX / 'os-week7.docx'))
    check(wait_for(pg, lambda: any('4강' in x for x in pg.evaluate('window.__saved.map(s => s.filename)')), 30), '바로 정리: 과목에 추가되고 PDF 자동 저장')
    shot(pg, '10_quick', True)

    # 저장 유지와 백업
    go(''); pg.reload(); pg.wait_for_timeout(600)
    check('강의 4개 · 족보 1개' in pg.inner_text('.course-head'), '새로고침 뒤에도 자료 유지 (IndexedDB)')
    pg.click('.tools-menu summary'); pg.click('.tools-pop button:has-text("백업 저장")'); pg.wait_for_timeout(600)
    bk = pg.evaluate('window.__saved')[-1]
    data = json.loads(base64.b64decode(bk['b64']).decode())
    check(bk['filename'].endswith('.json') and len(data['courses']) == 1 and any(k.startswith('attempts:') for k in data), '백업 파일 저장 (풀이 기록 포함)')
    pg.goto(URL); pg.wait_for_timeout(500); shot(pg, '00_home_filled', True)
    check('D-5' in pg.inner_text('.course-card') and '운영체제 중간고사' in pg.inner_text('.hero'), '처음 화면: 과목 카드 D-day, 가장 가까운 시험')

    # AI 없는 환경: 보기만 가능
    ctx2 = b.new_context(viewport={'width': 390, 'height': 844}); pg2 = ctx2.new_page(); pg2.on('pageerror', lambda e: errors.append(str(e)))
    pg2.goto(URL); pg2.wait_for_timeout(11500)
    check(pg2.inner_text('.ai-pill') == 'AI 미연결', 'AI가 없으면 미연결 표시')
    pg2.fill('.newcourse input', '테스트'); pg2.click('button:has-text("과목 만들기")'); pg2.wait_for_timeout(300)
    for route in ['', '/lectures', '/exam', '/jokbo', '/quiz', '/book']:
        pg2.goto(pg2.url.split('#')[0] + '#' + pg2.url.split('#')[1].split('/')[0] + '/' + pg2.url.split('#')[1].split('/')[1] + '/' + pg2.url.split('#')[1].split('/')[2] + route); pg2.wait_for_timeout(250)
    over = pg2.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
    check(not over, '모바일 390px 가로 넘침 없음'); shot(pg2, '09_mobile', True)
    b.close()
srv.shutdown()
check(not errors, '페이지 오류 없음 ' + str(errors[:3]))
print(f'\n{len(fails)}개 실패' if fails else '\n전부 통과'); sys.exit(1 if fails else 0)
