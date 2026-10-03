# 테스트용 자료 만들기: 강의 PDF(글자 2쪽 + 스캔 1쪽), PPTX, DOCX, 족보 사진
import pathlib, io
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from reportlab.lib.colors import HexColor
from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation
from docx import Document

ROOT = pathlib.Path(__file__).resolve().parent
FONT = str(ROOT.parent / 'fontwork' / 'LB-Regular.ttf')
OUT = ROOT / 'fixtures'
pdfmetrics.registerFont(TTFont('KR', FONT))

def text_image(lines, w=1000, h=700):
    img = Image.new('RGB', (w, h), 'white'); d = ImageDraw.Draw(img); f = ImageFont.truetype(FONT, 34)
    for i, ln in enumerate(lines): d.text((60, 60 + i * 60), ln, fill='black', font=f)
    return img

c = canvas.Canvas(str(OUT / 'os-week5.pdf'))
pages = [
    ['5주차 프로세스 스케줄링', 'CPU 스케줄링은 준비 큐의 프로세스 중 하나를 골라 CPU를 배정한다.', 'FCFS: 먼저 온 순서대로 처리. 호위 효과(convoy effect)가 생길 수 있다.', 'SJF: 실행 시간이 가장 짧은 작업 먼저. 평균 대기 시간이 최소.'],
    ['라운드 로빈(Round Robin)', '시간 할당량(time quantum)만큼 돌아가며 실행한다.', '할당량이 너무 크면 FCFS와 같아지고, 너무 작으면 문맥 교환 비용이 커진다.', '평균 대기 시간 = 각 프로세스 대기 시간의 합 / 프로세스 수'],
]
for lines in pages:
    c.setFont('KR', 14)
    for i, ln in enumerate(lines): c.drawString(60, 780 - i * 28, ln)
    c.showPage()
img = text_image(['[스캔] 우선순위 스케줄링', '기아 상태(starvation) 발생 가능', '해결: 에이징(aging)'])
c.drawImage(ImageReader(img), 40, 300, width=500, height=350); c.showPage(); c.save()

text_image(['2025 중간고사', '1. FCFS와 SJF의 차이를 서술하시오.', '2. 라운드 로빈에서 할당량이 너무 작을 때 문제점은?', '3. 에이징이란 무엇인가?']).save(OUT / 'jokbo-2025.jpg', quality=90)

p = Presentation()
for title, body in [('6주차 동기화', '임계 구역(critical section) 문제'), ('세마포어', 'wait와 signal 연산으로 상호 배제')]:
    s = p.slides.add_slide(p.slide_layouts[1]); s.shapes.title.text = title; s.placeholders[1].text = body
    s.notes_slide.notes_text_frame.text = '시험에 자주 나옴'
p.save(OUT / 'os-week6.pptx')

# 번역 PDF 테스트용 영어 슬라이드 (글머리표 줄바꿈, 두 단, 표)
W, H = 960, 540
c = canvas.Canvas(str(OUT / 'en-slides.pdf'), pagesize=(W, H))
def en_title(t):
    c.setFillColor(HexColor('#1f2a44')); c.rect(0, H - 90, W, 90, stroke=0, fill=1)
    c.setFillColor(HexColor('#ffffff')); c.setFont('Helvetica-Bold', 32); c.drawCentredString(W / 2, H - 58, t)
en_title('Process Scheduling Algorithms')
c.setFillColor(HexColor('#222222')); c.setFont('Helvetica', 20)
for i, ln in enumerate(['• First Come First Served runs jobs in the order they arrive, which is simple', '  but can cause the convoy effect when a long job blocks short ones.',
                        '• Round Robin gives each process a fixed time quantum.', '• Complexity is O(n log n) with a priority queue.']): c.drawString(60, H - 140 - i * 28, ln)
c.setFont('Helvetica-Oblique', 14); c.setFillColor(HexColor('#666666')); c.drawString(60, 40, 'Operating Systems, Week 5'); c.drawRightString(W - 60, 40, '1')
c.showPage()
en_title('Comparison')
c.setFillColor(HexColor('#222222')); c.setFont('Helvetica', 16)
for i, ln in enumerate(['Preemptive scheduling can interrupt a', 'running process when a higher priority', 'process becomes ready to run.']): c.drawString(60, H - 140 - i * 21, ln)
for i, ln in enumerate(['Non-preemptive scheduling waits until', 'the running process finishes or blocks', 'before choosing the next one.']): c.drawString(500, H - 140 - i * 21, ln)
c.setFillColor(HexColor('#eef2ff')); c.rect(60, 150, 840, 120, stroke=0, fill=1)
c.setFillColor(HexColor('#1f2a44')); c.setFont('Helvetica-Bold', 15)
for x, t in [(80, 'Algorithm'), (360, 'Average waiting time'), (660, 'Starvation')]: c.drawString(x, 240, t)
c.setFont('Helvetica', 15)
for r, row in enumerate([('FCFS', 'High when jobs vary', 'No'), ('SJF', 'Lowest possible', 'Yes')]):
    for x, t in zip((80, 360, 660), row): c.drawString(x, 205 - r * 32, t)
c.showPage(); c.save()

d = Document(); d.add_heading('7주차 교착 상태', 1); d.add_paragraph('교착 상태의 네 가지 조건: 상호 배제, 점유와 대기, 비선점, 순환 대기.'); d.save(OUT / 'os-week7.docx')
print('fixtures:', sorted(x.name for x in OUT.iterdir()))
