# 基底重设计：6px 细腻颗粒 + biome 纹理差异化
import io
p = 'dev-tools/_grass-preview.html'
s = io.open(p, encoding='utf-8').read()

old = """function renderBaseSeason(ctx, seed, biome, tx, ty, seasonKey) {
  const bc = biomeColor(seed, tx, ty, biome);
  const off = (SEASON_BG[seasonKey] || SEASON_BG.summer).off;
  const ox = tx * TS, oy = ty * TS;
  for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
    const vx = tx * 4 + sx, vy = ty * 4 + sy;
    const lo = grassNoise(seed ^ 0x1A5C, vx, vy, 4);
    const hi = grassNoise(seed ^ 0x77E1, vx, vy, 2);
    const vary = Math.round((lo - 0.5) * 10 + (hi - 0.5) * 4);
    const r = Math.max(0, Math.min(255, bc[0] + off[0] + vary));
    const g = Math.max(0, Math.min(255, bc[1] + off[1] + vary));
    const b = Math.max(0, Math.min(255, bc[2] + off[2] + vary));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(ox + sx * 9, oy + sy * 9, 9, 9);
  }
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.35;
  drawWrap(ctx, texTile, ox, oy, tx, ty);
  ctx.globalAlpha = 0.4;
  drawWrap(ctx, patchTile, ox, oy, tx, ty);
  ctx.globalAlpha = 0.25;
  drawWrap(ctx, toneTile, ox, oy, tx, ty);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}"""

new = """// biome 颗粒幅度（城区平整 / 郊区适中 / 荒野斑驳 / 废墟最碎）——基底纹理按地形差异化
const BIOME_GRIT = [3, 5, 7, 8];
function renderBaseSeason(ctx, seed, biome, tx, ty, seasonKey) {
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

assert old in s, 'renderBaseSeason not found'
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('base redesign ok')
