/*
 * pptx-translate.js — 영어 PPTX를 같은 디자인 그대로 한국어 PPTX로 바꾼다. (브라우저 전용 로직, 서버 불필요)
 *
 * 필요: JSZip (Assets.zip()으로 먼저 불러온다)
 * 사용: const { blob, report } = await PptxTranslate.translatePptx(file, { callAI, onProgress, signal });
 *   callAI(prompt)는 {"items":[{id,ko}]}가 담긴 JSON 문자열을 돌려준다. 앱에서는 AI.json을 감싸서 넘긴다.
 *
 * 깨짐 방지 3단계
 *   1) 번역할 때부터 조각마다 "원문이 차지하던 폭"을 예산(max)으로 준다.
 *   2) 그래도 넘친 조각만 모아 AI에게 뜻을 유지한 채 줄여 달라고 다시 요청한다(최대 2회).
 *   3) 끝까지 넘치는 글상자만 글자 크기를 줄인다(하한 70%).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PptxTranslate = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

  const CFG = {
    tolerance: 1.1,      // 원문 폭의 110%까지는 허용 (대부분의 글상자에 여백이 있음)
    slack: 1.5,          // 짧은 라벨용 여유 (한글 1.5자)
    shortenRounds: 2,    // 줄이기 재요청 횟수
    minFontScale: 0.7,   // 글자 축소 하한
    batchItems: 50,
    batchChars: 5000,
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
  const budgetOf = (en) => Math.round((textWidth(en) * CFG.tolerance + CFG.slack) * 10) / 10;

  // ---------- XML 도우미 ----------
  const parse = (xml) => new DOMParser().parseFromString(xml, "application/xml");
  const serialize = (doc) =>
    XML_HEAD + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, "");
  const kids = (el, name) =>
    Array.from(el.childNodes).filter((n) => n.nodeType === 1 && n.namespaceURI === A && n.localName === name);
  const kid = (el, name) => kids(el, name)[0] || null;

  function resolvePath(baseDir, target) {
    if (target.startsWith("/")) return target.slice(1);
    const parts = baseDir.split("/").filter(Boolean);
    for (const p of target.split("/")) {
      if (p === "..") parts.pop();
      else if (p !== ".") parts.push(p);
    }
    return parts.join("/");
  }

  async function readRels(zip, partPath) {
    const i = partPath.lastIndexOf("/");
    const relPath = partPath.slice(0, i) + "/_rels/" + partPath.slice(i + 1) + ".rels";
    const f = zip.file(relPath);
    if (!f) return [];
    const doc = parse(await f.async("string"));
    return Array.from(doc.getElementsByTagName("Relationship")).map((r) => ({
      id: r.getAttribute("Id"),
      type: r.getAttribute("Type") || "",
      path: resolvePath(partPath.slice(0, i), r.getAttribute("Target") || ""),
      external: r.getAttribute("TargetMode") === "External",
    }));
  }

  async function slidePathsInOrder(zip) {
    try {
      const pres = parse(await zip.file("ppt/presentation.xml").async("string"));
      const rels = await readRels(zip, "ppt/presentation.xml");
      const byId = Object.fromEntries(rels.map((r) => [r.id, r.path]));
      const ids = Array.from(pres.getElementsByTagName("*"))
        .filter((e) => e.localName === "sldId")
        .map((e) => e.getAttributeNS(R, "id") || e.getAttribute("r:id"));
      const paths = ids.map((id) => byId[id]).filter((p) => p && zip.file(p));
      if (paths.length) return paths;
    } catch (e) { /* 아래 대체 경로 사용 */ }
    const num = (p) => parseInt(p.match(/(\d+)\.xml$/)[1], 10);
    return Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => num(a) - num(b));
  }

  // ---------- 1) 번역 대상 수집 ----------
  const HAS_EN = /[A-Za-z]{2,}/;

  function collect(doc, slideNo, isNotes, segs) {
    const bodies = [];
    for (const el of Array.from(doc.getElementsByTagName("*"))) {
      if (el.localName !== "txBody") continue;
      const body = { el, inTable: el.namespaceURI === A, isNotes, slide: slideNo, segs: [] };
      for (const p of kids(el, "p")) {
        let group = [];
        const flush = () => {
          if (group.length) {
            const en = group.map((r) => (kid(r, "t") ? kid(r, "t").textContent : "")).join("");
            if (HAS_EN.test(en)) {
              const seg = { id: segs.length, slide: slideNo, en, ko: null, max: budgetOf(en), runs: group, body };
              segs.push(seg);
              body.segs.push(seg);
            }
          }
          group = [];
        };
        for (const child of Array.from(p.childNodes)) {
          if (child.nodeType !== 1) continue;
          if (child.namespaceURI === A && child.localName === "r") group.push(child);
          else if (child.localName !== "pPr") flush();   // 줄바꿈·필드·수식에서 끊기
        }
        flush();
      }
      if (body.segs.length) bodies.push(body);
    }
    return bodies;
  }

  // ---------- 2) AI 호출 ----------
  const RULES = `규칙
- 슬라이드 문체: 제목·글머리표는 간결한 개조식/명사형, 문장은 "~한다"체.
- 전공 용어는 통용되는 한국어 용어로 옮긴다. 원어 병기는 본문에서 처음 한 번만, 제목에는 하지 않는다.
- 코드, 변수명, 함수명, 수식, 복잡도 표기(O(n log n)), 약어(BFS, DP), 고유명사, URL은 그대로 둔다.
- 번역할 필요가 없는 항목은 원문을 그대로 돌려준다.
- 같은 용어는 전체에서 같은 번역어를 쓴다. 설명을 덧붙이지 않는다.
- max는 그 항목이 차지할 수 있는 최대 폭이다. 폭 계산: 한글 1자=1, 영문·숫자 1자≈0.5, 공백≈0.3.
  max를 넘을 것 같으면 뜻은 유지하고 표현을 줄인다(조사·군더더기 생략, 개조식, 원어 병기 생략, 더 짧은 동의어).
출력: JSON 객체 하나만. 형식 {"items":[{"id":0,"ko":"..."}]}. 입력의 모든 id를 빠짐없이 포함한다.`;

  const P_TRANSLATE = `너는 대학 강의자료 전문 번역가다. 아래 JSON 배열 각 항목의 en을 자연스러운 한국어로 번역해라. slide는 문맥 파악용이다.\n\n${RULES}\n\n입력:\n`;
  const P_SHORTEN = `아래 한국어 번역(ko)이 슬라이드 글상자에 들어가기엔 길다. 각 항목을 max 폭 이하로 줄여라. 원문(en)의 핵심 뜻은 반드시 남긴다.\n\n${RULES}\n\n입력:\n`;

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
          if (attempt === 1) console.warn("[pptx-translate] 배치 실패:", e);
        }
        pending = pending.filter((it) => !out.has(it.id));   // 빠진 항목만 한 번 더
      }
      done += batch.length;
      if (onBatch) onBatch(done, items.length);
    }
    return out;
  }

  // ---------- 3) 써넣기 + 글자 축소 ----------
  function writeSegment(seg) {
    if (!seg.ko || seg.ko === seg.en.trim()) return false;
    const len = (r) => (kid(r, "t") ? kid(r, "t").textContent.length : 0);
    const keep = seg.runs.reduce((a, b) => (len(b) > len(a) ? b : a));   // 가장 긴 run의 서식을 대표로
    const lead = seg.en.match(/^\s*/)[0], trail = seg.en.match(/\s*$/)[0];
    kid(keep, "t").textContent = lead + seg.ko + trail;
    for (const r of seg.runs) if (r !== keep) r.parentNode.removeChild(r);
    return true;
  }

  function shrinkBody(body) {
    if (body.inTable || body.isNotes) return null;        // 표 셀은 행이 늘어나고, 노트는 넘쳐도 무방
    const over = body.segs.filter((s) => textWidth(s.ko || s.en) > s.max);
    if (!over.length) return null;
    const bodyPr = kid(body.el, "bodyPr");
    if (!bodyPr) return null;

    const used = body.segs.reduce((n, s) => n + textWidth(s.ko || s.en), 0);
    const room = body.segs.reduce((n, s) => n + s.max, 0);
    const worst = Math.max(...over.map((s) => textWidth(s.ko) / s.max));
    // 여러 문단: 글자를 줄이면 폭과 줄 높이가 함께 줄어드므로 제곱근. 한 줄짜리: 폭 비율 그대로.
    const need = body.segs.length > 1 ? Math.sqrt(room / used) : 1 / worst;
    if (need >= 0.98) return null;

    const old = kid(bodyPr, "normAutofit");
    const prev = old && old.getAttribute("fontScale") ? Number(old.getAttribute("fontScale")) / 100000 : 1;
    const scale = Math.max(CFG.minFontScale, prev * need);
    // "도형을 글에 맞춤"(spAutoFit) 상자도 저장된 크기 안에 들어가도록 축소 방식으로 바꾼다
    for (const name of ["noAutofit", "normAutofit", "spAutoFit"]) { const e = kid(bodyPr, name); if (e) bodyPr.removeChild(e); }
    const fit = body.el.ownerDocument.createElementNS(A, "a:normAutofit");
    fit.setAttribute("fontScale", String(Math.round(scale * 100000)));
    const warp = kid(bodyPr, "prstTxWarp");               // 스키마 순서: prstTxWarp 다음, 나머지 앞
    bodyPr.insertBefore(fit, warp ? warp.nextSibling : bodyPr.firstChild);
    return { slide: body.slide, scale: Math.round(scale * 100), hitFloor: prev * need < CFG.minFontScale };
  }

  // ---------- 메인 ----------
  /**
   * @param {File|Blob|ArrayBuffer|Uint8Array} input 원본 .pptx
   * @param {object} opt
   *   callAI(prompt) => Promise<string>   필수. JSON 배열 문자열을 돌려주는 AI 호출 함수
   *   includeNotes   발표자 노트도 번역 (기본 false)
   *   shorten        넘치면 문장 줄이기 (기본 true)
   *   onProgress({ phase, done, total })  phase: read | translate | shorten | write
   *   signal         AbortSignal (중지)
   *   JSZip, outputType("blob")
   */
  async function translatePptx(input, opt) {
    opt = opt || {};
    const Zip = opt.JSZip || (typeof JSZip !== "undefined" ? JSZip : null);
    if (!Zip) throw new Error("JSZip이 필요해요.");
    if (typeof opt.callAI !== "function") throw new Error("callAI 함수가 필요해요.");
    const progress = opt.onProgress || (() => {});

    progress({ phase: "read", done: 0, total: 1 });
    const zip = await Zip.loadAsync(input);
    const slidePaths = await slidePathsInOrder(zip);
    if (!slidePaths.length) throw new Error("슬라이드를 찾지 못했어요. PPTX 파일이 맞는지 확인해 주세요.");

    const segs = [], parts = [];
    for (let i = 0; i < slidePaths.length; i++) {
      const targets = [{ path: slidePaths[i], notes: false }];
      if (opt.includeNotes) {
        const note = (await readRels(zip, slidePaths[i])).find((r) => /\/notesSlide$/.test(r.type) && !r.external);
        if (note && zip.file(note.path)) targets.push({ path: note.path, notes: true });
      }
      for (const t of targets) {
        const doc = parse(await zip.file(t.path).async("string"));
        const bodies = collect(doc, i + 1, t.notes, segs);
        if (bodies.length) parts.push({ path: t.path, doc, bodies });
      }
    }

    const report = { slides: slidePaths.length, segments: segs.length, translated: 0, untranslated: 0,
                     shortened: 0, shrunk: [], checkSlides: [] };

    // 번역
    const toItem = (s) => ({ id: s.id, slide: s.slide, en: s.en.trim(), max: s.max });
    const first = await askInBatches(opt.callAI, P_TRANSLATE, segs.map(toItem),
      (done, total) => progress({ phase: "translate", done, total }), opt.signal);
    for (const s of segs) s.ko = first.get(s.id) || null;
    if (segs.length && !first.size) throw new Error("AI가 번역 결과를 돌려주지 않았어요. AI 설정을 확인해 주세요.");

    // 넘치는 조각만 줄이기
    const isOver = (s) => s.ko && !s.body.isNotes && textWidth(s.ko) > s.max;
    if (opt.shorten !== false) {
      const touched = new Set();
      for (let round = 0; round < CFG.shortenRounds; round++) {
        const over = segs.filter(isOver);
        if (!over.length) break;
        const fixed = await askInBatches(opt.callAI, P_SHORTEN,
          over.map((s) => ({ ...toItem(s), ko: s.ko })),
          (done, total) => progress({ phase: "shorten", done, total }), opt.signal);
        for (const s of over) {
          const ko = fixed.get(s.id);
          if (ko && textWidth(ko) < textWidth(s.ko)) { s.ko = ko; touched.add(s.id); }   // 더 짧아졌을 때만 채택
        }
      }
      report.shortened = touched.size;
    }

    // 써넣기
    progress({ phase: "write", done: 0, total: parts.length });
    const check = new Set();
    for (const part of parts) {
      for (const body of part.bodies) {
        for (const s of body.segs) {
          if (writeSegment(s)) report.translated++;
          else if (!s.ko) report.untranslated++;
        }
        const r = shrinkBody(body);
        if (r) { report.shrunk.push(r); if (r.hitFloor) check.add(r.slide); }
        if (body.inTable && body.segs.some((s) => s.ko && textWidth(s.ko) > s.max * 1.3)) check.add(body.slide);
      }
      zip.file(part.path, serialize(part.doc));
    }
    report.checkSlides = Array.from(check).sort((a, b) => a - b);

    const blob = await zip.generateAsync({
      type: opt.outputType || "blob",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      compression: "DEFLATE",
    });
    progress({ phase: "write", done: parts.length, total: parts.length });
    return { blob, report };
  }

  return { translatePptx, textWidth, config: CFG };
});
