# 基底修复（基于实际代码）：降条纹 + 密度关联明暗
import io
p = 'dev-tools/_grass-preview.html'
s = io.open(p, encoding='utf-8').read()

old = """function renderBaseSeason(ctx, seed, biome, tx, ty, seasonKey) {
  const bc = biomeColor(seed, tx, ty, biome);
  const off = (SEASON_BG[seasonKey] || SEASON_BG.summer).off;
  const ox = tx * TS, oy = ty * TS;
  const grit = BIOME_GRIT[biome] || 5;
  // 6px 细腻颗粒（值噪声连续 → 像像素草地质地；biome 决定颗粒幅度）
  for (let sy = 0; sy < 6; sy++) for (let sx = 0; sx < 6; sx++) {
    const vx = tx * 6 + sx, vy = ty * 6 + sy;
    const lo = grassNoise(seed ^ 0x1A5C, vx, vy, 3);   // 6px 平滑颗粒
    const hi = hash2(seed ^ 0x77E1, vx, vy);            // 2px 微噪（更细）
    const vary = Math.round((lo - 0.5) * grit * 2 + (hi - 0.5) * 2);
    const r = Math.max(0, Math.min(255, bc[0] + off[0] + vary));
    const g = Math.max(0, Math.min(255, bc[1] + off[1] + vary));
    const b = Math.max(0, Math.min(255, bc[2] + off[2] + vary));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(ox + sx * 6, oy + sy * 6, 6, 6);
  }
  // 3 层无缝噪声 overlay（色斑加强 → 明显深浅 patch，告别平板）
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.4;
  drawWrap(ctx, texTile, ox, oy, tx, ty);
  ctx.globalAlpha = 0.5;
  drawWrap(ctx, patchTile, ox, oy, tx, ty);
  ctx.globalAlpha = 0.28;
  drawWrap(ctx, toneTile, ox, oy, tx, ty);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}"""
new = """function renderBaseSeason(ctx, seed, biome, tx, ty, seasonKey, density) {
  const bc = biomeColor(seed, tx, ty, biome);
  const off = (SEASON_BG[seasonKey] || SEASON_BG.summer).off;
  const dens = density || 0;   // 草密度关联明暗：正=亮（草疏）、负=暗（草密），±5 柔和
  const ox = tx * TS, oy = ty * TS;
  const grit = BIOME_GRIT[biome] || 5;
  // 6px 细腻颗粒（幅度收紧避免条纹感）
  for (let sy = 0; sy < 6; sy++) for (let sx = 0; sx < 6; sx++) {
    const vx = tx * 6 + sx, vy = ty * 6 + sy;
    const lo = grassNoise(seed ^ 0x1A5C, vx, vy, 3);
    const hi = hash2(seed ^ 0x77E1, vx, vy);
    const vary = Math.round((lo - 0.5) * grit * 1.4 + (hi - 0.5) * 2);
    const r = Math.max(0, Math.min(255, bc[0] + off[0] + vary + dens));
    const g = Math.max(0, Math.min(255, bc[1] + off[1] + vary + dens));
    const b = Math.max(0, Math.min(255, bc[2] + off[2] + vary + dens));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(ox + sx * 6, oy + sy * 6, 6, 6);
  }
  // 3 层无缝噪声 overlay（降条纹：patch 0.5→0.28 / tone 0.28→0.16——条带感主源）
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.4;
  drawWrap(ctx, texTile, ox, oy, tx, ty);
  ctx.globalAlpha = 0.28;
  drawWrap(ctx, patchTile, ox, oy, tx, ty);
  ctx.globalAlpha = 0.16;
  drawWrap(ctx, toneTile, ox, oy, tx, ty);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}"""
assert old in s, 'renderBaseSeason not found'
s = s.replace(old, new)

old2 = """  c.list = new Map();
  for (let tx = 0; tx < 6; tx++) for (let ty = 0; ty < 4; ty++) {
    c.list.set(tx + ',' + ty, styleClusterList(seed, SEASONS2[c.season], tx, ty));
  }
}"""
new2 = """  c.list = new Map();
  for (let tx = 0; tx < 6; tx++) for (let ty = 0; ty < 4; ty++) {
    c.list.set(tx + ',' + ty, styleClusterList(seed, SEASONS2[c.season], tx, ty));
  }
  // 基底按草密度调明暗：草多→暗、草疏→亮（柔和 ±5；平均束数约 1.3）
  for (let tx = 0; tx < 6; tx++) for (let ty = 0; ty < 4; ty++) {
    const dens = (c.list.get(tx + ',' + ty) || []).length;
    const density = Math.max(-6, Math.min(6, Math.round((1.3 - dens) * 3)));
    bc.save(); bc.scale(zoom, zoom);
    renderBaseSeason(bc, seed, ty % 4, tx, ty, c.season, density);
    bc.restore();
  }
}"""
assert old2 in s, 'buildCol tail not found'
s = s.replace(old2, new2)

io.open(p, 'w', encoding='utf-8').write(s)
print('base-fix patched ok')
