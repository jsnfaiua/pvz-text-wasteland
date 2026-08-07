// ============================================================
// wgrass.js — 草地渲染模块（独立）
// ------------------------------------------------------------
// 改草地视觉只改本文件：地面基底 / 草束形态 / 季节配色 / 风摆 / 踩动。
// render.js 只做两处调用：
//   grassRenderGround()  —— 静态层单格地面（biome 平滑 + 季节 + 颗粒 + 噪声）
//   grassRenderLayer()   —— 动态层草（8 形态束 + 风摆 + 玩家踩动）
// 季节：sv._season（0春 1夏 2秋 3冬，默认夏=1），未来季节系统直接改值。
// 性能：瓦片启动预渲染（4季×8形态×5帧=160 离屏 canvas），束位置按 seed 缓存，
//       每帧草层 = 视口内束 × 1 drawImage（基底在静态层离屏缓存）。
// 红线：纯渲染模块（只 import world/wconst 叶子），不碰循环依赖区。
// ============================================================

import { T, getTile, hash2 } from './world.js';
import { TS } from './wconst.js';

// ---------- 配置区（改草地视觉主要调这里） ----------
// 四季草束（A1+A3 混合：65% 束 A1 原色 + 35% 束 A3 亮色双调）+ 季节背景色调偏移
const SEASONS = [
  { // 0 春
    bg: [8, 12, 5],   // 地面季节偏移：提亮偏嫩绿
    blades: [6, 8], len: [7, 10], swing: 3, dry: 0.2, flower: 0.26, dens: 0.30, tint: 1.02,
    out: '#2a6a2a', core: '#a8d878', dry: '#8aa84a',
    bright: ['#3a7a2a', '#c0e090'],   // A3 亮色
  },
  { // 1 夏（定稿基准）
    bg: [0, 0, 0],
    blades: [5, 7], len: [8, 12], swing: 3, dry: 0.4, flower: 0.22, dens: 0.30, tint: 1,
    out: '#2c5428', core: '#cfdf8e', dry: '#b8a84a',
    bright: ['#3a6a30', '#e0f0a8'],
  },
  { // 2 秋
    bg: [9, -1, -12],   // 暖棕
    blades: [5, 7], len: [7, 11], swing: 3, dry: 0.7, flower: 0.12, dens: 0.30, tint: 1,
    out: '#5a5230', core: '#c8b45a', dry: '#d8a848',
    bright: ['#6a6a38', '#e0c868'],
  },
  { // 3 冬（草叶稀疏散开，无雪点——用户定稿）
    bg: [11, 9, 12],    // 提亮灰白（霜感）
    blades: [3, 5], len: [6, 9], swing: 2, dry: 0.9, flower: 0.06, dens: 0.24, tint: 0.95,
    out: '#5a5a52', core: '#b8b8a8', dry: '#c8c8b8',
    bright: ['#6a6a60', '#d0d0c0'],
  },
];
// biome 草地底色（城区/郊区/荒野/废墟）+ 颗粒幅度
const BIOME_GRASS = [
  [42, 56, 42], [46, 62, 42], [38, 64, 40], [50, 54, 40],
];
const BIOME_GRIT = [3, 5, 7, 8];
const CHUNK = 16;   // biome chunk 边长（与 world.js 一致）

