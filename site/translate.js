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
    longDocChars: 30000, // 번역할 글이 이보다 많으면 긴 자료로 보고 묶음을 1.5배로 키운다
    longDocPages: 60,    // 쪽수가 이보다 많으면 쪽 그림을 조금 작게 만들어 파일 크기와 메모리를 줄인다
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
- _{…}는 아래첨자, ^{…}는 위첨자 표기다. 기호와 첨자는 글자 하나 바꾸지 말고 그대로 옮긴다 (예: V_{G}, E_{F}, x^{2}, φ_{ms}).
- 수식, 기호, 단위, 코드, 변수명, 약어(MOS, BFS), 화학식, 사람 이름, URL은 그대로 둔다. $나 \\ 같은 LaTeX 기호를 새로 넣지 않는다.
- 맨 앞의 글머리 기호와 번호(▪, ✓, •, -, 1. 등)는 그대로 둔다.
- 번역할 필요가 없는 항목은 원문을 그대로 돌려준다. 설명이나 주석을 덧붙이지 않는다.
- max는 그 항목이 차지할 수 있는 최대 폭이다. 폭 계산: 한글 1자=1, 영문·숫자 1자≈0.5, 공백≈0.3.
  max를 넘을 것 같으면 뜻은 유지하고 표현을 줄인다(조사·군더더기 생략, 개조식, 더 짧은 동의어).
출력: JSON 객체 하나만. 형식 {"items":[{"id":0,"ko":"..."}]}. 입력의 모든 id를 빠짐없이 포함한다.`;

  // 전자공학·컴퓨터공학 강의자료를 한국 대학 강의자료처럼 읽히게 하는 문체 지침
  const STYLE = `문체 (한국 대학의 전자공학·컴퓨터공학 강의자료처럼 쓴다)
- 영어 어순을 따라가지 말고, 그 내용을 한국어 강의자료라면 어떻게 썼을지 생각해서 다시 쓴다. 뜻을 더하거나 빼지는 않는다.
- 항목의 t가 "title"이면 명사형으로 끝나는 짧은 제목, "label"이면 그림·표에 붙는 짧은 명사구(예: 전하 없음, 전류 흐름), "text"면 본문이다.
- 한두 낱말짜리 항목은 낱말만 보고 옮기지 말고 쪽 제목과 같은 쪽의 다른 항목을 보고 뜻을 정한다 (gate: 게이트, body: 바디, current: 전류, well: 우물, table: 테이블/표).
- 긴 문단은 문장을 빼거나 합쳐 요약하지 않는다. 문장 수와 순서를 지키고, 한 문장이 너무 길면 쉼표로 호흡을 나눈다. 문단 안에서는 종결 어미를 하나로 통일한다.
- 본문은 "~한다/~이다"체나 간결한 개조식으로 쓴다. 한 자료 안에서 "~합니다"체와 섞지 않는다. 원문이 조각 문장이면 번역도 조각 문장으로 둔다.
- we, you, it, this 같은 대명사 주어는 옮기지 않는다. "그것은", "우리는", "당신은"을 쓰지 않는다.
- 번역 투를 피한다: "~되어진다", "~에 의해 ~된다", "~하는 것이다", "~에 대한 ~의", "~을 가진다", "~의 ~의 ~" 같은 표현 대신 능동문과 짧은 조사로 쓴다.
- 전공 용어는 아래 용어집과 한국어 교재에서 통용되는 말을 쓴다. 용어집에 있는 말은 반드시 그 번역어로 통일한다. 원어 병기는 하지 않는다.
- 통용되는 한국어 용어가 없는 말(약어, 제품·기법 이름, cache·stack처럼 굳은 외래어)은 억지로 풀어 쓰지 말고 음차하거나 원어 그대로 둔다.
- 기호 뒤의 조사는 기호를 소리 내어 읽었을 때에 맞추고 붙여 쓴다 (V_{G}가, E_{F}는, φ_{s}를, n이).
- 화살표(→), 콜론(:), 괄호 구조는 원문 그대로 살린다. 세미콜론(;)은 쉼표나 마침표로 바꾼다.

