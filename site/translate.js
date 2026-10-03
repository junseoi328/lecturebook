/*
 * translate.js — 영어 PDF를 같은 쪽 모양 그대로 한국어 PDF로 바꾼다. (브라우저 전용, 서버 불필요)
 *
 * 필요: pdf.js와 jsPDF (Assets.translate()가 먼저 불러온다)
 * 사용: const { blob, report } = await PdfTranslate.translatePdf(file, { callAI, onProgress, signal });
 *   callAI(prompt)는 {"items":[{id,ko}]}가 담긴 JSON 문자열을 돌려준다. 앱에서는 AI.json을 감싸서 넘긴다.
 *
 * 방식: 쪽을 그림으로 그린 뒤, 영어 문단 자리를 배경색으로 덮고 그 위에 한국어를 쓴다.
 *   그래서 결과 PDF의 글자는 그림이다(선택·검색 불가). 스캔본과 그림 속 글자는 바뀌지 않는다.
 *
 * 깨짐 방지 3단계
 *   1) 번역할 때부터 문단마다 "원문이 차지하던 자리"를 예산(max)으로 준다.
 *   2) 그래도 넘친 문단만 모아 AI에게 뜻을 유지한 채 줄여 달라고 다시 요청한다(최대 2회).
 *   3) 끝까지 넘치는 문단만 글자 크기를 줄인다(하한 70%).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PdfTranslate = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const root = typeof self !== "undefined" ? self : globalThis;
  const CFG = {
    tolerance: 1.1,      // 한 줄짜리는 원문 폭의 110%까지 허용 (대부분 옆에 여백이 있음)
    slack: 1.5,          // 짧은 라벨용 여유 (한글 1.5자)
    shortenRounds: 2,    // 줄이기 재요청 횟수
    minFontScale: 0.7,   // 글자 축소 하한
    batchItems: 50,
    batchChars: 5000,
    maxPx: 1800,         // 쪽 그림의 가로 픽셀 상한 (선명도와 파일 크기의 절충)
    maxScale: 2.5,
    jpeg: 0.88,
    lineGap: 1.45,       // 줄 간격이 글자 크기의 이 배수 이하면 같은 문단으로 본다
    cellGap: 1.5,        // 같은 줄에서 이만큼(글자 크기 배수) 떨어지면 다른 칸으로 본다
    fonts: '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR","Noto Sans CJK KR",sans-serif',
  };

  // ---------- 글자 폭 추정 (단위: 한글 1자 = 1) ----------
  function textWidth(s) {
    let w = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c >= 0x1100) w += 1;                         // 한글·한자·전각
      else if (ch === " ") w += 0.28;
      else if ("iljtfrI.,;:'!|()[]".includes(ch)) w += 0.3;
      else if (c >= 65 && c <= 90) w += 0.67;          // 대문자
      else if ("mwMW".includes(ch)) w += 0.8;
      else w += 0.52;                                  // 소문자·숫자·기호
    }
    return w;
  }

  // ---------- 1) 글자 조각 → 줄 → 문단 ----------
  // ponytail: 좌표만 보는 단순 규칙이다. 줄 간격이 넓은 문단, 촘촘한 표, 세로쓰기·회전 글자는 문단으로 못 묶거나 건너뛴다.
  //           부족해지면 pdf.js의 구조 트리(page.getStructTree)나 여백 기반 단 나누기로 바꾼다.
  const HAS_EN = /[A-Za-z]{2,}/;
  const BULLET = /^\s*(?:[•◦▪▫■□●○◆◇▶▸►–—·*-]|\(?\d{1,2}[.)]|[a-zA-Z][.)])\s/;

  function toLines(items, vp, util, isBold) {
    const frags = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const t = util.transform(vp.transform, it.transform);
      if (Math.abs(t[1]) > 0.02 * Math.abs(t[0]) || t[0] <= 0) continue;   // 회전·뒤집힌 글자는 그대로 둔다
      const size = Math.hypot(t[2], t[3]);
      if (size < 4) continue;
      frags.push({ str: it.str, x: t[4], y: t[5], w: it.width * vp.scale, size, bold: isBold(it.fontName) });
    }
    frags.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const f of frags) {
      const row = rows.find((r) => Math.abs(r.y - f.y) < 0.3 * Math.min(r.size, f.size));
      if (row) row.frags.push(f); else rows.push({ y: f.y, size: f.size, frags: [f] });
    }
    const lines = [];
    for (const row of rows) {
      row.frags.sort((a, b) => a.x - b.x);
      let cur = null;
      for (const f of row.frags) {
        const gap = cur ? f.x - (cur.x + cur.w) : 0;
        if (cur && gap < CFG.cellGap * f.size) {
          cur.text += (gap > 0.15 * f.size && !/\s$/.test(cur.text) && !/^\s/.test(f.str) ? " " : "") + f.str;
          cur.w = Math.max(cur.w, f.x + f.w - cur.x);
          cur.size = Math.max(cur.size, f.size);
        } else {
          cur = { text: f.str, x: f.x, y: f.y, w: f.w, size: f.size, bold: f.bold };
          lines.push(cur);
        }
      }
    }
    return lines.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  function toBlocks(lines, pageW) {
    const sameSize = (a, b) => Math.abs(a.size - b.size) < 0.1 * a.size;
    // 줄이 "꽉 찼는지": 같은 크기로 겹쳐 놓인 줄들의 오른쪽 끝에 닿았으면 다음 줄로 넘어간 문장이다
    const rightBound = (l) => Math.max(...lines.filter((o) => sameSize(o, l) && o.x < l.x + l.w && o.x + o.w > l.x).map((o) => o.x + o.w));
    const isFull = (l) => l.w >= 0.8 * (rightBound(l) - l.x);

    const blocks = [];
    for (const l of lines) {
      const home = BULLET.test(l.text) ? null : blocks.find((b) => {
        const last = b.lines[b.lines.length - 1], first = b.lines[0], gap = l.y - last.y;
        if (!sameSize(last, l) || gap < 0.6 * l.size || gap > CFG.lineGap * l.size) return false;
        const ref = b.lines.length > 1 ? last : first;
        const indent = (l.x - ref.x) / l.size;
        const hanging = b.lines.length === 1 && BULLET.test(first.text);   // 글머리표 다음 줄은 들여쓰기된다
        const leftAligned = indent > -0.6 && indent < (hanging ? 2.5 : 0.6) && isFull(last);
        const centered = Math.abs(l.x + l.w / 2 - (last.x + last.w / 2)) < 0.6 * l.size && Math.abs(indent) > 0.6;
        return leftAligned || centered;
      });
      if (home) home.lines.push(l); else blocks.push({ lines: [l] });
    }
    return blocks.map((b) => {
      const ls = b.lines, n = ls.length, first = ls[0], size = first.size;
      const x0 = Math.min(...ls.map((l) => l.x)), x1 = Math.max(...ls.map((l) => l.x + l.w));
      const cx = first.x + first.w / 2;
      const centered = n > 1
        ? ls.every((l) => Math.abs(l.x + l.w / 2 - cx) < 0.6 * size) && ls.some((l) => Math.abs(l.x - first.x) > 0.6 * size)
        : Math.abs(cx - pageW / 2) < 0.03 * pageW && x0 > 0.12 * pageW;
      return {
        text: ls.map((l) => l.text.trim()).join(" "), n, size, bold: first.bold, centered,
        x0, x1, cx: (x0 + x1) / 2, y0: first.y,
        pitch: n > 1 ? (ls[n - 1].y - first.y) / (n - 1) : 1.25 * size,
      };
    });
  }

  // 문단이 담을 수 있는 폭 (한글 1자 = 1)
  function budgetOf(b) {
    const em = (b.x1 - b.x0) / b.size;
    return Math.round((b.n > 1 ? em * b.n * 0.92 : em * CFG.tolerance + CFG.slack) * 10) / 10;
  }

  // ---------- 2) AI 호출 ----------
  const RULES = `규칙
- 문체: 제목·글머리표는 간결한 개조식/명사형, 문장은 "~한다"체.
- 전공 용어는 통용되는 한국어 용어로 옮긴다. 원어 병기는 본문에서 처음 한 번만, 제목에는 하지 않는다.
- 코드, 변수명, 함수명, 수식, 복잡도 표기(O(n log n)), 약어(BFS, DP), 고유명사, URL은 그대로 둔다.
- 맨 앞의 글머리 기호와 번호(•, -, 1., a) 등)는 그대로 둔다.
- 번역할 필요가 없는 항목은 원문을 그대로 돌려준다.
- 같은 용어는 전체에서 같은 번역어를 쓴다. 설명을 덧붙이지 않는다.
- max는 그 항목이 차지할 수 있는 최대 폭이다. 폭 계산: 한글 1자=1, 영문·숫자 1자≈0.5, 공백≈0.3.
  max를 넘을 것 같으면 뜻은 유지하고 표현을 줄인다(조사·군더더기 생략, 개조식, 원어 병기 생략, 더 짧은 동의어).
출력: JSON 객체 하나만. 형식 {"items":[{"id":0,"ko":"..."}]}. 입력의 모든 id를 빠짐없이 포함한다.`;

  const P_TRANSLATE = `너는 대학 강의자료 전문 번역가다. 아래 JSON 배열 각 항목의 en을 자연스러운 한국어로 번역해라. page는 문맥 파악용이다.\n\n${RULES}\n\n입력:\n`;
  const P_SHORTEN = `아래 한국어 번역(ko)이 원문 자리에 들어가기엔 길다. 각 항목을 max 폭 이하로 줄여라. 원문(en)의 핵심 뜻은 반드시 남긴다.\n\n${RULES}\n\n입력:\n`;

  function parseJsonArray(text) {
    const t = String(text).replace(/```(?:json)?/g, "");
    const a = t.indexOf("["), b = t.lastIndexOf("]");
    if (a < 0 || b < a) throw new Error("AI 응답에서 JSON 배열을 찾지 못했어요.");
    return JSON.parse(t.slice(a, b + 1));
  }

  async function askInBatches(callAI, prompt, items, onBatch, signal) {
    const out = new Map();
    const batches = [];
    let cur = [], chars = 0;
    for (const it of items) {
      cur.push(it);
      chars += it.en.length + (it.ko ? it.ko.length : 0);
      if (cur.length >= CFG.batchItems || chars >= CFG.batchChars) { batches.push(cur); cur = []; chars = 0; }
    }
    if (cur.length) batches.push(cur);

    let done = 0;
    for (const batch of batches) {
      let pending = batch;
      for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
        if (signal && signal.aborted) throw new Error("중지했어요.");
        try {
          for (const x of parseJsonArray(await callAI(prompt + JSON.stringify(pending)))) {
            if (x && typeof x.ko === "string" && x.ko.trim()) out.set(Number(x.id), x.ko.trim());
          }
        } catch (e) {
          if (attempt === 1) console.warn("[translate] 배치 실패:", e);
        }
        pending = pending.filter((it) => !out.has(it.id));   // 빠진 항목만 한 번 더
      }
      done += batch.length;
      if (onBatch) onBatch(done, items.length);
    }
    return out;
  }

  // ---------- 3) 쪽 그림 위에 덮어쓰기 ----------
  // 영역에서 가장 흔한 색을 배경, 배경과 가장 다른 색을 글자색으로 본다.
  // ponytail: 사진·그라데이션 위의 글자는 덮은 자리가 네모로 보인다. 필요해지면 주변 픽셀로 메우는 방식으로 바꾼다.
  function sampleColors(ctx, x, y, w, h) {
    x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
    w = Math.min(ctx.canvas.width - x, Math.ceil(w)); h = Math.min(ctx.canvas.height - y, Math.ceil(h));
    const fallback = { bg: "#ffffff", fg: "#111111" };
    if (w < 2 || h < 2) return fallback;
    const d = ctx.getImageData(x, y, w, h).data, buckets = new Map();
    for (let i = 0; i < d.length; i += 8) {            // 한 픽셀 건너 하나씩
      const key = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3);
      const b = buckets.get(key) || [0, 0, 0, 0];
      b[0]++; b[1] += d[i]; b[2] += d[i + 1]; b[3] += d[i + 2];
      buckets.set(key, b);
    }
    const all = [...buckets.values()].map(([n, r, g, b]) => ({ n, r: r / n, g: g / n, b: b / n }));
    const total = all.reduce((s, c) => s + c.n, 0);
    const bg = all.reduce((a, c) => (c.n > a.n ? c : a));
    const dist = (c) => Math.abs(c.r - bg.r) + Math.abs(c.g - bg.g) + Math.abs(c.b - bg.b);
    const ink = all.filter((c) => c.n >= Math.max(2, total * 0.004) && dist(c) > 90).sort((a, c) => dist(c) - dist(a))[0];
    const css = (c) => `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;
    return { bg: css(bg), fg: ink ? css(ink) : bg.r + bg.g + bg.b > 384 ? "#111111" : "#ffffff" };
  }

  function wrap(ctx, text, maxW) {
    const lines = [];
    let cur = "";
    const push = (word) => {
      const next = cur ? cur + " " + word : word;
      if (ctx.measureText(next).width <= maxW) { cur = next; return; }
      if (cur) { lines.push(cur); cur = ""; }
      if (ctx.measureText(word).width <= maxW) { cur = word; return; }
      for (const ch of word) {                         // 한 낱말이 줄보다 길면 글자 단위로 끊는다
        if (cur && ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ""; }
        cur += ch;
      }
    };
    text.split(/\s+/).filter(Boolean).forEach(push);
    if (cur) lines.push(cur);
    return lines;
  }

  /** 문단 하나를 덮어쓴다. 돌려주는 값: { shrunk: 글자를 줄였는지, overflow: 그래도 자리를 넘는지 } */
  function paint(ctx, k, b, ko) {
    const pad = 0.12 * b.size;
    const rx = (b.x0 - pad) * k, ry = (b.y0 - 0.85 * b.size - pad) * k;
    const rw = (b.x1 - b.x0 + 2 * pad) * k, rh = ((b.n - 1) * b.pitch + 1.12 * b.size + 2 * pad) * k;
    const { bg, fg } = sampleColors(ctx, rx, ry, rw, rh);

    const room = b.n > 1 ? (b.x1 - b.x0) * 1.02 : (b.x1 - b.x0) * CFG.tolerance + 0.75 * b.size;
    let size = b.size, lines;
    for (;;) {
      ctx.font = `${b.bold ? 700 : 400} ${size * k}px ${CFG.fonts}`;
      lines = wrap(ctx, ko, room * k);
      if (lines.length <= b.n || size * 0.94 < b.size * CFG.minFontScale) break;
      size *= 0.94;
    }
    ctx.fillStyle = bg;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.fillStyle = fg;
    ctx.textBaseline = "alphabetic";
    const pitch = b.pitch * (size / b.size);
    lines.forEach((line, i) => {
      const x = b.centered ? b.cx * k - ctx.measureText(line).width / 2 : b.x0 * k;
      ctx.fillText(line, x, (b.y0 + i * pitch) * k);
    });
    return { shrunk: size < b.size, overflow: lines.length > b.n };
  }

  // ---------- 메인 ----------
  /**
   * @param {File|Blob} input 원본 .pdf
   * @param {object} opt
   *   callAI(prompt) => Promise<string>   필수
   *   shorten        넘치면 문장 줄이기 (기본 true)
   *   onProgress({ phase, done, total })  phase: read | translate | shorten | write
   *   signal         AbortSignal (중지)
   *   pdfjsLib, jsPDF                     기본은 전역
   */
  async function translatePdf(input, opt) {
    opt = opt || {};
    const pdfjs = opt.pdfjsLib || root.pdfjsLib, JsPDF = opt.jsPDF || (root.jspdf && root.jspdf.jsPDF);
    if (!pdfjs || !JsPDF) throw new Error("pdf.js와 jsPDF가 필요해요.");
    if (typeof opt.callAI !== "function") throw new Error("callAI 함수가 필요해요.");
    const progress = opt.onProgress || (() => {});
    const stopIfAborted = () => { if (opt.signal && opt.signal.aborted) throw new Error("중지했어요."); };

    progress({ phase: "read", done: 0, total: 1 });
    let pdf;
    try { pdf = await pdfjs.getDocument({ data: new Uint8Array(await input.arrayBuffer()) }).promise; }
    catch (e) { throw new Error(e && e.name === "PasswordException" ? "암호가 걸린 PDF는 번역할 수 없어요." : "PDF를 열지 못했어요. 파일이 맞는지 확인해 주세요."); }

    const segs = [], pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      stopIfAborted();
      const page = await pdf.getPage(n), vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      await page.getOperatorList();                     // 글꼴 이름(굵기 판별)을 읽을 수 있게 한다
      const isBold = (name) => { try { return /bold|black|heavy|semibold/i.test(page.commonObjs.get(name).name); } catch (e) { return false; } };
      const mine = [];
      for (const block of toBlocks(toLines(content.items, vp, pdfjs.Util, isBold), vp.width)) {
        if (!HAS_EN.test(block.text)) continue;
        const seg = { id: segs.length, page: n, en: block.text, ko: null, max: budgetOf(block), block };
        segs.push(seg); mine.push(seg);
      }
      pages.push({ page, vp, segs: mine });
      progress({ phase: "read", done: n, total: pdf.numPages });
    }

    const report = { pages: pdf.numPages, segments: segs.length, translated: 0, untranslated: 0, shortened: 0, shrunk: 0, checkPages: [] };
    if (!segs.length) return { blob: null, report };

    // 번역
    const toItem = (s) => ({ id: s.id, page: s.page, en: s.en, max: s.max });
    const first = await askInBatches(opt.callAI, P_TRANSLATE, segs.map(toItem),
      (done, total) => progress({ phase: "translate", done, total }), opt.signal);
    for (const s of segs) s.ko = first.get(s.id) || null;
    if (!first.size) throw new Error("AI가 번역 결과를 돌려주지 않았어요. AI 설정을 확인해 주세요.");

    // 넘치는 문단만 줄이기
    if (opt.shorten !== false) {
      const touched = new Set();
      for (let round = 0; round < CFG.shortenRounds; round++) {
        const over = segs.filter((s) => s.ko && textWidth(s.ko) > s.max);
        if (!over.length) break;
        const fixed = await askInBatches(opt.callAI, P_SHORTEN, over.map((s) => ({ ...toItem(s), ko: s.ko })),
          (done, total) => progress({ phase: "shorten", done, total }), opt.signal);
        for (const s of over) {
          const ko = fixed.get(s.id);
          if (ko && textWidth(ko) < textWidth(s.ko)) { s.ko = ko; touched.add(s.id); }   // 더 짧아졌을 때만 채택
        }
      }
      report.shortened = touched.size;
    }

    // 쪽마다 그림으로 그리고 덮어쓴 뒤 새 PDF에 넣는다
    let doc = null;
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    for (let i = 0; i < pages.length; i++) {
      stopIfAborted();
      progress({ phase: "write", done: i, total: pages.length });
      const { page, vp } = pages[i], w = vp.width, h = vp.height;
      const k = Math.min(CFG.maxScale, CFG.maxPx / w);
      canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: k }) }).promise;
      let flagged = false;
      for (const s of pages[i].segs) {
        if (!s.ko) { report.untranslated++; continue; }
        if (s.ko === s.en) continue;                    // 코드·수식처럼 그대로 둘 항목
        const r = paint(ctx, k, s.block, s.ko);
        report.translated++;
        if (r.shrunk) report.shrunk++;
        if (r.overflow) flagged = true;
      }
      if (flagged) report.checkPages.push(i + 1);
      const dir = w > h ? "l" : "p";
      if (doc) doc.addPage([w, h], dir); else doc = new JsPDF({ unit: "pt", format: [w, h], orientation: dir, compress: true });
      doc.addImage(canvas.toDataURL("image/jpeg", CFG.jpeg), "JPEG", 0, 0, w, h, undefined, "FAST");
      page.cleanup();
    }
    canvas.width = canvas.height = 0;
    progress({ phase: "write", done: pages.length, total: pages.length });
    return { blob: doc.output("blob"), report };
  }

  return { translatePdf, textWidth, toLines, toBlocks, config: CFG };
});
