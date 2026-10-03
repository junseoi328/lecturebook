// 한글 PDF 만들기 (jsPDF + 내장 한글 폰트). 표지, 목차, 강의별 정리, 족보 분석, 연습 문제
const Book = (() => {
  const PW = 595.28, PH = 841.89, M = 56, W = PW - M * 2, BOTTOM = PH - 64;
  // STROKE 팔레트: 초록, 형광펜 노랑, 호박
  const INK = [26, 31, 27], MUTED = [95, 111, 100], TEAL = [29, 122, 63], AMBER = [183, 121, 31], TINT = [232, 243, 236], LINE = [226, 232, 227], DEEP = [20, 83, 45], BALL = [217, 224, 33];
  let supported = null;

  function sanitize(t, stats) {
    if (!supported) supported = new Set(window.LB_FONT.chars);
    let out = '';
    for (const ch of String(t || '')) {
      if (ch === '\n' || supported.has(ch)) out += ch;
      else if (/\s/.test(ch)) out += ' ';
      else { out += '?'; stats.missing++; }
    }
    return out;
  }
  const pageRef = pages => (pages && pages.length ? ` (p.${pages.join(', ')})` : '');

  class Writer {
    constructor(doc, stats) { this.doc = doc; this.stats = stats; this.y = M; }
    page() { this.doc.addPage(); this.y = M; }
    ensure(h) { if (this.y + h > BOTTOM) this.page(); }
    font(size, bold, color) { const d = this.doc; d.setFont('LB', bold ? 'bold' : 'normal'); d.setFontSize(size); d.setTextColor(...color); }
    lines(str, size, indent) { return this.doc.splitTextToSize(sanitize(str, this.stats), W - indent); }
    text(str, { size = 10.5, bold = false, color = INK, indent = 0, gap = 5, lh = 1.6, marker = null, markerColor = TEAL } = {}) {
      if (!str) return;
      this.font(size, bold, color);
      const ls = this.lines(str, size, indent), h = size * lh;
      ls.forEach((ln, i) => {
        this.ensure(h);
        if (i === 0 && marker) { this.font(size, true, markerColor); this.doc.text(marker, M + indent - 12, this.y + size); this.font(size, bold, color); }
        this.doc.text(ln, M + indent, this.y + size);
        this.y += h;
      });
      this.y += gap;
    }
    heading(str, { size = 13, color = INK, bar = TEAL, space = 10 } = {}) {
      this.ensure(size * 3.2);
      this.y += space;
      this.doc.setFillColor(...bar); this.doc.rect(M, this.y + 2, 3, size + 2, 'F');
      this.font(size, true, color);
      const ls = this.lines(str, size, 12);
      ls.forEach(ln => { this.doc.text(ln, M + 12, this.y + size); this.y += size * 1.5; });
      this.y += 4;
    }
    box(str, { size = 10.5 } = {}) {
      if (!str) return;
      this.font(size, false, INK);
      const ls = this.lines(str, size, 28), h = size * 1.6, bh = ls.length * h + 20;
      this.ensure(Math.min(bh, 200));
      if (this.y + bh > BOTTOM) { this.text(str, { size }); return; }
      this.doc.setFillColor(...TINT); this.doc.roundedRect(M, this.y, W, bh, 6, 6, 'F');
      ls.forEach((ln, i) => this.doc.text(ln, M + 14, this.y + 10 + size + i * h));
      this.y += bh + 10;
    }
    rule() { this.ensure(12); this.doc.setDrawColor(...LINE); this.doc.setLineWidth(0.6); this.doc.line(M, this.y + 4, M + W, this.y + 4); this.y += 12; }
  }

  function newDoc() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    doc.addFileToVFS('LB-Regular.ttf', window.LB_FONT.regular); doc.addFont('LB-Regular.ttf', 'LB', 'normal');
    doc.addFileToVFS('LB-Bold.ttf', window.LB_FONT.bold); doc.addFont('LB-Bold.ttf', 'LB', 'bold');
    doc.setFont('LB', 'normal');
    return doc;
  }

  function cover(doc, w, course, subtitle, meta) {
    doc.setFillColor(...DEEP); doc.rect(0, 0, PW, 250, 'F');
    doc.setFillColor(...TEAL); doc.rect(0, 238, PW, 12, 'F');
    doc.setFillColor(...BALL); doc.rect(M, 210, 60, 5, 'F'); doc.circle(PW - M - 20, 70, 18, 'F');
    w.font(12, false, [220, 240, 243]); doc.text(sanitize(subtitle, w.stats), M, 120);
    w.font(30, true, [255, 255, 255]);
    const t = doc.splitTextToSize(sanitize(course, w.stats), W);
    t.slice(0, 2).forEach((ln, i) => doc.text(ln, M, 160 + i * 40));
    w.font(11, false, MUTED);
    meta.forEach((ln, i) => doc.text(sanitize(ln, w.stats), M, 300 + i * 20));
    w.font(9, false, MUTED);
    doc.text(doc.splitTextToSize(sanitize('AI가 강의자료를 바탕으로 정리한 문서예요. 요점 옆의 페이지 번호로 원본을 꼭 확인하세요.', w.stats), W), M, PH - 80);
  }

  function lecture(w, l, n, opts) {
    const s = l.summary;
    w.page();
    w.font(11, true, AMBER); w.doc.text(sanitize(`${n}강`, w.stats), M, w.y + 11); w.y += 20;
    w.text(s.title, { size: 20, bold: true, gap: 4, lh: 1.35 });
    if (l.fileName) w.text(`자료: ${l.fileName}`, { size: 9, color: MUTED, gap: 10 });
    w.box(s.overview);
    for (const sec of s.sections) {
      w.heading(sec.heading);
      for (const p of sec.points) w.text(p.text + pageRef(p.pages), { indent: 14, marker: '•' });
    }
    if (opts.terms !== false && s.terms.length) {
      w.heading('핵심 용어', { bar: AMBER });
      for (const t of s.terms) { w.text(t.term, { bold: true, indent: 14, gap: 1, marker: '■', markerColor: AMBER }); w.text(t.definition + pageRef(t.pages), { indent: 14, color: INK }); }
    }
    if (s.formulas.length) {
      w.heading('공식', { bar: AMBER });
      for (const f of s.formulas) { w.text(f.expr, { bold: true, indent: 14, gap: 1 }); w.text(f.meaning + pageRef(f.pages), { indent: 14, color: MUTED }); }
    }
    if (s.examPoints.length) {
      w.heading('시험 포인트', { bar: AMBER });
      for (const p of s.examPoints) w.text(p.text + pageRef(p.pages), { indent: 14, marker: '□', markerColor: AMBER });
    }
  }

  // 모든 강의의 시험 포인트와 용어를 한곳에 (AI 호출 없이 이미 만든 정리에서 모음)
  function digestSection(w, lectures) {
    w.page();
    w.text('시험 직전 핵심 모음', { size: 20, bold: true, gap: 4, lh: 1.35 });
    w.text('강의별 시험 포인트와 핵심 용어만 모았어요. 자세한 설명은 뒤의 강의별 정리를 보세요.', { size: 9.5, color: MUTED, gap: 10 });
    lectures.forEach((l, i) => {
      const s = l.summary;
      if (!s.examPoints.length && !s.terms.length) return;
      w.heading(`${i + 1}강. ${s.title}`, { size: 12, space: 6 });
      for (const p of s.examPoints) w.text(p.text + pageRef(p.pages), { indent: 14, marker: '□', markerColor: AMBER, size: 10, gap: 3 });
      for (const t of s.terms) w.text(`${t.term}: ${t.definition}`, { indent: 14, marker: '•', size: 10, gap: 3 });
    });
  }

  function jokboSection(w, jokbos, lectureTitles) {
    w.page();
    w.text('족보 분석', { size: 20, bold: true, gap: 12, lh: 1.35 });
    for (const j of jokbos) {
      const a = j.analysis;
      w.heading(j.fileName, { size: 14 });
      w.box(a.summary);
      if (a.typeMix.length) w.text('문항 유형: ' + a.typeMix.map(t => `${t.type} ${t.count}`).join(', '), { size: 10, color: MUTED });
      if (a.topics.length) {
        w.text('자주 나온 주제', { bold: true, gap: 2 });
        for (const t of a.topics) w.text(`${t.topic} (${t.count}회)${t.lectures.length ? ' - ' + t.lectures.map(n => lectureTitles[n - 1] ? `${n}강` : '').filter(Boolean).join(', ') : ''}${t.note ? ': ' + t.note : ''}`, { indent: 14, marker: '•', size: 10 });
      }
      if (a.patterns.length) { w.text('출제 방식', { bold: true, gap: 2 }); for (const p of a.patterns) w.text(p, { indent: 14, marker: '•', size: 10 }); }
      for (const q of a.questions) {
        w.rule();
        w.text(`${q.no}. ${q.type ? '[' + q.type + '] ' : ''}${q.text}`, { bold: true, gap: 3 });
        w.text('모범답안: ' + (q.modelAnswer || '-') + (q.confidence === 'low' ? ' (확실하지 않음: 강의자료로 확인 필요)' : ''), { indent: 14, gap: 2 });
        if (q.answerTips) w.text('작성 요령: ' + q.answerTips, { indent: 14, color: MUTED, size: 10 });
      }
      if (a.predictions.length) { w.text('대비할 포인트', { bold: true, gap: 2 }); for (const p of a.predictions) w.text(p.text + (p.why ? ` (${p.why})` : ''), { indent: 14, marker: '□', markerColor: AMBER, size: 10 }); }
    }
  }

  function quizSection(w, quiz, title = '연습 문제', answerTitle = '정답과 해설') {
    w.page();
    w.text(title, { size: 20, bold: true, gap: 12, lh: 1.35 });
    quiz.forEach((q, i) => {
      w.ensure(60);
      w.text(`${i + 1}. [${q.type}·${q.difficulty}] ${q.question}`, { bold: true, gap: 3 });
      q.choices.forEach((c, k) => w.text(`${'①②③④⑤⑥⑦⑧⑨⑩'[k] || k + 1} ${c}`, { indent: 14, gap: 1 }));
      w.y += 8;
    });
    w.page();
    w.text(answerTitle, { size: 20, bold: true, gap: 12, lh: 1.35 });
    quiz.forEach((q, i) => {
      w.text(`${i + 1}. 정답: ${q.type === '객관식' ? ('①②③④⑤⑥⑦⑧⑨⑩'[Number(q.answer) - 1] || q.answer) : q.answer}`, { bold: true, gap: 2 });
      if (q.explanation) w.text(q.explanation, { indent: 14, gap: 2, size: 10 });
      if (q.rubric.length) w.text('채점 요소: ' + q.rubric.join(' / '), { indent: 14, color: MUTED, size: 9.5 });
      w.y += 4;
    });
  }

  // lectures: [{title, fileName, summary}], jokbos: [{fileName, analysis}], quiz, wrongs: [문제]
  function build({ course, lectures, jokbos = [], quiz = [], wrongs = [], options = {} }) {
    const doc = newDoc(), stats = { missing: 0 }, w = new Writer(doc, stats);
    const date = new Date().toLocaleDateString('ko-KR');
    const single = lectures.length === 1 && !jokbos.length && !quiz.length && !wrongs.length && !options.digest;
    cover(doc, w, course, single ? '강의 정리' : '시험 대비 정리집',
      [`강의 ${lectures.length}개${jokbos.length ? `, 족보 ${jokbos.length}개 분석` : ''}${quiz.length ? `, 연습 문제 ${quiz.length}개` : ''}${wrongs.length ? `, 오답 ${wrongs.length}개` : ''}`, `${date} 만듦`]);
    const sections = [];
    if (options.digest) sections.push({ label: '시험 직전 핵심 모음', run: () => digestSection(w, lectures) });
    lectures.forEach((l, i) => sections.push({ label: `${i + 1}강. ${l.summary.title}`, run: () => lecture(w, l, i + 1, options) }));
    if (jokbos.length) sections.push({ label: '족보 분석', run: () => jokboSection(w, jokbos, lectures.map(l => l.summary.title)) });
    if (quiz.length) sections.push({ label: '연습 문제와 정답', run: () => quizSection(w, quiz) });
    if (wrongs.length) sections.push({ label: '오답 노트', run: () => quizSection(w, wrongs, '오답 노트', '오답 노트 정답과 해설') });
    const tocPages = Math.max(1, Math.ceil(sections.length / 28));
    for (let i = 0; i < tocPages; i++) doc.addPage();
    // 모든 섹션은 새 쪽에서 시작한다
    const entries = sections.map(sec => { const page = doc.internal.getNumberOfPages() + 1; sec.run(); return { label: sec.label, page }; });

    // 목차
    entries.forEach((e, i) => {
      const p = 2 + Math.floor(i / 28), row = i % 28;
      doc.setPage(p);
      if (row === 0) { w.font(20, true, INK); doc.text(sanitize(i === 0 ? '목차' : '목차 (계속)', stats), M, M + 20); }
      const y = M + 64 + row * 24;
      w.font(11, false, INK);
      const label = doc.splitTextToSize(sanitize(e.label, stats), W - 50)[0];
      doc.text(label, M, y);
      w.font(11, false, MUTED); doc.text(String(e.page), M + W, y, { align: 'right' });
      doc.setDrawColor(...LINE); doc.setLineWidth(0.4); doc.line(M, y + 8, M + W, y + 8);
    });
    // 머리말, 쪽 번호
    const total = doc.internal.getNumberOfPages();
    for (let p = 2; p <= total; p++) {
      doc.setPage(p);
      w.font(8.5, false, MUTED);
      doc.text(sanitize(course, stats), M + W, 34, { align: 'right' });
      doc.text(`${p} / ${total}`, PW / 2, PH - 30, { align: 'center' });
    }
    return { blob: doc.output('blob'), pages: total, missing: stats.missing };
  }
  return { build, sanitize };
})();

window.Book = Book;