// ---------- 工具 ----------
function grassNoise(seedSalt, tx, ty, cell) {
  const cx = Math.floor(tx / cell), cy = Math.floor(ty / cell);
  const fx = tx / cell - cx, fy = ty / cell - cy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v00 = hash2(seedSalt, cx, cy), v10 = hash2(seedSalt, cx + 1, cy);
  const v01 = hash2(seedSalt, cx, cy + 1), v11 = hash2(seedSalt, cx + 1, cy + 1);
  return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
}
// biome 草地色平滑（四角 chunk biome 色双线性 smoothstep → 无硬切色带）
function biomeColor(seed, tx, ty) {
  const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
  const fx = (tx - cx * CHUNK) / CHUNK, fy = (ty - cy * CHUNK) / CHUNK;
  const s = x => x * x * (3 - 2 * x);
  const sx = s(fx), sy = s(fy);
  const p = (cx2, cy2) => BIOME_GRASS[hash2(seed, cx2, cy2) * 4 | 0] || BIOME_GRASS[0];
  const a = p(cx, cy), b = p(cx + 1, cy), c = p(cx, cy + 1), d = p(cx + 1, cy + 1);
  const m = (u, v, t) => u + (v - u) * t;
  return [
    m(m(a[0], b[0], sx), m(c[0], d[0], sx), sy),
    m(m(a[1], b[1], sx), m(c[1], d[1], sx), sy),
    m(m(a[2], b[2], sx), m(c[2], d[2], sx), sy),
  ];
}
// drawImage 跨边 wrap（源矩形超出瓦片边缘 → 拆 2×2 补全对侧）
function drawWrap(c, tile, ox, oy, gx, gy) {
  const size = tile.width;
  const x1 = ((gx * TS) % size + size) % size, y1 = ((gy * TS) % size + size) % size;
  const w1 = Math.min(TS, size - x1), h1 = Math.min(TS, size - y1);
  c.drawImage(tile, x1, y1, w1, h1, ox, oy, w1, h1);
  if (w1 < TS) c.drawImage(tile, 0, y1, TS - w1, h1, ox + w1, oy, TS - w1, h1);
  if (h1 < TS) {
    c.drawImage(tile, x1, 0, w1, TS - h1, ox, oy + h1, w1, TS - h1);
    if (w1 < TS) c.drawImage(tile, 0, 0, TS - w1, TS - h1, ox + w1, oy + h1, TS - w1, TS - h1);
  }
}
// 无缝值噪声瓦片（wrap 角点 → 滚动采样无缝）
function makeNoiseTile(size, cell, salt, amp) {
  const gx = size / cell, gy = size / cell;
  const grid = [];
  for (let cy = 0; cy <= gy; cy++) for (let cx = 0; cx <= gx; cx++) {
    grid[cy * (gx + 1) + cx] = hash2(salt, cx % gx, cy % gy);
  }
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const c = cv.getContext('2d');
  const img = c.createImageData(size, size);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const fxc = px / cell, fyc = py / cell;
    const cx = Math.floor(fxc), cy = Math.floor(fyc);
    const fx = fxc - cx, fy = fyc - cy;
    const s = x => x * x * (3 - 2 * x);
    const sx = s(fx), sy = s(fy);
    const v00 = grid[cy * (gx + 1) + cx], v10 = grid[cy * (gx + 1) + cx + 1];
    const v01 = grid[(cy + 1) * (gx + 1) + cx], v11 = grid[(cy + 1) * (gx + 1) + cx + 1];
    const v = (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
    const d = Math.round((v - 0.5) * amp);
    const i = (py * size + px) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 128 + d;
    img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return cv;
}

// ---------- 草束瓦片（8 形态 × 5 摆动帧 × 4 季） ----------
function mkStyleCluster(season, seed, frame, shape) {
  const SWING = [-3, -1.5, 0, 1.5, 3][frame] || 0;
  const st = SEASONS[season];
  const w = 24, h = 16;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  const n = st.blades[0] + (hash2(seed, 1, 1) * (st.blades[1] - st.blades[0] + 1) | 0);
  const bunchTint = (0.85 + hash2(seed, 9, 9) * 0.3) * (st.tint || 1);
  const shade = v => Math.max(0, Math.min(255, Math.round(v * bunchTint)));
  const hex = hx => [parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16)];
  const dc = hex(st.dry);
  // 束级双色（A1+A3 混合）：65% A1 原色 / 35% A3 亮色
  let outHex = st.out, coreHex = st.core;
  if (hash2(seed, 11, 99) > 0.35) { outHex = st.bright[0]; coreHex = st.bright[1]; }
  const oc = hex(outHex), cc = hex(coreHex);
  const rnd = (i) => st.len[0] + (hash2(seed, i, 3) * (st.len[1] - st.len[0] + 1) | 0);
  for (let i = 0; i < n; i++) {
    let bx, bh, bend;
    if (shape === 4) {        // ⑤ 双簇
      const left = i % 2 === 0;
      bx = 1 + (left ? hash2(seed, i, 20) * 7 : 14 + hash2(seed, i, 21) * 7);
      bh = rnd(i);
      bend = (hash2(seed, i, 4) - 0.5) * 4;
    } else if (shape === 5) { // ⑥ 高矮参差
      bx = 1 + (hash2(seed, i, 2) * (w - 5) | 0);
      bh = Math.round((i === 0 ? 1.4 : 0.72) * rnd(i));
      bend = (hash2(seed, i, 4) - 0.5) * 4;
    } else if (shape === 6) { // ⑦ 扇面
      bx = 2 + (hash2(seed, i, 2) * 5 | 0);
      bh = rnd(i);
      bend = (i - (n - 1) / 2) * 2.4;
    } else if (shape === 7) { // ⑧ 偏风草
      bx = 1 + (hash2(seed, i, 2) * (w - 5) | 0);
      bh = rnd(i);
      bend = 1.5 + hash2(seed, i, 4) * 3;
    } else {                  // ①-④ 随机错落/紧凑/散开（seed 区分）
      bx = 1 + (hash2(seed, i, 2) * (w - 5) | 0);
      bh = rnd(i);
      bend = (hash2(seed, i, 4) - 0.5) * 5;
    }
    const phase = hash2(seed, i, 5) * Math.PI * 2;
    const dryTip = hash2(seed, i, 6) > (1 - st.dry);
    c.fillStyle = `rgb(${shade(oc[0])},${shade(oc[1])},${shade(oc[2])})`;
    for (let hh = 0; hh < bh; hh++) {
      const t = hh / bh;
      const y = h - 1 - hh;
      const wave = Math.sin(t * Math.PI * 0.5) * SWING * (st.swing / 3);
      const xoff = Math.round(bend * t + wave + Math.sin(phase + t * 2) * 0.6);
      c.fillRect(bx + xoff, y, 2, 1);
      if (hh === 0) c.fillRect(bx + xoff - 1, y + 1, 4, 1);
      if (dryTip && hh >= bh - 2) {
        c.fillStyle = `rgb(${shade(dc[0])},${shade(dc[1])},${shade(dc[2])})`;
        c.fillRect(bx + xoff, y, 2, 1);
        c.fillStyle = `rgb(${shade(oc[0])},${shade(oc[1])},${shade(oc[2])})`;
      }
    }
    c.fillStyle = `rgb(${shade(cc[0])},${shade(cc[1])},${shade(cc[2])})`;
    for (let hh = 1; hh < bh - 1; hh++) {
      const t = hh / bh;
      const y = h - 1 - hh;
      const wave = Math.sin(t * Math.PI * 0.5) * SWING * (st.swing / 3);
      const xoff = Math.round(bend * t + wave + Math.sin(phase + t * 2) * 0.6);
      c.fillRect(bx + xoff + 1, y, 1, 1);
    }
  }
  // 花点（点睛之笔：低饱和白/淡黄/淡粉，3×3 十字小野花 → 1x 下也可见，少而精）
  // 三修：①flowerKey 含 shape 因子 → 每形态独立判定（一季总有花，不再"全有或全无"）
  //       ②不含 frame → 花的有无与摆动帧无关（摆动中不闪烁消失）
  //       ③flowerSway 随帧横移（约草叶 60% 高度摆幅）→ 花跟着草一起随风动
  const flowerKey = seed ^ (shape * 131) ^ 0xF10A;
  if (hash2(flowerKey, 3, 3) > (1 - st.flower)) {
    const petals = ['rgba(250,250,242,0.95)', 'rgba(242,236,210,0.95)', 'rgba(243,234,226,0.95)'];
    const flowerSway = Math.round(SWING * (st.swing / 3) * 0.6);
    for (let f = 0; f < (hash2(seed, 4, 4) > 0.6 ? 2 : 1); f++) {
      let fx = 3 + (hash2(seed, f, 7) * (w - 7) | 0) + flowerSway;
      fx = Math.max(1, Math.min(w - 4, fx));
      const fy = Math.round(h * 0.32) + (hash2(seed, f, 8) * (h - 10) | 0);
      c.fillStyle = petals[(hash2(seed, f, 9) * 3) | 0];
      c.fillRect(fx + 1, fy, 1, 1);       // 上瓣
      c.fillRect(fx, fy + 1, 3, 1);       // 中横（左右瓣）
      c.fillRect(fx + 1, fy + 2, 1, 1);   // 下瓣
      c.fillStyle = 'rgba(250,246,190,0.95)';   // 亮花心
      c.fillRect(fx + 1, fy + 1, 1, 1);
    }
  }
  return cv;
}

