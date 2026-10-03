# 번역 PDF 테스트용 견본(tests/fixtures/en-math.pdf)을 만든다: 글머리표 내어쓰기, 첨자, 수식 글꼴, 그림 라벨. DejaVu 글꼴이 있는 리눅스에서 실행: python tests/make_math_fixture.py tests/fixtures/en-math.pdf
import sys
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
D = '/usr/share/fonts/truetype/dejavu/'
for n, f in [('Sans', 'DejaVuSans.ttf'), ('Sans-Bold', 'DejaVuSans-Bold.ttf'), ('Sans-Oblique', 'DejaVuSans-Oblique.ttf'), ('DejaVuMath', 'DejaVuMathTeXGyre.ttf')]: pdfmetrics.registerFont(TTFont(n, D + f))
W, H = 720, 540
c = canvas.Canvas(sys.argv[1], pagesize=(W, H))
def rich(x, y, s, size, font='Sans', color='#222222'):
    """'V_{G} = 0' 처럼 쓰면 첨자를 작은 조각으로 따로 그린다 (PowerPoint가 내보내는 방식)"""
    import re
    c.setFillColor(HexColor(color))
    for part in re.split(r'([_^]\{[^}]*\})', s):
        if not part: continue
        m = re.match(r'([_^])\{([^}]*)\}', part)
        if m:
            sz = size * 0.65; c.setFont(font, sz); yy = y - 0.2 * size if m.group(1) == '_' else y + 0.38 * size
            c.drawString(x, yy, m.group(2)); x += pdfmetrics.stringWidth(m.group(2), font, sz)
        else:
            c.setFont(font, size); c.drawString(x, y, part); x += pdfmetrics.stringWidth(part, font, size)
    return x
def bullet(x, y, mark, tx, lines, size, color='#222222'):
    rich(x, y, mark, size, color=color)
    for i, ln in enumerate(lines): rich(tx, y - i * size * 1.2, ln, size, color=color)
    return y - len(lines) * size * 1.2 - size * 0.45
def title(t, sub):
    rich(22, 500, t, 28, 'Sans-Bold', '#0b4a8f'); rich(22, 479, sub, 17, 'Sans-Bold', '#333333')

title('MOS Basics', 'Operating Modes: V_{FB} < V_{G} < V_{T}')
y = bullet(30, 440, '▪', 50, ['Energy bands and flat band'], 16)
y = bullet(52, y, '✓', 72, ['See how φ_{ms} bends the bands and', 'defines the flat-band voltage V_{FB}'], 13)
y = bullet(30, y, '▪', 50, ['Three operating modes'], 16)
y = bullet(52, y, '✓', 72, ['See accumulation, depletion, and inversion as V_{G}', 'changes'], 13)
y = bullet(30, y, '▪', 50, ['E_{c,s}: E_{c} at the Si surface. Bulk E_{c} − E_{F} =', 'E_{g}/2 + eφ_{fp}; lowered by eφ_{s0} at the surface'], 13)
y = 440
y = bullet(410, y, '▪', 428, ['The oxide blocks current: the', 'transferred charge stays on both', 'sides: gate +, Si − (ionized', 'acceptors)'], 14)
y = bullet(430, y, '✓', 448, ['bands bend down, a depletion', 'region forms, even at V_{G} = 0'], 13)
y = bullet(410, y, '▪', 428, ['Divide by e:'], 14)
# 수식 글꼴로 쓴 식 (번역하면 안 된다)
rich(420, y - 6, 'E_{Fm} − E_{F,Si} = −eφ_{ms}', 17, 'DejaVuMath')
x = rich(420, y - 50, 'E_{c,s} − E_{F} =', 17, 'DejaVuMath')
rich(x + 8, y - 39, 'E_{g}', 17, 'DejaVuMath'); c.setStrokeColor(HexColor('#222222')); c.line(x + 6, y - 44, x + 30, y - 44); rich(x + 12, y - 60, '2', 17, 'DejaVuMath')
rich(x + 36, y - 50, '+ eφ_{fp} − eφ_{s0} (max)', 17, 'DejaVuMath')
# 그림과 라벨
c.setFillColor(HexColor('#b5b5b5')); c.rect(60, 120, 250, 45, stroke=0, fill=1)
c.setFillColor(HexColor('#dce8f5')); c.rect(60, 60, 250, 60, stroke=0, fill=1)
rich(150, 137, 'gate metal', 11); rich(320, 116, 'oxide', 9)
x = rich(165, 84, 'p', 11, 'Sans-Oblique'); rich(x, 84, '-Si', 11)
rich(60, 44, 'huge electron density:', 9, color='#999999'); rich(60, 33, 'cannot be depleted', 9, color='#999999')
rich(200, 44, 'x_{d}: depletion width', 10, color='#1f8ac0'); rich(200, 30, 't_{ox} = 30 nm', 10)
rich(660, 14, '1 /40', 8)
c.showPage()
# 어두운 배경
c.setFillColor(HexColor('#1f2a44')); c.rect(0, 0, W, H, stroke=0, fill=1)
rich(22, 500, 'Charge vs. Gate Voltage', 28, 'Sans-Bold', '#ffffff')
y = bullet(30, 440, '▪', 50, ['Threshold voltage V_{T}: the gate voltage at which φ_{s} = 2φ_{fp}', 'and the surface becomes as n-type as the bulk is p-type'], 16, '#ffffff')
y = bullet(30, y, '▪', 50, ['Linear in V_{G} like accumulation: same slope C_{ox}'], 16, '#ffd27a')
rich(200, 200, 'Questions?', 40, 'Sans-Bold', '#ffffff')
c.showPage(); c.save()
