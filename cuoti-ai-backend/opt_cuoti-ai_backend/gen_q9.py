# -*- coding: utf-8 -*-
"""生成九年级几何/函数题目配图（黑白试卷风 PNG）"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"E:\doubaoProjects\miniprogram-v4\cuoti-ai-backend\opt_cuoti-ai_backend\uploads\questions"
os.makedirs(OUT, exist_ok=True)

W, H = 640, 480
try:
    FONT = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 26)
    FONT_S = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 20)
except Exception:
    FONT = ImageFont.load_default()
    FONT_S = FONT


def new_canvas():
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    return img, d


def lab(d, xy, text, font=FONT, fill="black"):
    d.text(xy, text, font=font, fill=fill)


def save(img, name):
    img.save(os.path.join(OUT, name + ".png"))
    print("saved", name)


# ---------- g1 圆+弦+垂径定理 ----------
img, d = new_canvas()
cx, cy, r = 320, 240, 180
d.ellipse([cx - r, cy - r, cx + r, cy + r], outline="black", width=3)
# 弦 AB（水平偏上）
A, B = (cx - 150, cy - 70), (cx + 150, cy - 70)
C = (cx, cy - 70)
d.line([A, B], fill="black", width=3)
d.line([(cx, cy), C], fill="black", width=2)
d.arc([cx - 26, cy - 70 - 26, cx + 26, cy - 70 + 26], 180, 270, fill="black", width=2)
lab(d, (cx + 8, cy - 106), "O")
lab(d, (A[0] - 26, A[1] - 10), "A")
lab(d, (B[0] + 6, B[1] - 10), "B")
lab(d, (C[0] + 8, C[1] + 8), "C")
d.line([(cx - 90, cy - 110), (cx - 60, cy - 110)], fill="black", width=2)
lab(d, (cx - 88, cy - 140), "半径 r")
save(img, "g1")

# ---------- g2 圆周角 ----------
img, d = new_canvas()
cx, cy, r = 320, 250, 170
d.ellipse([cx - r, cy - r, cx + r, cy + r], outline="black", width=3)
A = (cx - 100, cy - 120)
B = (cx + 120, cy - 90)
C = (cx + 40, cy + 130)
O = (cx, cy)
d.line([O, A], fill="black", width=2)
d.line([O, B], fill="black", width=2)
d.line([A, C, B], fill="black", width=3)
lab(d, (O[0] + 6, O[1] - 40), "O")
lab(d, (A[0] - 28, A[1] - 6), "A")
lab(d, (B[0] + 10, B[1] - 6), "B")
lab(d, (C[0] + 10, C[1] + 6), "C")
save(img, "g2")

# ---------- g3 切线 ----------
img, d = new_canvas()
cx, cy, r = 300, 260, 140
d.ellipse([cx - r, cy - r, cx + r, cy + r], outline="black", width=3)
# 切点 A 在圆左下方，切线水平
A = (cx - int(r * 0.707), cy + int(r * 0.707))
d.line([(A[0] - 120, A[1]), (A[0] + 120, A[1])], fill="black", width=3)
d.line([(cx, cy), A], fill="black", width=2)
d.arc([A[0] - 24, A[1] - 24, A[0] + 24, A[1] + 24], 180, 270, fill="black", width=2)
lab(d, (cx + 6, cy - 40), "O")
lab(d, (A[0] - 26, A[1] - 34), "A")
lab(d, (A[0] + 90, A[1] + 10), "l")
save(img, "g3")

# ---------- g4 扇形 ----------
img, d = new_canvas()
cx, cy, r = 260, 300, 190
A = (cx + r, cy)
B = (cx, cy - r)
d.arc([cx - r, cy - r, cx + r, cy + r], 0, 90, fill="black", width=3)
d.line([(cx, cy), A], fill="black", width=3)
d.line([(cx, cy), B], fill="black", width=3)
d.arc([cx - 40, cy - 40, cx + 40, cy + 40], 0, 90, fill="black", width=2)
lab(d, (cx - 30, cy - 60), "90°")
lab(d, (cx + 6, cy + 14), "O")
lab(d, (A[0] + 6, A[1] - 8), "A")
lab(d, (B[0] - 8, B[1] - 30), "B")
lab(d, (cx + 70, cy - 120), "r")
save(img, "g4")

# ---------- g5 相似三角形（DE∥BC） ----------
img, d = new_canvas()
A = (320, 80)
B = (160, 400)
C = (500, 400)
D = (240, 240)
E = (430, 240)
d.line([A, B, C, A], fill="black", width=3)
d.line([D, E], fill="black", width=2)
lab(d, (A[0] - 20, A[1] - 26), "A")
lab(d, (B[0] - 34, B[1] + 6), "B")
lab(d, (C[0] + 12, C[1] + 6), "C")
lab(d, (D[0] - 30, D[1] - 6), "D")
lab(d, (E[0] + 8, E[1] - 6), "E")
save(img, "g5")

# ---------- g6 直角三角形 30° ----------
img, d = new_canvas()
A = (170, 120)
B = (520, 120)
C = (520, 390)
d.line([A, B, C, A], fill="black", width=3)
d.arc([C[0] - 30, C[1] - 30, C[0], C[1]], 0, 90, fill="black", width=2)
d.arc([B[0] - 46, B[1] - 46, B[0], B[1]], 180, 270, fill="black", width=2)
lab(d, (A[0] - 26, A[1] - 8), "A")
lab(d, (B[0] + 10, B[1] - 8), "B")
lab(d, (C[0] + 10, C[1] + 8), "C")
lab(d, (C[0] - 36, C[1] - 60), "30°")
save(img, "g6")

# ---------- g7 等腰三角形 + 中位线 ----------
img, d = new_canvas()
A = (320, 90)
B = (170, 400)
C = (470, 400)
D = ((A[0] + B[0]) // 2, (A[1] + B[1]) // 2)
E = ((A[0] + C[0]) // 2, (A[1] + C[1]) // 2)
d.line([A, B, C, A], fill="black", width=3)
d.line([D, E], fill="black", width=2, )
# 等长标记
d.line([(250, 245), (262, 235)], fill="black", width=2)
d.line([(390, 245), (378, 235)], fill="black", width=2)
lab(d, (A[0] - 20, A[1] - 24), "A")
lab(d, (B[0] - 34, B[1] + 6), "B")
lab(d, (C[0] + 12, C[1] + 6), "C")
lab(d, (D[0] - 30, D[1] + 6), "D")
lab(d, (E[0] + 8, E[1] + 6), "E")
save(img, "g7")

# ---------- g8 梯形 ----------
img, d = new_canvas()
A = (170, 140)
B = (470, 140)
C = (400, 390)
D = (240, 390)
d.line([A, B, C, D, A], fill="black", width=3)
d.line([(170, 195), (470, 195)], fill="black", width=2)
d.line([(300, 335), (460, 335)], fill="black", width=2)
lab(d, (A[0] - 26, A[1] - 8), "A")
lab(d, (B[0] + 10, B[1] - 8), "B")
lab(d, (C[0] + 10, C[1] + 8), "C")
lab(d, (D[0] - 30, D[1] + 8), "D")
save(img, "g8")

# ---------- g9 菱形 ----------
img, d = new_canvas()
A = (320, 80)
B = (470, 240)
C = (320, 400)
D = (170, 240)
d.line([A, B, C, D, A], fill="black", width=3)
d.line([A, C], fill="black", width=2)
d.line([B, D], fill="black", width=2)
lab(d, (A[0] - 16, A[1] - 16), "A")
lab(d, (B[0] + 10, B[1] - 6), "B")
lab(d, (C[0] - 16, C[1] + 16), "C")
lab(d, (D[0] - 34, D[1] - 6), "D")
save(img, "g9")

# ---------- g10 圆内接四边形 ----------
img, d = new_canvas()
cx, cy, r = 320, 240, 190
d.ellipse([cx - r, cy - r, cx + r, cy + r], outline="black", width=3)
A = (cx + 60, cy - 160)
B = (cx + 170, cy + 40)
C = (cx + 20, cy + 170)
D = (cx - 170, cy + 10)
d.line([A, B, C, D, A], fill="black", width=3)
lab(d, (A[0] - 16, A[1] - 14), "A")
lab(d, (B[0] + 10, B[1] - 6), "B")
lab(d, (C[0] - 14, C[1] + 14), "C")
lab(d, (D[0] - 34, D[1] - 6), "D")
lab(d, (cx + 10, cy - 60), "O")
save(img, "g10")

# ---------- g11 抛物线 y=x²-4x+3 ----------
img, d = new_canvas()
ox, oy = 320, 380
scale = 26
d.line([(40, oy), (600, oy)], fill="black", width=3)
d.line([(ox, 20), (ox, 460)], fill="black", width=3)
lab(d, (600, oy + 12), "x")
lab(d, (ox + 12, 20), "y")
for i in range(1, 9):
    d.line([(ox + i * scale, oy - 4), (ox + i * scale, oy + 4)], fill="black", width=2)
    d.line([(ox - i * scale, oy - 4), (ox - i * scale, oy + 4)], fill="black", width=2)
    lab(d, (ox + i * scale - 6, oy + 12), str(i))
    lab(d, (ox - i * scale - 14, oy + 12), str(-i))
pts = []
for x in range(-20, 90):
    xx = x / scale
    yy = xx * xx - 4 * xx + 3
    pts.append((ox + xx * scale, oy - yy * scale))
d.line(pts, fill="black", width=3)
# 顶点 (2,-1)、对称轴 x=2、交点
d.line([(ox + 2 * scale, 20), (ox + 2 * scale, 460)], fill="black", width=2, )
d.ellipse([ox + 2 * scale - 5, oy + scale - 5, ox + 2 * scale + 5, oy + scale + 5], fill="black")
lab(d, (ox + 2 * scale + 10, oy + scale + 6), "(2,-1)")
save(img, "g11")

# ---------- g12 抛物线 y=-x²+2x+3 ----------
img, d = new_canvas()
ox, oy = 320, 360
scale = 26
d.line([(40, oy), (600, oy)], fill="black", width=3)
d.line([(ox, 20), (ox, 460)], fill="black", width=3)
lab(d, (600, oy + 12), "x")
lab(d, (ox + 12, 20), "y")
for i in range(1, 10):
    d.line([(ox + i * scale, oy - 4), (ox + i * scale, oy + 4)], fill="black", width=2)
    d.line([(ox - i * scale, oy - 4), (ox - i * scale, oy + 4)], fill="black", width=2)
    lab(d, (ox + i * scale - 6, oy + 12), str(i))
    lab(d, (ox - i * scale - 16, oy + 12), str(-i))
pts = []
for x in range(-20, 100):
    xx = x / scale
    yy = -(xx * xx) + 2 * xx + 3
    pts.append((ox + xx * scale, oy - yy * scale))
d.line(pts, fill="black", width=3)
d.ellipse([ox + scale - 5, oy - 4 * scale - 5, ox + scale + 5, oy - 4 * scale + 5], fill="black")
lab(d, (ox + scale + 10, oy - 4 * scale + 6), "(1,4)")
save(img, "g12")

# ---------- g13 反比例 y=6/x ----------
img, d = new_canvas()
ox, oy = 320, 300
scale = 40
d.line([(40, oy), (600, oy)], fill="black", width=3)
d.line([(ox, 20), (ox, 460)], fill="black", width=3)
lab(d, (600, oy + 12), "x")
lab(d, (ox + 12, 20), "y")
for i in range(1, 7):
    lab(d, (ox + i * scale - 6, oy + 12), str(i))
    lab(d, (ox - i * scale - 16, oy + 12), str(-i))
# y = 6/x 第一三象限
pts1, pts2 = [], []
for x in range(4, 130):
    xx = x / scale
    yy = 6.0 / xx
    pts1.append((ox + xx * scale, oy - yy * scale))
for x in range(-130, -4):
    xx = x / scale
    yy = 6.0 / xx
    pts2.append((ox + xx * scale, oy - yy * scale))
d.line(pts1, fill="black", width=3)
d.line(pts2, fill="black", width=3)
lab(d, (ox + 110, oy - 80), "y=6/x")
save(img, "g13")

# ---------- g14 一次函数与反比例交点 ----------
img, d = new_canvas()
ox, oy = 300, 320
scale = 40
d.line([(40, oy), (600, oy)], fill="black", width=3)
d.line([(ox, 20), (ox, 460)], fill="black", width=3)
lab(d, (600, oy + 12), "x")
lab(d, (ox + 12, 20), "y")
# y = x - 1 与 y = 2/x
pts = []
for x in range(-60, 150):
    xx = x / scale
    yy = xx - 1
    pts.append((ox + xx * scale, oy - yy * scale))
d.line(pts, fill="black", width=3)
pts1 = []
for x in range(4, 120):
    xx = x / scale
    pts1.append((ox + xx * scale, oy - (2.0 / xx) * scale))
d.line(pts1, fill="black", width=3)
# 交点 (2,1)
d.ellipse([ox + 2 * scale - 6, oy - scale - 6, ox + 2 * scale + 6, oy - scale + 6], fill="black")
lab(d, (ox + 2 * scale + 10, oy - scale + 8), "(2,1)")
save(img, "g14")

# ---------- g15 二次函数区间最值 ----------
img, d = new_canvas()
ox, oy = 300, 380
scale = 26
d.line([(40, oy), (600, oy)], fill="black", width=3)
d.line([(ox, 20), (ox, 460)], fill="black", width=3)
lab(d, (600, oy + 12), "x")
lab(d, (ox + 12, 20), "y")
# y = x² - 2x（0≤x≤3）
pts = []
for x in range(0, 90):
    xx = x / scale
    yy = xx * xx - 2 * xx
    pts.append((ox + xx * scale, oy - yy * scale))
d.line(pts, fill="black", width=3)
# 区间 [0,3] 加粗端点
d.ellipse([ox - 5, oy - 5, ox + 5, oy + 5], fill="black")
d.ellipse([ox + 3 * scale - 5, oy - 3 * scale - 5, ox + 3 * scale + 5, oy - 3 * scale + 5], fill="black")
lab(d, (ox - 30, oy + 12), "0")
lab(d, (ox + 3 * scale + 8, oy - 3 * scale + 10), "(3,3)")
lab(d, (ox - 14, oy + 12), "O")
save(img, "g15")

print("ALL DONE, total", len(os.listdir(OUT)))