예시
{"en":"Saw how the work-function difference bends the bands","t":"text"} → 일함수 차이로 밴드가 휘는 원리 확인
{"en":"The oxide blocks current: the transferred charge stays on both sides","t":"text"} → 산화막이 전류를 막는다: 이동한 전하는 양쪽에 그대로 남는다
{"en":"few carriers: induced charge can deplete or invert the surface","t":"text"} → 캐리어가 적음: 유도 전하로 표면을 공핍·반전시킬 수 있음
{"en":"Threshold voltage V_{T}: the gate voltage at which φ_{s} = 2φ_{fp}","t":"text"} → 문턱 전압 V_{T}: φ_{s} = 2φ_{fp}가 되는 게이트 전압
{"en":"Where does this potential difference drop?","t":"text"} → 이 전위차는 어디에 걸리는가?
{"en":"If the quantum is too small, context-switch overhead dominates","t":"text"} → 할당량이 너무 작으면 문맥 교환 오버헤드가 대부분을 차지한다
{"en":"We can solve this recurrence with the master theorem","t":"text"} → 이 점화식은 마스터 정리로 풀 수 있다
{"en":"Why a Semiconductor? MIM vs. MOS","t":"title"} → 왜 반도체인가? MIM과 MOS 비교
{"en":"Putting It Together","t":"title"} → 종합 정리
{"en":"no charge","t":"label"} → 전하 없음
{"en":"current flows","t":"label"} → 전류 흐름`;

  // 용어집: "영어|한국어". 묶음에 실제로 나온 말만 골라 프롬프트에 넣는다. 뜻이 갈리는 말은 맥락을 적는다.
  const GLOSSARY = `
