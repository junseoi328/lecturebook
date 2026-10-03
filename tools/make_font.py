# 한글 부분 폰트를 만들어 site/font.js로 내보낸다. 실행: python tools/make_font.py (fontwork/NotoSansKR.ttf 필요)
# 원본: Noto Sans KR (SIL Open Font License 1.1)
import base64, json, os, pathlib
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'fontwork' / 'NotoSansKR.ttf'
hangul = []
for hi in range(0xB0, 0xC9):
    for lo in range(0xA1, 0xFF):
        try: hangul.append(bytes([hi, lo]).decode('euc-kr'))
        except UnicodeDecodeError: pass
extra = ''.join(chr(c) for c in range(0x20, 0x7F)) + ''.join(chr(c) for c in range(0xA0, 0x100))
extra += ''.join(chr(c) for c in range(0x3131, 0x3164))
extra += '‘’“”·…–—•※→←↑↓↔⇒⇔≈≠≤≥±×÷∞∑∏√∫∂∆∇∈∉⊂⊃⊆⊇∪∩∧∨¬∀∃∝∠⊥∥≡°′″℃'
extra += 'αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΘΛΞΠΣΦΨΩ①②③④⑤⑥⑦⑧⑨⑩■□▲△▶▷●○◆◇★☆「」『』〈〉《》【】、。'
extra += '₀₁₂₃₄₅₆₇₈₉⁰⁴⁵⁶⁷⁸⁹ⁿ'
text = ''.join(hangul) + extra
out = {}
supported = None
for wght, name in [(400, 'regular'), (700, 'bold')]:
    f = instancer.instantiateVariableFont(TTFont(SRC), {'wght': wght})
    o = subset.Options(); o.layout_features = []; o.name_IDs = ['*']; o.notdef_outline = True; o.hinting = False
    s = subset.Subsetter(o); s.populate(text=text); s.subset(f)
    path = ROOT / 'fontwork' / f'LB-{name}.ttf'; f.save(path)
    cmap = f.getBestCmap(); chars = ''.join(sorted(chr(c) for c in cmap))
    supported = chars if supported is None else ''.join(c for c in supported if c in chars)
    out[name] = base64.b64encode(path.read_bytes()).decode()
    print(name, os.path.getsize(path), 'bytes,', len(cmap), 'glyphs')
js = ('// 자동 생성: tools/make_font.py. Noto Sans KR 부분 폰트 (SIL Open Font License 1.1)\n'
      f'window.LB_FONT = {{ regular: "{out["regular"]}", bold: "{out["bold"]}", chars: {json.dumps(supported, ensure_ascii=False)} }};\n')
(ROOT / 'site' / 'font.js').write_text(js, encoding='utf-8')
print('site/font.js', round(len(js.encode()) / 1024), 'KB; supported chars', len(supported))
