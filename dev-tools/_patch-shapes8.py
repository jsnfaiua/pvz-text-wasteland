# 注入 8 形态逻辑
import io
p = 'dev-tools/_grass-preview.html'
s = io.open(p, encoding='utf-8').read()

old = """function mkStyleCluster(style, seed, frame) {
  const SWING = [-3, -1.5, 0, 1.5, 3][frame] || 0;
  const w = style.w, h = style.h;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  const n = style.blades[0] + (hash2(seed, 1, 1) * (style.blades[1] - style.blades[0] + 1) | 0);
  const bunchTint = (0.85 + hash2(seed, 9, 9) * 0.3) * (style.tint || 1);
  const cols = bladeColors(style);
  const shade = v => Math.max(0, Math.min(255, Math.round(v * bunchTint)));
  const hex = hx => [parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16)];
  const dc = hex(cols.dry);
  // 束级双色（A1+A3 混合）：整束 65% 用 A1 原色 / 35% 用 A3 亮色（A1 主体不改）
  let outHex = cols.out, coreHex = cols.core;
  if (style.twin && style.twinCols && hash2(seed, 11, 99) > 0.35) {
    const t = style.twinCols.bright;
    outHex = t[0]; coreHex = t[1];
  }
  const oc = hex(outHex), cc = hex(coreHex);
  for (let i = 0; i < n; i++) {
    const bx = 1 + (hash2(seed, i, 2) * (w - 5) | 0);
    const bh = style.len[0] + (hash2(seed, i, 3) * (style.len[1] - style.len[0] + 1) | 0);
    const bend = (hash2(seed, i, 4) - 0.5) * 5;
    const phase = hash2(seed, i, 5) * Math.PI * 2;
    const dryTip = hash2(seed, i, 6) > (1 - style.dry);"""

new = """function mkStyleCluster(style, seed, frame, shape) {
  shape = shape || 0;
  const SWING = [-3, -1.5, 0, 1.5, 3][frame] || 0;
  const w = style.w, h = style.h;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  const n = style.blades[0] + (hash2(seed, 1, 1) * (style.blades[1] - style.blades[0] + 1) | 0);
  const bunchTint = (0.85 + hash2(seed, 9, 9) * 0.3) * (style.tint || 1);
  const cols = bladeColors(style);
  const shade = v => Math.max(0, Math.min(255, Math.round(v * bunchTint)));
  const hex = hx => [parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16)];
  const dc = hex(cols.dry);
  // 束级双色（A1+A3 混合）：整束 65% 用 A1 原色 / 35% 用 A3 亮色（A1 主体不改）
  let outHex = cols.out, coreHex = cols.core;
  if (style.twin && style.twinCols && hash2(seed, 11, 99) > 0.35) {
    const t = style.twinCols.bright;
    outHex = t[0]; coreHex = t[1];
  }
  const oc = hex(outHex), cc = hex(coreHex);
  const rnd = (i) => style.len[0] + (hash2(seed, i, 3) * (style.len[1] - style.len[0] + 1) | 0);
  for (let i = 0; i < n; i++) {
    // —— 8 种束形态：bx/bh/bend 按 shape 差异化 ——
    let bx, bh, bend;
    if (shape === 4) {        // ⑤ 双簇：左右两组草叶
      const left = i % 2 === 0;
      bx = 1 + (left ? hash2(seed, i, 20) * 7 : 14 + hash2(seed, i, 21) * 7);
      bh = rnd(i);
      bend = (hash2(seed, i, 4) - 0.5) * 4;
    } else if (shape === 5) { // ⑥ 高矮参差：第 1 根高草 + 其余矮草
      bx = 1 + (hash2(seed, i, 2) * (w - 5) | 0);
      bh = Math.round((i === 0 ? 1.4 : 0.72) * rnd(i));
      bend = (hash2(seed, i, 4) - 0.5) * 4;
    } else if (shape === 6) { // ⑦ 扇面展开：根部集中、尖部均匀散开
      bx = 2 + (hash2(seed, i, 2) * 5 | 0);
      bh = rnd(i);
      bend = (i - (n - 1) / 2) * 2.4;
    } else if (shape === 7) { // ⑧ 偏风草：全部同向倾斜（风吹偏）
      bx = 1 + (hash2(seed, i, 2) * (w - 5) | 0);
      bh = rnd(i);
      bend = 1.5 + hash2(seed, i, 4) * 3;
    } else {                  // ①-④ 随机错落/紧凑/散开（靠 seed 区分）
      bx = 1 + (hash2(seed, i, 2) * (w - 5) | 0);
      bh = rnd(i);
      bend = (hash2(seed, i, 4) - 0.5) * 5;
    }
    const phase = hash2(seed, i, 5) * Math.PI * 2;
    const dryTip = hash2(seed, i, 6) > (1 - style.dry);"""

assert old in s, 'mkStyleCluster head not found'
s = s.replace(old, new)

# 生成瓦片：seasonClusters kind 0-7（shape 参数）
old2 = """  seasonClusters2[k] = [];
  for (let f = 0; f < 5; f++) seasonClusters2[k].push([
    mkStyleCluster(SEASONS2[k], 91 + k.charCodeAt(0), f),
    mkStyleCluster(SEASONS2[k], 103 + k.charCodeAt(0), f),
    mkStyleCluster(SEASONS2[k], 117 + k.charCodeAt(0), f),
    mkStyleCluster(SEASONS2[k], 139 + k.charCodeAt(0), f),
  ]);"""
new2 = """  seasonClusters2[k] = [];
  for (let f = 0; f < 5; f++) {
    const frames = [];
    for (let sh = 0; sh < 8; sh++) {
      frames.push(mkStyleCluster(SEASONS2[k], 91 + k.charCodeAt(0) + sh * 7, f, sh));
    }
    seasonClusters2[k].push(frames);
  }"""
assert old2 in s, 'clusters2 gen not found'
s = s.replace(old2, new2)

# clusterList kind 0-7
old3 = "out.push({ cx2, cy2, kind: (hash2(seed, cx, cy) * 4) | 0 });"
new3 = "out.push({ cx2, cy2, kind: (hash2(seed, cx, cy) * 8) | 0 });"
assert old3 in s, 'kind gen not found'
s = s.replace(old3, new3)

io.open(p, 'w', encoding='utf-8').write(s)
print('8-shape injected ok')