semiconductor|반도체
intrinsic|진성
extrinsic|외인성
doping|도핑
dopant|도펀트
donor|도너
acceptor|억셉터
carrier|캐리어 (반도체) / 반송파 (통신)
majority carrier|다수 캐리어
minority carrier|소수 캐리어
hole|정공
mobility|이동도
drift|드리프트
diffusion|확산
diffusion length|확산 길이
recombination|재결합
lifetime|수명
energy band|에너지 밴드
band gap|밴드갭
bandgap|밴드갭
conduction band|전도대
valence band|가전자대
fermi level|페르미 준위
quasi fermi level|준페르미 준위
vacuum level|진공 준위
work function|일함수
electron affinity|전자 친화도
band bending|밴드 휨
band diagram|밴드 다이어그램
flat band|플랫밴드
flat band voltage|플랫밴드 전압
depletion|공핍
depleted|공핍된
depletion region|공핍 영역
depletion width|공핍 폭
depletion approximation|공핍 근사
accumulation|축적
inversion|반전
strong inversion|강반전
weak inversion|약반전
inversion layer|반전층
threshold voltage|문턱 전압
surface potential|표면 전위
oxide|산화막
gate|게이트
body|바디
substrate|기판
bulk|벌크
channel|채널
source|소스
drain|드레인
junction|접합
built in potential|내부 전위
forward bias|순방향 바이어스
reverse bias|역방향 바이어스
bias|바이어스 (회로·소자) / 편향 (기계 학습)
breakdown|항복
avalanche breakdown|애벌랜치 항복
space charge|공간 전하
charge density|전하 밀도
electric field|전기장
potential|전위
electrostatics|정전기학
poisson|푸아송
capacitance|정전용량
capacitor|커패시터
schottky barrier|쇼트키 장벽
schottky diode|쇼트키 다이오드
ohmic contact|옴성 접촉
rectifying|정류성
contact resistance|접촉 저항
contact potential|접촉 전위
thermionic emission|열전자 방출
tunneling|터널링
image charge|영상 전하
barrier lowering|장벽 저하
interface|계면 (소자) / 인터페이스 (소프트웨어)
surface state|표면 상태
interface trap|계면 트랩
ionized|이온화된
insulator|절연체
dielectric|유전체
permittivity|유전율
thermal equilibrium|열평형
density of states|상태 밀도
effective mass|유효 질량
saturation|포화
saturation current|포화 전류
subthreshold|문턱전압 이하
transconductance|트랜스컨덕턴스
leakage current|누설 전류
short channel effect|단채널 효과
channel length modulation|채널 길이 변조
pinch off|핀치오프
body effect|바디 효과
emitter|이미터
collector|컬렉터
current gain|전류 이득
wafer|웨이퍼
lithography|리소그래피
etching|식각
deposition|증착
ion implantation|이온 주입
annealing|어닐링
voltage|전압
current|전류
resistance|저항
resistor|저항
inductor|인덕터
inductance|인덕턴스
impedance|임피던스
admittance|어드미턴스
wire|도선
ground|접지
short circuit|단락
open circuit|개방
voltage divider|전압 분배기
voltage drop|전압 강하
thevenin equivalent|테브난 등가 회로
norton equivalent|노턴 등가 회로
superposition|중첩
operational amplifier|연산 증폭기
op amp|연산 증폭기
amplifier|증폭기
gain|이득
feedback|피드백
small signal|소신호
large signal|대신호
frequency response|주파수 응답
bandwidth|대역폭
cutoff frequency|차단 주파수
transfer function|전달 함수
pole|극점
zero|영점 (전달 함수)
stability|안정도
phase margin|위상 여유
gain margin|이득 여유
steady state|정상 상태
transient|과도
time constant|시정수
resonance|공진
low pass|저역 통과
high pass|고역 통과
band pass|대역 통과
noise|잡음
noise margin|잡음 여유
differential|차동
common mode|공통 모드
current mirror|전류 미러
load|부하
rectifier|정류기
inverter|인버터
power dissipation|전력 소모
duty cycle|듀티 사이클
rise time|상승 시간
linear time invariant|선형 시불변
convolution|컨볼루션 (신호 처리) / 합성곱 (딥러닝)
impulse response|임펄스 응답
step response|계단 응답
fourier transform|푸리에 변환
laplace transform|라플라스 변환
sampling|샘플링
aliasing|에일리어싱
quantization|양자화
modulation|변조
demodulation|복조
power spectral density|전력 스펙트럼 밀도
signal to noise ratio|신호 대 잡음비
channel capacity|채널 용량
bit error rate|비트 오류율
electromagnetic wave|전자기파
transmission line|전송 선로
reflection coefficient|반사 계수
characteristic impedance|특성 임피던스
waveguide|도파관
magnetic field|자기장
boundary condition|경계 조건
logic gate|논리 게이트
flip flop|플립플롭
latch|래치
combinational|조합
sequential|순차
finite state machine|유한 상태 기계
multiplexer|멀티플렉서
adder|가산기
register|레지스터
clock|클록
setup time|셋업 시간
hold time|홀드 시간
propagation delay|전파 지연
pipeline|파이프라인
pipelining|파이프라이닝
data hazard|데이터 해저드
control hazard|제어 해저드
forwarding|포워딩
stall|스톨
branch prediction|분기 예측
out of order execution|비순차 실행
speculative execution|추측 실행
cache|캐시
cache miss|캐시 미스
hit rate|적중률
miss penalty|미스 페널티
memory hierarchy|메모리 계층 구조
direct mapped|직접 사상
set associative|집합 연관
virtual memory|가상 메모리
page table|페이지 테이블
instruction|명령어
instruction set|명령어 집합
datapath|데이터패스
control unit|제어 장치
interrupt|인터럽트
exception|예외
opcode|연산 코드
operand|피연산자
program counter|프로그램 카운터
two's complement|2의 보수
floating point|부동소수점
operating system|운영체제
process|프로세스 (운영체제) / 공정 (반도체 제조)
thread|스레드
scheduling|스케줄링
scheduler|스케줄러
context switch|문맥 교환
preemptive|선점형
non preemptive|비선점형
starvation|기아 상태
deadlock|교착 상태
mutual exclusion|상호 배제
critical section|임계 구역
semaphore|세마포어
mutex|뮤텍스
race condition|경쟁 상태
synchronization|동기화
condition variable|조건 변수
busy waiting|바쁜 대기
priority inversion|우선순위 역전
concurrency|병행성
parallelism|병렬성
atomic|원자적
paging|페이징
segmentation|세그먼테이션
page fault|페이지 폴트
page replacement|페이지 교체
thrashing|스래싱
fragmentation|단편화
locality|지역성
address space|주소 공간
virtual address|가상 주소
physical address|물리 주소
memory allocation|메모리 할당
file system|파일 시스템
system call|시스템 콜
kernel|커널
user mode|사용자 모드
ready queue|준비 큐
time quantum|시간 할당량
turnaround time|반환 시간
waiting time|대기 시간
response time|응답 시간
throughput|처리량
convoy effect|호위 효과
round robin|라운드 로빈
first come first served|선입 선처리
shortest job first|최단 작업 우선
algorithm|알고리즘
data structure|자료구조
time complexity|시간 복잡도
space complexity|공간 복잡도
asymptotic|점근적
upper bound|상한
lower bound|하한
array|배열
linked list|연결 리스트
priority queue|우선순위 큐
queue|큐
stack|스택
heap|힙
hash table|해시 테이블
collision|충돌
load factor|적재율
binary search tree|이진 탐색 트리
binary search|이진 탐색
balanced tree|균형 트리
traversal|순회
vertex|정점
vertices|정점
edge|간선 (그래프) / 에지 (신호)
directed graph|방향 그래프
undirected graph|무방향 그래프
adjacency list|인접 리스트
adjacency matrix|인접 행렬
connected component|연결 요소
shortest path|최단 경로
spanning tree|신장 트리
minimum spanning tree|최소 신장 트리
topological sort|위상 정렬
depth first search|깊이 우선 탐색
breadth first search|너비 우선 탐색
dynamic programming|동적 계획법
memoization|메모이제이션
optimal substructure|최적 부분 구조
greedy|그리디
divide and conquer|분할 정복
recursion|재귀
recurrence|점화식
base case|기저 사례
backtracking|백트래킹
sorting|정렬
merge sort|병합 정렬
quicksort|퀵 정렬
stable sort|안정 정렬
in place|제자리
worst case|최악의 경우
average case|평균적인 경우
amortized|분할 상환
loop invariant|루프 불변식
invariant|불변식
polynomial time|다항 시간
np complete|NP-완전
reduction|환원
pseudocode|의사코드
brute force|완전 탐색
protocol|프로토콜
packet|패킷
datagram|데이터그램
routing|라우팅
forwarding table|포워딩 테이블
congestion control|혼잡 제어
flow control|흐름 제어
congestion window|혼잡 윈도
sliding window|슬라이딩 윈도
acknowledgment|확인 응답
retransmission|재전송
handshake|핸드셰이크
latency|지연 시간
packet loss|패킷 손실
checksum|체크섬
transport layer|전송 계층
network layer|네트워크 계층
link layer|링크 계층
application layer|응용 계층
end to end|종단 간
multiplexing|다중화
encapsulation|캡슐화
payload|페이로드
transaction|트랜잭션
query|질의
schema|스키마
normalization|정규화
primary key|기본 키
foreign key|외래 키
isolation level|격리 수준
concurrency control|동시성 제어
serializability|직렬 가능성
functional dependency|함수 종속
compiler|컴파일러
parser|파서
syntax|구문
semantics|의미론
variable|변수
pointer|포인터
reference|참조
inheritance|상속
polymorphism|다형성
garbage collection|가비지 컬렉션
machine learning|기계 학습
neural network|신경망
deep learning|딥러닝
supervised learning|지도 학습
unsupervised learning|비지도 학습
reinforcement learning|강화 학습
training|학습
inference|추론
loss function|손실 함수
gradient descent|경사 하강법
stochastic gradient descent|확률적 경사 하강법
backpropagation|역전파
overfitting|과적합
regularization|정규화 (규제)
generalization|일반화
learning rate|학습률
activation function|활성화 함수
weight|가중치
hidden layer|은닉층
fully connected|완전 연결
batch normalization|배치 정규화
hyperparameter|하이퍼파라미터
classification|분류
regression|회귀
feature|특징
clustering|군집화
dimensionality reduction|차원 축소
cross entropy|교차 엔트로피
likelihood|가능도
variance|분산
eigenvalue|고윳값
eigenvector|고유벡터`.trim().split("\n").map((l) => l.split("|"));

  /** 이 묶음의 영어에 실제로 나온 용어만 고른다 (긴 말 우선, 최대 60개) */
  function glossaryFor(items) {
    const text = " " + items.map((it) => plain(it.en)).join(" ").toLowerCase().replace(/[-‐–]/g, " ") + " ";
    const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return GLOSSARY.filter(([en]) => new RegExp("[^a-z]" + esc(en) + "(?:s|es|ed|ing)?[^a-z]").test(text))
      .sort((a, b) => b[0].length - a[0].length).slice(0, 60)
      .map(([en, ko]) => `${en} → ${ko}`).join("\n");
  }

  const HEAD_TRANSLATE = `너는 전자공학·컴퓨터공학을 전공한 강의자료 번역가다. 아래 JSON 배열 각 항목의 en을, 한국 대학의 교수가 처음부터 한국어로 만든 강의자료처럼 자연스럽게 옮겨라. page는 문맥 파악용이고, 같은 page의 항목은 한 쪽에 함께 있는 내용이다.`;
  const HEAD_SHORTEN = `아래 한국어 번역(ko)이 원문 자리에 들어가기엔 길다. 각 항목을 max 폭 이하로 줄여라. 원문(en)의 핵심 뜻과 전공 용어는 반드시 남기고, 자연스러운 한국어를 유지한다.`;

  /** 프롬프트 조립. 마지막은 항상 "입력:\n" + JSON */
  function buildPrompt(shorten, items, ctx) {
    const terms = glossaryFor(items);
    return [
      shorten ? HEAD_SHORTEN : HEAD_TRANSLATE,
      RULES,
      STYLE,
      ctx.title ? `자료 제목: ${ctx.title}` : "",
      ctx.pages ? `쪽 제목 (라벨·짧은 항목은 그 쪽의 주제에 맞는 뜻으로 옮긴다)\n${ctx.pages}` : "",
      terms ? `용어집 (왼쪽 말이 나오면 오른쪽 번역어로 통일)\n${terms}` : "",
      ctx.memo ? `앞에서 이렇게 옮겼다 (같은 말은 똑같이 옮긴다)\n${ctx.memo}` : "",
    ].filter(Boolean).join("\n\n") + "\n\n입력:\n" + JSON.stringify(items);
  }

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

  const sizeOf = (it) => it.en.length + (it.ko ? it.ko.length : 0);
  /**
   * 항목을 묶음으로 나눈다. 같은 쪽의 항목은 되도록 한 묶음에 둔다(짧은 라벨이 그 쪽의 문맥과 함께 가도록).
   * 긴 자료는 묶음을 키워 요청 수를 줄인다: 무료 한도는 하루 요청 수도 세기 때문이다. 큰 묶음이 실패하면 askInBatches가 반으로 쪼갠다.
   */
  function planBatches(items) {
    const total = items.reduce((n, it) => n + sizeOf(it), 0), big = total > CFG.longDocChars;
    const maxItems = big ? CFG.batchItems * 1.5 : CFG.batchItems, maxChars = big ? CFG.batchChars * 1.5 : CFG.batchChars;
    const pages = [];                                   // 쪽별로 모은다
    for (const it of items) {
      const last = pages[pages.length - 1];
      if (last && last[0].page === it.page) last.push(it); else pages.push([it]);
    }
    const batches = [];
    let cur = [], chars = 0;
    const flush = () => { if (cur.length) { batches.push(cur); cur = []; chars = 0; } };
    for (const group of pages) {
      const size = group.reduce((n, it) => n + sizeOf(it), 0);
      if (cur.length && (cur.length + group.length > maxItems || chars + size > maxChars)) flush();
      for (const it of group) {                         // 한 쪽이 한 묶음보다 크면 그 쪽은 나눈다
        if (cur.length >= maxItems || (cur.length && chars + sizeOf(it) > maxChars)) flush();
        cur.push(it); chars += sizeOf(it);
      }
    }
    flush();
    return batches;
  }

  let lastCall = 0, gapMs = 0;
  /**
   * 묶음으로 나눠 묻는다. 요청이 실패하면 기다렸다가 다시 보내고(한도는 대개 1분 안에 풀린다), 그래도 안 되면 묶음을 반으로 쪼갠다.
   * 작은 묶음마저 끝까지 실패하면 한도가 바닥난 것으로 보고 멈춘다 → { out, stopped: true }. 받은 것은 버리지 않는다.
   */
  async function askInBatches(opt, makePrompt, items, phase) {
    const out = new Map(), progress = opt.onProgress || (() => {});
    const batches = planBatches(items);
    let done = 0;

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
          for (const x of parseJsonArray(await opt.callAI(makePrompt(pending)))) {
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
            if (opt.onItem) opt.onItem(it.id, ko);
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
      // 항목 종류: 그 쪽에서 유난히 큰 글자는 제목, 서너 낱말짜리 한 줄은 라벨, 나머지는 본문
      const sizes = mine.map((s) => s.block.size).sort((a, b) => a - b), median = sizes[(sizes.length - 1) >> 1] || 0;
      for (const s of mine) {
        const words = plain(s.en).trim().split(/\s+/).length;
        s.t = s.block.size >= 1.25 * median ? "title" : s.block.n === 1 && words <= 3 ? "label" : "text";
      }
      pages.push({ page, vp, segs: mine });
      progress({ phase: "read", done: n, total: pdf.numPages });
    }

    const state = { shortened: new Set(), stopped: false };
    const docTitle = (segs.find((s) => s.t === "title") || segs[0] || { en: "" }).en;
    const pageTitle = new Map();                        // 쪽 → 그 쪽의 제목(없으면 첫 항목)
    for (const s of segs) if (!pageTitle.has(s.page) || (s.t === "title" && pageTitle.get(s.page).t !== "title")) pageTitle.set(s.page, s);
    const wordsOf = (t) => new Set(plain(t).toLowerCase().match(/[a-z]{4,}/g) || []);

    /** 묶음에 붙일 문맥: 자료 제목, 쪽 제목, 앞에서 옮긴 짧은 말 가운데 이 묶음과 낱말이 겹치는 것(없으면 최근 것) */
    function context(items) {
      const pages = [...new Set(items.map((it) => it.page))];
      const want = wordsOf(items.map((it) => it.en).join(" ")), seen = new Set(), memo = [];
      for (let i = segs.length - 1; i >= 0; i--) {
        const s = segs[i];
        if (!s.ko || s.ko === s.en || seen.has(s.en) || plain(s.en).split(/\s+/).length > 6) continue;
        seen.add(s.en);
        let score = 0;
        for (const w of wordsOf(s.en)) if (want.has(w)) score++;
        memo.push({ s, score, recent: memo.length });
      }
      const picked = memo.filter((m) => m.score > 0 || m.recent < 8).sort((a, b) => b.score - a.score || a.recent - b.recent).slice(0, 25);
      return {
        title: docTitle,
        pages: pages.length > 1 || items.some((it) => it.t !== "title") ? pages.map((n) => `${n}쪽: ${pageTitle.get(n).en}`).join("\n") : "",
        memo: picked.map((m) => `${m.s.en} → ${m.s.ko}`).join("\n"),
      };
    }

    /** 글과 종류가 같은 항목끼리 묶는다: 쪽마다 되풀이되는 제목·라벨은 한 번만 묻고 같은 번역을 쓴다. 자리는 가장 좁은 곳에 맞춘다 */
    function groupsOf(list) {
      const groups = new Map();
      for (const s of list) {
        const key = s.t + "\n" + s.en + "\n" + (s.ko || "");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
      }
      return [...groups.values()];
    }
    const toItem = (g) => ({ id: g[0].id, page: g[0].page, t: g[0].t, en: g[0].en, max: Math.min(...g.map((s) => s.max)) });

    /** 아직 번역 안 된 문단만 번역한다. 한도에 걸려 멈췄으면 다시 부르면 이어서 한다. */
    async function translate(o) {
      o = o || {};
      if (typeof o.callAI !== "function") throw new Error("callAI 함수가 필요해요.");
      // 이미 번역된 같은 글이 있으면 묻지 않고 그대로 쓴다 (이어서 번역할 때)
      const known = new Map(segs.filter((s) => s.ko).map((s) => [s.t + "\n" + s.en, s.ko]));
      for (const s of segs) if (!s.ko && known.has(s.t + "\n" + s.en)) s.ko = known.get(s.t + "\n" + s.en);
      const groups = groupsOf(segs.filter((s) => !s.ko)), byId = new Map(groups.map((g) => [g[0].id, g]));
      state.asked = groups.length;
      // 받는 대로 바로 채워 넣는다: 다음 묶음의 "앞에서 이렇게 옮겼다"에 쓰인다
      const first = await askInBatches({ ...o, onItem: (id, ko) => { for (const s of byId.get(id)) s.ko = ko; } },
        (items) => buildPrompt(false, items, context(items)), groups.map(toItem), "translate");
      state.stopped = first.stopped;
      if (groups.length && !first.out.size) throw new Error("AI가 번역 결과를 돌려주지 않았어요. AI 설정과 사용 한도를 확인해 주세요.");

      if (o.shorten === false || state.stopped) return;
      for (let round = 0; round < CFG.shortenRounds; round++) {
        const over = groupsOf(segs.filter((s) => s.ko && textWidth(plain(s.ko)) > s.max));
        if (!over.length) break;
        const fixed = await askInBatches(o, (items) => buildPrompt(true, items, { title: docTitle }), over.map((g) => ({ ...toItem(g), ko: g[0].ko })), "shorten");
        for (const g of over) {
          const ko = fixed.out.get(g[0].id);
          if (ko && textWidth(plain(ko)) < textWidth(plain(g[0].ko))) for (const s of g) { s.ko = ko; state.shortened.add(s.id); }   // 더 짧아졌을 때만 채택
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
        const many = pages.length > CFG.longDocPages;
        const k = Math.min(CFG.maxScale, (many ? CFG.maxPx * 0.8 : CFG.maxPx) / w);
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
        doc.addImage(canvas.toDataURL("image/jpeg", many ? CFG.jpeg - 0.06 : CFG.jpeg), "JPEG", 0, 0, w, h, undefined, "FAST");
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

  return { open, translatePdf, textWidth, toLines, toBlocks, translatable, runsOf, glossaryFor, buildPrompt, planBatches, config: CFG };
});
