"""
新图(无背景/水印 PNG)处理 → 生成 walk-front-f2/f3.png
1. 加载 new-A.png(new-A 迈左脚=f2)、new-B.png(迈右脚=f3),均已透明通道
2. 裁切到内容 bbox
3. 对齐画布(W=max, H=max),脚底对齐
4. F2 上半身对称化(右半镜像到左半,保留右臂基准):区域 = 头部下缘→手臂底(动态算)
5. F3 左手=右手镜像(同区域,以 f3 自己的中轴)
6. F3 上半身 = F2 上半身(平移对齐中轴)
7. 保存 + 验证
"""
import os
from PIL import Image

OUT = r'C:\Users\24601\Desktop\文字植物大战僵尸-优化版(1)(1)\文字植物大战僵尸-优化版(1)\dev-tools\_qa_tmp'


def load(name):
    return Image.open(os.path.join(OUT, name)).convert('RGBA')


def crop(im):
    W, H = im.size
    px = im.load()
    mnx, mny, mxx, mxy = W, H, -1, -1
    for y in range(H):
        for x in range(W):
            if px[x, y][3] > 0:
                if x < mnx: mnx = x
                if y < mny: mny = y
                if x > mxx: mxx = x
                if y > mxy: mxy = y
    return im.crop((mnx, mny, mxx + 1, mxy + 1)) if mxx >= 0 else im


def face_mid(im):
    """脸质心(头部肤色像素 x 质心)"""
    W, H = im.size
    px = im.load()
    face = [(x, y) for y in range(int(H * 0.05), int(H * 0.18)) for x in range(W)
            if px[x, y][3] > 0 and px[x, y][0] > 160 and px[x, y][1] > 110 and px[x, y][2] > 70]
    if not face:
        return W // 2
    return round(sum(p[0] for p in face) / len(face))


def body_region(im):
    """上半身 y 范围:头部下缘 → 手臂底(动态算)"""
    W, H = im.size
    px = im.load()
    # 头部下缘:头部区域的最后一行肤色像素
    last_face_y = int(H * 0.1)
    for y in range(int(H * 0.08), int(H * 0.28)):
        for x in range(W):
            if px[x, y][3] > 0 and px[x, y][0] > 160 and px[x, y][1] > 110 and px[x, y][2] > 70:
                last_face_y = y
    # 手臂底:y > last_face_y, 肤色像素最大 y(限制在 H*0.55 内避免腿部肤色误判)
    skin_y = []
    for y in range(last_face_y, int(H * 0.55)):
        for x in range(W):
            if px[x, y][3] > 0 and px[x, y][0] > 160 and px[x, y][1] > 110 and px[x, y][2] > 70:
                skin_y.append(y); break
    arm_bottom = max(skin_y) if skin_y else int(H * 0.4)
    return last_face_y, arm_bottom


def to_canvas(sprite, W, H):
    new = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sw, sh = sprite.size
    new.paste(sprite, ((W - sw) // 2, H - sh), sprite)
    return new


# 1. 加载 + 裁切
A_raw = crop(load('new-A.png'))
B_raw = crop(load('new-B.png'))
print(f'A 裁切: {A_raw.size}, B 裁切: {B_raw.size}')

# 2. 对齐画布
W = max(A_raw.size[0], B_raw.size[0])
H = max(A_raw.size[1], B_raw.size[1])
F2 = to_canvas(A_raw, W, H)
F3 = to_canvas(B_raw, W, H)
print(f'对齐画布: {W}x{H}')

# 3. 上半身区域(用 f2 的,因为 f3 上半身=f2)
y0, y1 = body_region(F2)
print(f'F2 上半身 y 区域: [{y0}, {y1}]')

# 4. F2 上半身对称化(右半 → 左半)
mid2 = face_mid(F2)
px = F2.load()
changed = 0
for y in range(y0, y1):
    for x in range(mid2):
        mx = 2 * mid2 - x
        if 0 <= mx < W:
            if px[x, y] != px[mx, y]:
                px[x, y] = px[mx, y]; changed += 1
        else:
            px[x, y] = (0, 0, 0, 0)
print(f'F2 对称化 mid={mid2} 改 {changed}px')

# 5. F3 左手 = 右手镜像(独立步骤,中轴用 F3 自己的)
mid3 = face_mid(F3)
px = F3.load()
changed = 0
for y in range(y0, y1):
    for x in range(mid3):
        mx = 2 * mid3 - x
        if 0 <= mx < W:
            if px[mx, y][3] > 0:
                if px[x, y] != px[mx, y]:
                    px[x, y] = px[mx, y]; changed += 1
            else:
                px[x, y] = (0, 0, 0, 0)
print(f'F3 左手=右手镜像 mid={mid3} 改 {changed}px')

# 6. F3 上半身 = F2 上半身(平移对齐中轴)
dx = mid3 - mid2
p2 = F2.load()
p3 = F3.load()
for y in range(y0, y1):
    for x in range(W):
        sx = x - dx
        if 0 <= sx < W:
            p3[x, y] = p2[sx, y]
        else:
            p3[x, y] = (0, 0, 0, 0)
print(f'F3 上半身=F2(平移 dx={dx})')

# 7. 保存
F2.save(os.path.join(OUT, 'walk-front-f2.png'))
F3.save(os.path.join(OUT, 'walk-front-f3.png'))
print(f'已保存 walk-front-f2.png {F2.size}, walk-front-f3.png {F3.size}')

# 8. 验证:上半身肤色 + 上下半身差异(f3 应 == f2 上半身)
for name, im in [('walk-front-f2.png', F2), ('walk-front-f3.png', F3)]:
    px = im.load()
    skin = sum(1 for y in range(y0, y1) for x in range(W)
               if px[x, y][3] > 0 and px[x, y][0] > 160 and px[x, y][1] > 110 and px[x, y][2] > 70)
    print(f'{name} 上半身肤色={skin}px')

# F3 vs F2 上半身像素一致性
p2, p3 = F2.load(), F3.load()
diff = sum(1 for y in range(y0, y1) for x in range(W) if p2[x, y] != p3[x, y])
print(f'F3 vs F2 上半身差异: {diff}px (0=完全一致)')