// ---------- 模块级缓存 ----------
let _tiles = null;          // [season][frame][shape] 瓦片
let _noiseTiles = null;     // 地面 3 层无缝噪声
let _clusterCache = null;   // Map key=seed:gx,gy → 束列表
let _initSeed = null;

function ensureInit() {
  if (_tiles) return;
  _tiles = [];
  for (let s = 0; s < 4; s++) {
    const bySeason = [];
    for (let f = 0; f < 5; f++) {
      const shapes = [];
      for (let sh = 0; sh < 8; sh++) {
        shapes.push(mkStyleCluster(s, 91 + s * 31 + sh * 7, f, sh));
      }
      bySeason.push(shapes);
    }
    _tiles.push(bySeason);
  }
  _noiseTiles = {
    tex: makeNoiseTile(256, 2, 0x1A5C, 20),
    patch: makeNoiseTile(256, 10, 0x77E1, 32),
    tone: makeNoiseTile(256, 32, 0x3F7A, 32),
    // 四方连续像素颗粒（cell=1 → 每像素独立 hash，±7 受控色差）：草地表面像素质感主纹理
    // （与草分布 seed 独立随机；无缝平铺 → 游戏内四方连续效果）
    pixel: makeNoiseTile(256, 1, 0xBEEF, 14),
  };
}

