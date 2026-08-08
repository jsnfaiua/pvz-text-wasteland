"""
完整安全修复(从 jpg 原始开始,不回档版上修):
1. 加载 jpg → RGBA
2. BFS 从边缘清背景:种子=边缘非透明距背景<48;扩散=非透明距背景<48
   - 清:纯背景 + jpg 压缩渐变 + 角色边缘黑框环
   - 保:角色内部深色(眼睛/裤缝/头发暗部,被主体隔开 BFS 到不了)、V 领肤色
3. BFS 清水印:浅灰(sat<12, avg>100)连通域 >25px 整块清
4. 裁切内容 bbox
5. 上半身对称化(f2/f3 各自脸质心中轴)
6. f3 上半身 = f2 上半身(平移对齐中轴)
验证:躯干肤色保留 + 背景残留统计 + 水印残留统计
"""
import os
from collections import deque
from PIL import Image

OUT = r'C:\Users\24601\Desktop\文字植物大战僵尸-优化版(1)(1)\文字植物大战僵尸-优化版(1)\dev-tools\_qa_tmp'

BG = (24, 29, 31)      # 背景中心色
BG_TOL = 30            # 距背景阈值:BFS 扩散/清除(只清纯背景+压缩噪点,不碰抗锯齿桥 30-80)
WM_SAT = 12            # 水印:低饱和
WM_AVG = 100           # 水印:偏亮
WM_AREA = 25           # 水印连通域最小面积


def bg_dist(r, g, b):
    return abs(r - BG[0]) + abs(g - BG[1]) + abs(b - BG[2])


def is_wm(r, g, b):
    sat = max(r, g, b) - min(r, g, b)
    avg = (r + g + b) // 3
    return sat < WM_SAT and avg > WM_AVG


def bfs_clear_bg(im):
    """从边缘 BFS 清与背景连通的近背景像素"""
    W, H = im.size
    px = im.load()
    visited = bytearray(W * H)
    q = deque()
    cleared = 0
    for y in range(H):
        for x in (0, W - 1):
            i = y * W + x
            if visited[i]:
                continue
            r, g, b, a = px[x, y]
            if a > 0 and bg_dist(r, g, b) < BG_TOL:
                visited[i] = 1
                q.append((x, y))
    for x in range(W):
        for y in (0, H - 1):
            i = y * W + x
            if visited[i]:
                continue
            r, g, b, a = px[x, y]
            if a > 0 and bg_dist(r, g, b) < BG_TOL:
                visited[i] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        cleared += 1
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < W and 0 <= ny < H:
                i = ny * W + nx
                if visited[i]:
                    continue
                r, g, b, a = px[nx, ny]
                if a > 0 and bg_dist(r, g, b) < BG_TOL:
                    visited[i] = 1
                    q.append((nx, ny))
    return cleared


def bfs_clear_watermark(im):
    """BFS 找浅灰连通域,>WM_AREA 整块清"""
    W, H = im.size
    px = im.load()
    visited = bytearray(W * H)
    cleared = 0
    for y in range(H):
        for x in range(W):
            i = y * W + x
            if visited[i]:
                continue
            r, g, b, a = px[x, y]
            if a == 0 or not is_wm(r, g, b):
                visited[i] = 1
                continue
            q = deque([(x, y)])
            visited[i] = 1
            cells = [(x, y)]
            while q:
                cx, cy = q.popleft()
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < W and 0 <= ny < H:
                        ni = ny * W + nx
                        if visited[ni]:
                            continue
                        r2, g2, b2, a2 = px[nx, ny]
                        if a2 > 0 and is_wm(r2, g2, b2):
                            visited[ni] = 1
                            q.append((nx, ny))
                            cells.append((nx, ny))
            if len(cells) > WM_AREA:
                for cx2, cy2 in cells:
                    px[cx2, cy2] = (0, 0, 0, 0)
                    cleared += 1
    return cleared


def crop_content(im):
    """裁切到内容 bbox"""
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
    W, H = im.size
    px = im.load()
    face = [(x, y) for y in range(150, 235) for x in range(W)
            if px[x, y][3] > 0 and px[x, y][0] > 160 and px[x, y][1] > 110 and px[x, y][2] > 70]
    if not face:
        return 0
    return round(sum(p[0] for p in face) / len(face))


def to_canvas(sprite, W, H):
    new = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sw, sh = sprite.size
    new.paste(sprite, ((W - sw) // 2, H - sh), sprite)
    return new


def shift_up(img, dy):
    w, h = img.size
    new = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    new.paste(img, (0, -dy), img)
    return new


# 1. 从 jpg 原始开始
a_raw = Image.open(os.path.join(OUT, 'frame-A.jpg')).convert('RGBA')
b_raw = Image.open(os.path.join(OUT, 'frame-B.jpg')).convert('RGBA')
n_a = bfs_clear_bg(a_raw)
n_b = bfs_clear_bg(b_raw)
print('A BFS清背景', n_a, 'px; B BFS清背景', n_b, 'px')

n_wa = bfs_clear_watermark(a_raw)
n_wb = bfs_clear_watermark(b_raw)
print('A 清水印', n_wa, 'px; B 清水印', n_wb, 'px')

# 2. 裁切
A = crop_content(a_raw)
B = crop_content(b_raw)
print('A 裁切:', A.size, 'B 裁切:', B.size)

# 3. 对齐画布 + f2/f3
W = max(A.size[0], B.size[0])
H = max(A.size[1], B.size[1])
F2 = shift_up(to_canvas(A, W, H), 2)
F3 = to_canvas(B, W, H)

# 4. 上半身对称化
for name, im in [('f2', F2), ('f3', F3)]:
    mid = face_mid(im)
    px = im.load()
    for y in range(235, 1101):
        for x in range(mid):
            mx = 2 * mid - x
            if 0 <= mx < W:
                px[x, y] = px[mx, y]
            else:
                px[x, y] = (0, 0, 0, 0)
    print(name, '对称化 mid', mid)

# 5. f3 上半身 = f2(平移对齐中轴)
p2, p3 = F2.load(), F3.load()
mid2, mid3 = face_mid(F2), face_mid(F3)
dx = mid3 - mid2
print('中轴: f2=', mid2, 'f3=', mid3, 'dx=', dx)
for y in range(235, 1101):
    for x in range(W):
        sx = x - dx
        if 0 <= sx < W:
            p3[x, y] = p2[sx, y]
        else:
            p3[x, y] = (0, 0, 0, 0)

# 6. 保存
F2.save(os.path.join(OUT, 'walk-front-f2.png'))
F3.save(os.path.join(OUT, 'walk-front-f3.png'))
print('修复版已保存:', F2.size, F3.size)

# 7. 验证
for name in ['walk-front-f2.png', 'walk-front-f3.png']:
    im = Image.open(os.path.join(OUT, name)).convert('RGBA')
    W2, H2 = im.size
    px = im.load()
    skin_rows = []
    for y0 in [700, 800, 900]:
        skin = sum(1 for x in range(W2) if px[x, y0][3] > 0
                   and px[x, y0][0] > 160 and px[x, y0][1] > 110 and px[x, y0][2] > 70)
        skin_rows.append(skin)
    bg_res = sum(1 for y in range(H2) for x in range(W2)
                 if px[x, y][3] > 0 and bg_dist(*px[x, y][:3]) < BG_TOL)
    wm_res = sum(1 for y in range(H2) for x in range(W2)
                 if px[x, y][3] > 0 and is_wm(*px[x, y][:3]))
    print(name, f'验证: 躯干肤色 y700/800/900={skin_rows}, 背景残留={bg_res}, 水印残留={wm_res}')
