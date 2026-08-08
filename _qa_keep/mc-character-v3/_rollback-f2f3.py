"""
回档:从原始 jpg 重新生成"修复前"版本(用户实装后、BFS 修复前的状态)
- frame-A = 迈左脚, frame-B = 迈右脚
- 流程与原 _build-walk.py 一致:extract_sprite 抠背景(纯背景 tol=24)+ 裁切
- f2 = A 上移 2px, f3 = B
- 上半身对称化(mid 脸质心)
- f3 上半身 = f2 上半身(平移对齐中轴)
回档版特点:角色完整,但保留原始背景残留(黑框)与水印(星点)——等待后续安全修复
"""
import os
from PIL import Image

OUT = r'C:\Users\24601\Desktop\文字植物大战僵尸-优化版(1)(1)\文字植物大战僵尸-优化版(1)\dev-tools\_qa_tmp'

def load_png(name):
    return Image.open(os.path.join(OUT, name)).convert('RGBA')

def extract_sprite(im, bg=(24, 27, 32), tol=24):
    """裁切+抠纯背景(曼哈顿距离<tol=透明),保留全部内容像素"""
    px = im.load()
    W, H = im.size
    min_x, min_y, max_x, max_y = W, H, -1, -1
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            d = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
            if a > 0 and d >= tol:  # 内容
                if x < min_x: min_x = x
                if y < min_y: min_y = y
                if x > max_x: max_x = x
                if y > max_y: max_y = y
    if max_x < 0:
        return None
    crop = im.crop((min_x, min_y, max_x + 1, max_y + 1))
    cpx = crop.load()
    cw, ch = crop.size
    for y in range(ch):
        for x in range(cw):
            r, g, b, a = cpx[x, y]
            d = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
            if a > 0 and d < tol:
                cpx[x, y] = (0, 0, 0, 0)
    return crop

def to_canvas(sprite, W, H):
    """贴到 W×H 画布,脚底对齐"""
    new = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sw, sh = sprite.size
    new.paste(sprite, ((W - sw) // 2, H - sh), sprite)
    return new

def face_mid(im):
    W, H = im.size
    px = im.load()
    face = [(x, y) for y in range(150, 235) for x in range(W)
            if px[x, y][3] > 0 and px[x, y][0] > 160 and px[x, y][1] > 110 and px[x, y][2] > 70]
    if not face:
        return 0
    return round(sum(p[0] for p in face) / len(face))

# 1. 提取 A/B
A = extract_sprite(load_png('frame-A.png'))
B = extract_sprite(load_png('frame-B.png'))
print('A 裁切:', A.size, 'B 裁切:', B.size)

W = max(A.size[0], B.size[0])
H = max(A.size[1], B.size[1])
A_pad = to_canvas(A, W, H)
B_pad = to_canvas(B, W, H)

# 2. f2 = A 上移 2px; f3 = B
def shift_up(img, dy):
    w, h = img.size
    new = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    new.paste(img, (0, -dy), img)
    return new

F2 = shift_up(A_pad, 2)
F3 = B_pad.copy()

# 3. 上半身对称化(头 y<235 不动, 上半身 y235-1100)
for name, im in [('f2', F2), ('f3', F3)]:
    mid = face_mid(im)
    px = im.load()
    y0, y1 = 235, 1100
    for y in range(y0, y1):
        for x in range(mid):
            mx = 2 * mid - x
            if 0 <= mx < W:
                px[x, y] = px[mx, y]
            else:
                px[x, y] = (0, 0, 0, 0)
    print(name, '对称化 mid', mid)

# 4. f3 上半身 = f2 上半身(平移对齐中轴)
p2, p3 = F2.load(), F3.load()
mid2 = face_mid(F2)
mid3 = face_mid(F3)
dx = mid3 - mid2
print('中轴: f2=', mid2, 'f3=', mid3, 'dx=', dx)
for y in range(235, 1101):
    for x in range(W):
        sx = x - dx
        if 0 <= sx < W:
            p3[x, y] = p2[sx, y]
        else:
            p3[x, y] = (0, 0, 0, 0)

# 5. 保存回档版
F2.save(os.path.join(OUT, 'walk-front-f2.png'))
F3.save(os.path.join(OUT, 'walk-front-f3.png'))
print('回档版已保存: walk-front-f2.png', F2.size, 'walk-front-f3.png', F3.size)
print('回档完成(角色完整,保留原始背景/水印)')
