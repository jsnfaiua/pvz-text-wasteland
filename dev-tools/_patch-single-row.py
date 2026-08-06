# 预览页重构：单行 4 季（季节背景 + 混合草）
import io
p = 'dev-tools/_grass-preview.html'
s = io.open(p, encoding='utf-8').read()

# 1. cols 加 season 属性
old_cols = "const cols = ['spring', 'summer', 'autumn', 'winter'].map(k => {\n  const cv = document.getElementById('g' + k);\n  cv.addEventListener('pointermove', e => {\n    const r = cv.getBoundingClientRect();\n    mouse[k] = { x: (e.clientX - r.left) / (r.width / cv.width), y: (e.clientY - r.top) / (r.height / cv.height) };\n  });\n  cv.addEventListener('pointerleave', () => { mouse[k] = null; });\n  return { k, cv, ctx: cv.getContext('2d'), base: null, list: new Map() };\n});"
new_cols = "const cols = ['spring', 'summer', 'autumn', 'winter'].map(k => {\n  const cv = document.getElementById('g' + k);\n  cv.addEventListener('pointermove', e => {\n    const r = cv.getBoundingClientRect();\n    mouse[k] = { x: (e.clientX - r.left) / (r.width / cv.width), y: (e.clientY - r.top) / (r.height / cv.height) };\n  });\n  cv.addEventListener('pointerleave', () => { mouse[k] = null; });\n  return { k, season: k, cv, ctx: cv.getContext('2d'), base: null, list: new Map() };\n});"
assert old_cols in s, 'cols block not found'
s = s.replace(old_cols, new_cols)

# 2. 删 cols2 定义
import re
m = re.search(r"// 第二行：.*?\nconst cols2 = \[.*?\n\}\);\n", s, re.S)
if m:
    s = s.replace(m.group(0), '')
    print('cols2 removed')

# 3. drawFrame 只画 cols，用季节混合草
old_df = "  drawGrassRow(time, seed, zoom, cols, SEASONS, seasonClusters, '');\n  drawGrassRow(time, seed, zoom, cols2, SEASONS2, seasonClusters2, '2');"
new_df = "  drawGrassRow(time, seed, zoom, cols, SEASONS2, seasonClusters2, '');"
assert old_df in s, 'drawFrame calls not found'
s = s.replace(old_df, new_df)

# 4. drawGrassRow 的 styleTable 引用 SEASONS[c.k] 已在内部用 styleTable —— 传 SEASONS2 即可

io.open(p, 'w', encoding='utf-8').write(s)
print('patched ok')