// 束分布（跨格连续；位置缓存与季节无关，草密度统计用固定标准 0.30）
function clusterList(seed, tx, ty) {
  if (!_clusterCache || _clusterCache.seed !== seed) {
    _clusterCache = { seed, map: new Map() };
  }
  const key = tx + ',' + ty;
  const hit = _clusterCache.map.get(key);
  if (hit) return hit;
  const DENS = 0.30;   // 位置用夏标准（密度统计固定；季节密度差异在绘制时按 hash 过滤）
  const list = [];
  for (let cy = ty - 1; cy <= ty + 1; cy++) {
    for (let cx = tx - 1; cx <= tx + 1; cx++) {
      const v = grassNoise(seed ^ 0xDD, cx, cy, 1);
      if (v <= DENS) continue;
      const cx2 = cx * TS + hash2(seed, cx, cy) * (TS - 24);
      const cy2 = cy * TS + hash2(seed, cx + 7, cy + 11) * (TS - 16);
      if (cx2 + 24 > tx * TS && cx2 < tx * TS + TS && cy2 + 16 > ty * TS && cy2 < ty * TS + TS) {
        list.push({ cx2, cy2, gx: cx, gy: cy, kind: (hash2(seed, cx, cy) * 8) | 0 });
      }
    }
  }
  if (_clusterCache.map.size < 4000) _clusterCache.map.set(key, list);
  return list;
}

