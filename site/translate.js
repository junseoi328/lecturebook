/*
 * translate.js — 영어 PDF를 같은 쪽 모양 그대로 한국어 PDF로 바꾼다. (브라우저 전용, 서버 불필요)
 *
 * 필요: pdf.js와 jsPDF (Assets.translate()가 먼저 불러온다)
 * 사용:
 *   const job = await PdfTranslate.open(file, opt);   // 읽기: 글자 조각 → 줄 → 문단
 *   await job.translate(opt);                         // 아직 번역 안 된 문단만 번역 (끊기면 다시 불러 이어서 한다)
 *   const { blob, report } = await job.render(opt);   // 쪽 그림 위에 덮어써서 새 PDF로
 *   opt.callAI(prompt)는 {"items":[{id,ko}]}가 담긴 JSON 문자열을 돌려준다. 앱에서는 AI.json을 감싸서 넘긴다.
 *
 * 방식: 쪽을 그림으로 그린 뒤, 영어 문단 자리를 배경색으로 덮고 그 위에 한국어를 쓴다.
 *   그래서 결과 PDF의 글자는 그림이다(선택·검색 불가). 스캔본과 그림 속 글자는 바뀌지 않는다.
 *
 * 수식: 아래첨자·위첨자는 V_{G}, x^{2} 표기로 AI에 넘기고 그대로 받아 다시 작게 그린다.
 *   수식 글꼴로 쓴 줄과 낱말이 없는 줄은 번역 대상에서 빼서 원본 그림 그대로 둔다.
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
    batchItems: 40,      // 한 번에 보내는 문단 수. 무료 한도는 하루 요청 수도 세므로 너무 잘게 나누지 않는다 (실패하면 알아서 반으로 쪼갠다)
    batchChars: 4500,
    retryWaits: [0, 12000, 30000, 60000],   // 실패한 묶음을 다시 보내기 전 기다리는 시간(ms). 무료 한도는 대개 1분 단위로 풀린다
    minGapMs: 4200,      // 요청 사이 최소 간격. 분당 15회 한도에 걸리지 않게 한다
    maxPx: 1800,         // 쪽 그림의 가로 픽셀 상한 (선명도와 파일 크기의 절충)
    maxScale: 2.5,
    jpeg: 0.88,
    lineGap: 1.45,       // 줄 간격이 글자 크기의 이 배수 이하면 같은 문단 후보로 본다
    cellGap: 1.5,        // 같은 줄에서 이만큼(글자 크기 배수) 떨어지면 다른 칸으로 본다
    scriptScale: 0.68,   // 첨자 글자 크기
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

  // ---------- 첨자 표기: V_{G}, x^{2} ----------
  const SCRIPT = /([_^])\{([^{}]*)\}/g;
  const plain = (s) => s.replace(SCRIPT, "$2");
  /** "V_{G}가" → [["V",0],["G",1],["가",0]]  (0 보통, 1 아래첨자, 2 위첨자) */
  function runsOf(word) {
    const out = [];
    let i = 0, m;
    SCRIPT.lastIndex = 0;
    while ((m = SCRIPT.exec(word))) {
      if (m.index > i) out.push([word.slice(i, m.index), 0]);
      if (m[2]) out.push([m[2].replace(/\u00a0/g, " "), m[1] === "_" ? 1 : 2]);
      i = SCRIPT.lastIndex;
    }
    if (i < word.length) out.push([word.slice(i), 0]);
    return out;
  }

  // ---------- 1) 글자 조각 → 줄 → 문단 ----------
  // ponytail: 좌표만 보는 단순 규칙이다. 세로쓰기·회전 글자는 건너뛰고, 줄 간격이 아주 넓은 문단은 줄마다 따로 번역한다.
  //           부족해지면 pdf.js의 구조 트리(page.getStructTree)나 여백 기반 단 나누기로 바꾼다.
  const BULLET = /^\s*(?:[•◦▪▫■□●○◆◇▶▸►➢➤✓✔☑‣⁃∙·*–—-]|[\uE000-\uF8FF]|\(?\d{1,2}[.)]|[a-zA-Z][.)])\s+/;
  const BULLET_ONLY = /^(?:[•◦▪▫■□●○◆◇▶▸►➢➤✓✔☑‣⁃∙·*–—-]|[\uE000-\uF8FF]|\(?\d{1,2}[.)]|[a-zA-Z][.)])$/;
  const HANGING = /(?:[,\-=+−–→(]|\b(?:the|a|an|of|to|and|or|in|on|at|by|for|with|as|is|are|be|from|that|which|its|their|this|these))$/i;   // 줄 끝이 문장 중간
  const OPEN_PAREN = /\([^)]*$/;
  const MATH_WORD = /^(?:sin|cos|tan|exp|log|max|min|lim|sinh|cosh|tanh|sqrt)$/i;

  function toLines(items, vp, util, fontOf) {
    const frags = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const t = util.transform(vp.transform, it.transform);
      if (Math.abs(t[1]) > 0.02 * Math.abs(t[0]) || t[0] <= 0) continue;   // 회전·뒤집힌 글자는 그대로 둔다
      const size = Math.hypot(t[2], t[3]);
      if (size < 3) continue;
      const font = fontOf(it.fontName);
      frags.push({ str: it.str, x: t[4], y: t[5], w: it.width * vp.scale, size, bold: font.bold, math: font.math, script: 0 });
    }
    // 같은 밑줄(baseline)끼리 한 줄
    frags.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const f of frags) {
      const row = rows.find((r) => Math.abs(r.y - f.y) < 0.1 * Math.min(r.size, f.size));
      if (row) { row.frags.push(f); row.size = Math.max(row.size, f.size); }
      else rows.push({ y: f.y, size: f.size, frags: [f] });
    }
    // 작은 글자가 큰 글자 바로 옆 위·아래에 붙어 있으면 그 줄의 첨자다 (V_G, E_F, x²)
    for (let pass = 0, moved = true; moved && pass < 4; pass++) {
      moved = false;
      for (const small of rows) {
        for (const f of small.frags.slice().sort((a, b) => a.x - b.x)) {
          const host = rows.find((r) => r !== small && f.size <= 0.85 * r.size &&
            f.y - r.y > -0.6 * r.size && f.y - r.y < 0.4 * r.size &&
            r.frags.some((h) => f.x >= h.x - 0.15 * r.size && f.x <= h.x + h.w + 0.4 * r.size));
          if (!host) continue;
          const dy = f.y - host.y;
          f.script = dy > 0.08 * host.size ? 1 : dy < -0.2 * host.size ? 2 : 0;
          small.frags.splice(small.frags.indexOf(f), 1);
          host.frags.push(f);
          moved = true;
        }
      }
    }

    const lines = [];
    for (const row of rows) {
      if (!row.frags.length) continue;
      row.frags.sort((a, b) => a.x - b.x);
      let cur = null;
      for (const f of row.frags) {
        const gap = cur ? f.x - cur.end : 0;
        const afterBullet = cur && cur.parts === 1 && BULLET_ONLY.test(cur.first) && gap < 4 * row.size;   // 글머리표와 본문 사이는 넓어도 한 줄
        if (!cur || (gap >= CFG.cellGap * row.size && !afterBullet)) {
          cur = { text: "", x: f.x, tx: f.x, end: f.x, y: row.y, size: 0, rowSize: row.size, bold: f.bold, bullet: false,
                  chars: 0, mathChars: 0, hasSub: false, hasSup: false, parts: 0, lastScript: 0 };
          lines.push(cur);
        }
        if (cur.parts === 1 && BULLET_ONLY.test(cur.first)) { cur.bullet = cur.ownBullet = true; cur.tx = f.x; cur.text = ""; }   // 글머리표 다음 조각이 본문 시작. 글머리표는 원본 그대로 둔다
        const str = f.script ? f.str.trim() : f.str;
        const space = cur.text && gap > 0.15 * row.size && !/\s$/.test(cur.text) && !/^\s/.test(str) ? " " : "";
        if (f.script && f.script === cur.lastScript && !space) cur.text = cur.text.slice(0, -1) + str + "}";   // 이어진 첨자는 한 묶음
        else cur.text += space + (f.script ? (f.script === 1 ? "_{" : "^{") + str + "}" : str);
        if (!f.script) cur.size = Math.max(cur.size, f.size);
        if (f.script === 1) cur.hasSub = true;
        if (f.script === 2) cur.hasSup = true;
        if (!cur.parts) cur.first = f.str.trim();
        cur.parts++;
        cur.lastScript = f.script;
        cur.end = Math.max(cur.end, f.x + f.w);
        cur.chars += str.length;
        if (f.math) cur.mathChars += str.length;
      }
    }
    for (const l of lines) {
      l.w = l.end - l.x;
      if (!l.size) l.size = l.rowSize;
      const m = !l.bullet && l.text.match(BULLET);
      if (m) {                                         // 글머리표가 본문과 한 조각으로 붙어 있는 경우: 폭 비율로 본문 시작을 어림한다
        l.bullet = true;
        l.tx = l.x + l.w * Math.min(0.5, textWidth(m[0]) / Math.max(1, textWidth(plain(l.text))));
      }
    }
    // 글머리표만 따로 떨어진 줄(밑줄 높이가 본문과 조금 달라 다른 줄로 묶인 경우)은 바로 오른쪽 본문 줄에 붙인다
    for (const b of lines.filter((l) => BULLET_ONLY.test(l.text.trim()))) {
      const t = lines.find((l) => l !== b && !l.bullet && l.x > b.x && l.x - b.end < 4 * l.size && Math.abs(l.y - b.y) < 0.35 * l.size);
      if (!t) continue;
      t.bullet = t.ownBullet = true; t.tx = t.x; t.w += t.x - b.x; t.x = b.x;
      lines.splice(lines.indexOf(b), 1);
    }
    return lines.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  function toBlocks(lines, pageW) {
    const sameSize = (a, b) => Math.abs(a.size - b.size) < 0.1 * a.size;
    // 1) 위치만 보고 이어질 수 있는 줄을 모은다: 같은 크기, 촘촘한 줄 간격, 본문 시작선에 맞춰 선 줄(글머리표 다음 줄은 들여쓰기된다)
    const chains = [];
    for (const l of lines) {
      const home = l.bullet ? null : chains.find((c) => {
        const last = c[c.length - 1], first = c[0], gap = l.y - last.y, tol = 0.6 * l.size;
        if (!sameSize(last, l) || gap < 0.6 * l.size || gap > CFG.lineGap * l.size) return false;
        const left = c.length > 1 ? Math.abs(l.x - last.x) < tol
          : Math.abs(l.x - first.tx) < tol || Math.abs(l.x - first.x) < tol || (!first.bullet && l.x < first.x && first.x - l.x < 3 * l.size);   // 마지막 조건: 첫 줄 들여쓰기
        const centered = Math.abs(l.x + l.w / 2 - (last.x + last.w / 2)) < tol;
        return left || centered;
      });
      if (home) home.push(l); else chains.push([l]);
    }
    // 2) 다음 줄의 첫 낱말이 앞줄 끝에 들어갈 수 있었다면 일부러 끊은 줄이다 → 다른 문단으로 나눈다
    const groups = [];
    for (const c of chains) {
      const right = Math.max(...c.map((l) => l.x + l.w)), wide = Math.max(...c.map((l) => l.w));
      let cur = [c[0]];
      for (let i = 1; i < c.length; i++) {
        const prev = c[i - 1], l = c[i];
        const tol = 0.6 * l.size;
        const aligned = Math.abs(l.x - prev.x) < tol || (cur.length === 1 && (Math.abs(l.x - cur[0].tx) < tol || (l.x < prev.x && !cur[0].bullet)));
        const room = aligned ? right - (prev.x + prev.w) : wide - prev.w;
        const firstWord = plain(l.text).trim().split(/\s+/)[0] || "";
        const need = l.w * textWidth(firstWord) / Math.max(1, textWidth(plain(l.text))) + 0.3 * l.size;
        // 앞줄이 묶음에서 가장 긴 줄이면 폭만으로는 알 수 없다. 그때는 다음 줄이 소문자 낱말로 시작하거나 앞줄이 덜 끝난 모양일 때만 잇는다
        const measured = room > 0.5 * l.size;
        const flows = /^[a-z]{2,}/.test(l.text.replace(SCRIPT, " ").trim()) || HANGING.test(prev.text.trim()) || OPEN_PAREN.test(prev.text);
        const midParagraph = cur.length >= 2 && !/[.?!:;]$/.test(prev.text.trim());   // 이미 이어지던 문단이고 앞줄이 문장 끝이 아니다
        if (need > room && prev.w >= 5 * prev.size && (measured || flows || midParagraph)) cur.push(l);
        else { groups.push(cur); cur = [l]; }
      }
      groups.push(cur);
    }
    return groups.map((ls) => {
      const n = ls.length, first = ls[0], size = first.size;
      const x1 = Math.max(...ls.map((l) => l.x + l.w));
      const cx = first.x + first.w / 2;
      const centered = n > 1
        ? !first.bullet && ls.every((l) => Math.abs(l.x + l.w / 2 - cx) < 0.35 * size) && ls.some((l) => Math.abs(l.x - first.x) > 0.6 * size)
        : Math.abs(cx - pageW / 2) < 0.03 * pageW && first.x > 0.12 * pageW;
      const start = (l) => (l.ownBullet ? l.tx : l.x);   // 덮어쓸 자리의 왼쪽 끝
      const x0 = centered ? Math.min(...ls.map((l) => l.x)) : start(first);
      const chars = ls.reduce((s, l) => s + l.chars, 0);
      return {
        text: ls.map((l) => l.text.trim()).reduce((a, t) => a + (/[A-Za-z]-$/.test(a) ? "" : " ") + t),
        n, size, bold: first.bold, centered, x0, x1, cx: (x0 + x1) / 2, y0: first.y,
        hangX: centered ? x0 : n > 1 ? Math.min(...ls.slice(1).map((l) => l.x)) : start(first),
        pitch: n > 1 ? (ls[n - 1].y - first.y) / (n - 1) : 1.25 * size,
        hasSub: ls.some((l) => l.hasSub), hasSup: ls.some((l) => l.hasSup),
        mathRatio: chars ? ls.reduce((s, l) => s + l.mathChars, 0) / chars : 0,
        rects: ls.map((l) => ({ x: start(l), y: l.y, w: l.x + l.w - start(l) })),
      };
    });
  }

  /** 번역할 문단인가: 수식 글꼴로 쓴 줄, 낱말이 없는 줄(기호·단위·수식)은 원본 그대로 둔다 */
  function translatable(b) {
    if (b.mathRatio > 0.5) return false;
    const base = b.text.replace(SCRIPT, " ");
    if (/^(?:no|on|up)$/i.test(base.trim())) return true;             // 표 칸의 짧은 낱말
    const words = (base.match(/[A-Za-z]{3,}/g) || []).filter((w) => !MATH_WORD.test(w));
    if (!words.length) return false;
    if (/[=≡≈≤≥∝]/.test(base) && words.length < 2) return false;    // 낱말이 하나 낀 수식 (Q(max) = …)
    return true;
  }

  // 문단이 담을 수 있는 폭 (한글 1자 = 1)
  function budgetOf(b) {
    const em = b.n > 1 ? ((b.x1 - b.x0) + (b.n - 1) * (b.x1 - b.hangX)) / b.size * 0.92
                       : (b.x1 - b.x0) / b.size * CFG.tolerance + CFG.slack;
    return Math.round(em * 10) / 10;
  }

  // ---------- 2) AI 호출 ----------
  const RULES = `규칙
- 문체: 제목·글머리표는 간결한 개조식/명사형, 문장은 "~한다"체.
- 전공 용어는 통용되는 한국어 용어로 옮긴다. 원어 병기는 본문에서 처음 한 번만, 제목에는 하지 않는다.
- 그림·도표 안의 짧은 라벨도 번역한다 (예: gate metal → 게이트 금속, depletion region → 공핍 영역).
- _{…}는 아래첨자, ^{…}는 위첨자 표기다. 기호와 첨자는 글자 하나 바꾸지 말고 그대로 옮긴다 (예: V_{G}, E_{F}, x^{2}, φ_{ms}).
- 수식, 기호, 단위, 코드, 변수명, 약어(MOS, BFS), 화학식, 사람 이름, URL은 그대로 둔다. $나 \\ 같은 LaTeX 기호를 새로 넣지 않는다.
- 맨 앞의 글머리 기호와 번호(▪, ✓, •, -, 1. 등)는 그대로 둔다.
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

  const aborted = (signal) => { if (signal && signal.aborted) throw new Error("중지했어요."); };
  async function sleep(ms, signal, onTick) {
    for (let left = ms; left > 0; left -= 500) {
      aborted(signal);
      if (onTick) onTick(Math.ceil(left / 1000));
      await new Promise((r) => setTimeout(r, Math.min(500, left)));
    }
    aborted(signal);
  }

  let lastCall = 0, gapMs = 0;
  /**
   * 묶음으로 나눠 묻는다. 요청이 실패하면 기다렸다가 다시 보내고(한도는 대개 1분 안에 풀린다), 그래도 안 되면 묶음을 반으로 쪼갠다.
   * 작은 묶음마저 끝까지 실패하면 한도가 바닥난 것으로 보고 멈춘다 → { out, stopped: true }. 받은 것은 버리지 않는다.
   */
  async function askInBatches(opt, prompt, items, phase) {
    const out = new Map(), progress = opt.onProgress || (() => {});
    const batches = [];
    let cur = [], chars = 0, done = 0;
    for (const it of items) {
      cur.push(it);
      chars += it.en.length + (it.ko ? it.ko.length : 0);
      if (cur.length >= CFG.batchItems || chars >= CFG.batchChars) { batches.push(cur); cur = []; chars = 0; }
    }
    if (cur.length) batches.push(cur);

    async function ask(list, depth) {
      let pending = list, failed = false;
      const echoed = new Set();
      for (let attempt = 0; attempt < CFG.retryWaits.length && pending.length; attempt++) {
        const wait = Math.max(failed ? CFG.retryWaits[attempt] : 0, lastCall + Math.max(gapMs, CFG.minGapMs) - Date.now());
        if (wait > 0) await sleep(wait, opt.signal, failed ? (s) => progress({ phase: "wait", seconds: s }) : null);
        aborted(opt.signal);
        progress({ phase, done, total: items.length });
        lastCall = Date.now();
        try {
          for (const x of parseJsonArray(await opt.callAI(prompt + JSON.stringify(pending)))) {
            if (!x || typeof x.ko !== "string" || !x.ko.trim()) continue;
            const it = pending.find((p) => p.id === Number(x.id));
            if (!it) continue;
            let ko = x.ko.trim();
            if (!BULLET.test(it.en) && BULLET.test(ko + " ")) ko = ko.replace(BULLET, "") || ko;   // 원문에 없던 글머리표를 붙여 오면 뗀다 (글머리표는 원본 그림에 남아 있다)
            const mark = it.en.match(BULLET);
            if (mark && !BULLET.test(ko + " ")) ko = mark[0] + ko;                               // 반대로 원문의 글머리표를 빼먹으면 다시 붙인다
            // 긴 영어 문장을 그대로 돌려준 것은 한 번 더 물어본다 (두 번째에도 같으면 받아들인다)
            if (phase === "translate" && ko === it.en && (it.en.match(/[A-Za-z]{3,}/g) || []).length >= 4 && !echoed.has(it.id)) { echoed.add(it.id); continue; }
            out.set(it.id, ko);
          }
          failed = false;
        } catch (e) {
          aborted(opt.signal);
          failed = true;
          gapMs = Math.min(13000, Math.max(gapMs * 2, 6500));   // 한도에 걸렸으면 요청 간격을 넓힌다 (분당 5회 한도까지 대응)
          console.warn("[translate] 묶음 실패:", e);
        }
        pending = pending.filter((it) => !out.has(it.id));   // 빠진 항목만 다시
        if (failed && attempt >= 1 && pending.length > 8 && depth < 2) break;   // 큰 묶음이 거듭 실패하면(시간 초과 등) 반으로 나눠 본다
      }
      if (!failed || !pending.length) return true;
      if (pending.length > 8 && depth < 2) {
        const half = Math.ceil(pending.length / 2);
        return (await ask(pending.slice(0, half), depth + 1)) && ask(pending.slice(half), depth + 1);
      }
      return false;
    }

    for (const batch of batches) {
      const ok = await ask(batch, 0);
      done += batch.length;
      progress({ phase, done, total: items.length });
      if (!ok) return { out, stopped: true };
    }
    return { out, stopped: false };
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

  const setFont = (ctx, px, bold) => { ctx.font = `${bold ? 700 : 400} ${px}px ${CFG.fonts}`; };
  function measure(ctx, word, px, bold) {
    let w = 0;
    for (const [t, m] of runsOf(word)) { setFont(ctx, m ? px * CFG.scriptScale : px, bold); w += ctx.measureText(t).width; }
    return w;
  }
  function drawWord(ctx, word, x, y, px, bold) {
    for (const [t, m] of runsOf(word)) {
      setFont(ctx, m ? px * CFG.scriptScale : px, bold);
      ctx.fillText(t, x, y + (m === 1 ? 0.22 * px : m === 2 ? -0.36 * px : 0));
      x += ctx.measureText(t).width;
    }
    return x;
  }

  /** 낱말 단위로 줄을 나눈다. roomOf(i)는 i번째 줄의 폭(px). 돌려주는 값: [{ words, width }] */
  function wrap(ctx, text, px, bold, roomOf) {
    const space = measure(ctx, " ", px, bold), lines = [];
    let cur = { words: [], width: 0 };
    const fresh = () => ({ words: [], width: 0 });
    const push = (word) => {
      const w = measure(ctx, word, px, bold);
      if (cur.words.length && cur.width + space + w > roomOf(lines.length)) { lines.push(cur); cur = fresh(); }
      if (!cur.words.length && w > roomOf(lines.length) && !/[_^]\{/.test(word)) {
        // 한 낱말이 줄보다 길면 글자 단위로 끊는다 (첨자가 든 낱말은 끊지 않는다)
        let part = "";
        for (const ch of word) {
          if (part && measure(ctx, part + ch, px, bold) > roomOf(lines.length)) { lines.push({ words: [part], width: measure(ctx, part, px, bold) }); part = ""; }
          part += ch;
        }
        cur = { words: [part], width: measure(ctx, part, px, bold) };
        return;
      }
      cur.width += (cur.words.length ? space : 0) + w;
      cur.words.push(word);
    };
    text.replace(SCRIPT, (m) => m.replace(/\s+/g, "\u00a0")).split(/\s+/).filter(Boolean).forEach(push);
    if (cur.words.length) lines.push(cur);
    return { lines, space };
  }

  /** 문단 하나를 덮어쓴다. 돌려주는 값: { shrunk: 글자를 줄였는지, overflow: 그래도 자리를 넘는지 } */
  function paint(ctx, k, b, ko) {
    const pad = 0.12 * b.size, up = (b.hasSup ? 1.05 : 0.85) * b.size, down = (b.hasSub ? 0.45 : 0.27) * b.size;
    const rects = b.rects.map((r) => [(r.x - pad) * k, (r.y - up - pad) * k, (r.w + 2 * pad) * k, (up + down + 2 * pad) * k]);
    const colors = rects.map((r) => sampleColors(ctx, r[0], r[1], r[2], r[3]));

    const roomOf = (i) => (b.n > 1 ? (b.x1 - (i ? b.hangX : b.x0)) * 1.02 : (b.x1 - b.x0) * CFG.tolerance + 0.75 * b.size) * k;
    let size = b.size, laid;
    for (;;) {
      laid = wrap(ctx, ko, size * k, b.bold, roomOf);
      if (laid.lines.length <= b.n || size * 0.94 < b.size * CFG.minFontScale) break;
      size *= 0.94;
    }
    rects.forEach((r, i) => { ctx.fillStyle = colors[i].bg; ctx.fillRect(r[0], r[1], r[2], r[3]); });
    ctx.fillStyle = colors[0].fg;
    ctx.textBaseline = "alphabetic";
    const pitch = b.pitch * (size / b.size);
    laid.lines.forEach((line, i) => {
      let x = b.centered ? b.cx * k - line.width / 2 : (i ? b.hangX : b.x0) * k;
      const y = (b.y0 + i * pitch) * k;
      for (const word of line.words) x = drawWord(ctx, word, x, y, size * k, b.bold) + laid.space;
    });
    return { shrunk: size < b.size, overflow: laid.lines.length > b.n };
  }

  // ---------- 작업 ----------
  /**
   * 공통 opt
   *   callAI(prompt) => Promise<string>   translate에 필수
   *   shorten        넘치면 문장 줄이기 (기본 true)
   *   onProgress({ phase, done, total, seconds })  phase: read | translate | shorten | wait | write
   *   signal         AbortSignal (중지)
   *   pdfjsLib, jsPDF                     기본은 전역
   */
  async function open(input, opt) {
    opt = opt || {};
    const pdfjs = opt.pdfjsLib || root.pdfjsLib;
    if (!pdfjs) throw new Error("pdf.js가 필요해요.");
    const progress = opt.onProgress || (() => {});

    progress({ phase: "read", done: 0, total: 1 });
    let pdf;
    try { pdf = await pdfjs.getDocument({ data: new Uint8Array(await input.arrayBuffer()) }).promise; }
    catch (e) { throw new Error(e && e.name === "PasswordException" ? "암호가 걸린 PDF는 번역할 수 없어요." : "PDF를 열지 못했어요. 파일이 맞는지 확인해 주세요."); }

    const segs = [], pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      aborted(opt.signal);
      const page = await pdf.getPage(n), vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      await page.getOperatorList();                     // 글꼴 이름(굵기·수식 글꼴 판별)을 읽을 수 있게 한다
      const fonts = new Map();
      const fontOf = (name) => {
        if (!fonts.has(name)) {
          let real = "";
          try { real = page.commonObjs.get(name).name || ""; } catch (e) { /* 아직 안 불러온 글꼴 */ }
          fonts.set(name, { bold: /bold|black|heavy|semibold/i.test(real), math: /math|stix|(?:^|\+)cm(?:mi|sy|ex)\d/i.test(real) });
        }
        return fonts.get(name);
      };
      const mine = [];
      for (const block of toBlocks(toLines(content.items, vp, pdfjs.Util, fontOf), vp.width)) {
        if (!translatable(block)) continue;
        const seg = { id: segs.length, page: n, en: block.text, ko: null, max: budgetOf(block), block };
        segs.push(seg); mine.push(seg);
      }
      pages.push({ page, vp, segs: mine });
      progress({ phase: "read", done: n, total: pdf.numPages });
    }

    const state = { shortened: new Set(), stopped: false };
    const toItem = (s) => ({ id: s.id, page: s.page, en: s.en, max: s.max });

    /** 아직 번역 안 된 문단만 번역한다. 한도에 걸려 멈췄으면 다시 부르면 이어서 한다. */
    async function translate(o) {
      o = o || {};
      if (typeof o.callAI !== "function") throw new Error("callAI 함수가 필요해요.");
      const todo = segs.filter((s) => !s.ko);
      const first = await askInBatches(o, P_TRANSLATE, todo.map(toItem), "translate");
      for (const s of todo) s.ko = first.out.get(s.id) || null;
      state.stopped = first.stopped;
      if (todo.length && !first.out.size) throw new Error("AI가 번역 결과를 돌려주지 않았어요. AI 설정과 사용 한도를 확인해 주세요.");

      if (o.shorten === false || state.stopped) return;
      for (let round = 0; round < CFG.shortenRounds; round++) {
        const over = segs.filter((s) => s.ko && textWidth(plain(s.ko)) > s.max);
        if (!over.length) break;
        const fixed = await askInBatches(o, P_SHORTEN, over.map((s) => ({ ...toItem(s), ko: s.ko })), "shorten");
        for (const s of over) {
          const ko = fixed.out.get(s.id);
          if (ko && textWidth(plain(ko)) < textWidth(plain(s.ko))) { s.ko = ko; state.shortened.add(s.id); }   // 더 짧아졌을 때만 채택
        }
        if (fixed.stopped) break;                       // 줄이기는 못 해도 번역은 끝났으니 그대로 둔다
      }
    }

    /** 쪽마다 그림으로 그리고 덮어쓴 뒤 새 PDF에 넣는다 */
    async function render(o) {
      o = o || {};
      const JsPDF = o.jsPDF || (root.jspdf && root.jspdf.jsPDF);
      if (!JsPDF) throw new Error("jsPDF가 필요해요.");
      const prog = o.onProgress || (() => {});
      const same = (a, b) => plain(a).replace(/\s+/g, "") === plain(b).replace(/\s+/g, "");
      const missing = segs.filter((s) => !s.ko);
      const report = { pages: pdf.numPages, segments: segs.length, translated: 0, shrunk: 0, checkPages: [],
                       shortened: state.shortened.size, untranslated: missing.length, stopped: state.stopped,
                       untranslatedPages: [...new Set(missing.map((s) => s.page))] };
      if (!segs.length) return { blob: null, report };

      let doc = null;
      const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
      for (let i = 0; i < pages.length; i++) {
        aborted(o.signal);
        prog({ phase: "write", done: i, total: pages.length });
        const { page, vp } = pages[i], w = vp.width, h = vp.height;
        const k = Math.min(CFG.maxScale, CFG.maxPx / w);
        canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: k }) }).promise;
        let flagged = false;
        for (const s of pages[i].segs) {
          if (!s.ko || same(s.ko, s.en)) continue;      // 번역 실패, 또는 수식·기호처럼 그대로 둘 항목: 원본 그림을 건드리지 않는다
          const r = paint(ctx, k, s.block, s.ko);
          report.translated++;
          if (r.shrunk) report.shrunk++;
          if (r.overflow) flagged = true;
        }
        if (flagged) report.checkPages.push(i + 1);
        const dir = w > h ? "l" : "p";
        if (doc) doc.addPage([w, h], dir); else doc = new JsPDF({ unit: "pt", format: [w, h], orientation: dir, compress: true });
        doc.addImage(canvas.toDataURL("image/jpeg", CFG.jpeg), "JPEG", 0, 0, w, h, undefined, "FAST");
      }
      canvas.width = canvas.height = 0;
      prog({ phase: "write", done: pages.length, total: pages.length });
      return { blob: doc.output("blob"), report };
    }

    return { segments: segs, translate, render };
  }

  /** 한 번에: 읽기 → 번역 → 만들기 */
  async function translatePdf(input, opt) {
    const job = await open(input, opt);
    if (job.segments.length) await job.translate(opt);
    return job.render(opt);
  }

  return { open, translatePdf, textWidth, toLines, toBlocks, translatable, runsOf, config: CFG };
});