// ---------- 导出：地面单格（静态层） ----------
export function grassRenderGround(ctx, sv, tx, ty, x0, y0) {
  ensureInit();
  const seed = sv.world.seed;
  const season = sv._season == null ? 1 : sv._season;
  const st = SEASONS[season];
  const bc = biomeColor(seed, tx, ty);
  const grit = BIOME_GRIT[hash2(seed, tx >> 4, ty >> 4) * 4 | 0] || 5;
  // 坐标取整 + 最后子块 +1px 防缝（保留修复：避免格间露底深色缝）
  const ox = Math.round(x0), oy = Math.round(y0);
  // 真实草密度（周围 4 格 clusterList 束数，缓存命中便宜）：草密 → 暗、草疏 → 亮，幅度 ±6
  // 子块级双线性插值 → 完全连续，无格缝无线条（明暗真正对应上方草的位置）
  const g00 = clusterList(seed, tx, ty).length;
  const g10 = clusterList(seed, tx + 1, ty).length;
  const g01 = clusterList(seed, tx, ty + 1).length;
  const g11 = clusterList(seed, tx + 1, ty + 1).length;
  // 6px 子块：biome 平滑 + 季节偏移 + 颗粒 ±3~4 + 密度明暗
  for (let sy = 0; sy < 6; sy++) for (let sx = 0; sx < 6; sx++) {
    const vx = tx * 6 + sx, vy = ty * 6 + sy;
    const lo = grassNoise(seed ^ 0x1A5C, vx, vy, 3);
    const vary = Math.round((lo - 0.5) * grit * 1.1);
    const fx = sx / 6, fy = sy / 6;
    const top = g00 * (1 - fx) + g10 * fx;
    const bot = g01 * (1 - fx) + g11 * fx;
    const dens = Math.round((1.3 - (top * (1 - fy) + bot * fy)) * 4);
    const r = Math.max(0, Math.min(255, bc[0] + st.bg[0] + vary + dens));
    const g = Math.max(0, Math.min(255, bc[1] + st.bg[1] + vary + dens));
    const b = Math.max(0, Math.min(255, bc[2] + st.bg[2] + vary + dens));
    const cw = sx === 5 ? 7 : 6, ch = sy === 5 ? 7 : 6;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(ox + sx * 6, oy + sy * 6, cw, ch);
  }
  // 四方连续像素颗粒 overlay（±7 受控色差，无缝平铺主纹理）+ 大尺度明暗（低对比防条纹）
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.5;
  drawWrap(ctx, _noiseTiles.pixel, ox, oy, tx, ty);
  ctx.globalAlpha = 0.2;
  drawWrap(ctx, _noiseTiles.patch, ox, oy, tx, ty);
  ctx.globalAlpha = 0.1;
  drawWrap(ctx, _noiseTiles.tone, ox, oy, tx, ty);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

// ---------- 导出：动态草层（风摆 + 玩家踩动） ----------
export function grassRenderLayer(ctx, sv, camX, camY, W, H) {
  ensureInit();
  const seed = sv.world.seed;
  const season = sv._season == null ? 1 : sv._season;
  const st = SEASONS[season];
  const t0x = Math.floor(camX / TS) - 1, t0y = Math.floor(camY / TS) - 1;
  const t1x = Math.ceil((camX + W) / TS) + 1, t1y = Math.ceil((camY + H) / TS) + 1;
  const tiles = _tiles[season];
  for (let ty = t0y; ty <= t1y; ty++) {
    for (let tx = t0x; tx <= t1x; tx++) {
      const t = getTile(sv, tx, ty);
      if (t !== T.GROUND && t !== T.WEED) continue;   // 只画草地
      const list = clusterList(seed, tx, ty, st.dens);
      for (const b of list) {
        const sx = b.cx2 - camX, sy = b.cy2 - camY;
        if (sx < -32 || sx > W + 32 || sy < -32 || sy > H + 32) continue;
        // 风摆 + 踩动
        const wind = Math.sin(sv.now * 1.2 + (b.cx2 + b.cy2) * 0.02) * 2;
        let perturb = 0;
        if (sv.px != null) {
          const dist = Math.hypot(sv.px - b.cx2, sv.py - b.cy2);
          if (dist < 90) perturb = (1 - dist / 90) * 5;
        }
        const sway = wind + perturb;
        const frame = Math.max(0, Math.min(4, Math.round((sway / 6) * 2 + 2)));
        ctx.drawImage(tiles[frame][b.kind], sx - 12, sy - 8);
      }
    }
  }
}

// ---------- 导出：季节切换（未来季节系统调用） ----------
export function grassSetSeason(sv, season) {
  sv._season = ((season % 4) + 4) % 4;
}
