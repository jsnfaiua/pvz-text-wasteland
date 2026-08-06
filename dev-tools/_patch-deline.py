# 基底去线：density 连续化 + overlay 再降
import io
p = 'dev-tools/_grass-preview.html'
s = io.open(p, encoding='utf-8').read()

# 1. buildCol：density 用平滑值噪声场（cell=1 连续，相邻格差 ≤1 级，无线）
old = """  // 基底按草密度调明暗：草多→暗、草疏→亮（柔和 ±5；平均束数约 1.3）
  for (let tx = 0; tx < 6; tx++) for (let ty = 0; ty < 4; ty++) {
    const dens = (c.list.get(tx + ',' + ty) || []).length;
    const density = Math.max(-6, Math.min(6, Math.round((1.3 - dens) * 3)));
    bc.save(); bc.scale(zoom, zoom);
    renderBaseSeason(bc, seed, 0, tx, ty, c.season, density);
    bc.restore();
  }"""
new = """  // 基底明暗：草密处暗/草疏处亮——用连续值噪声场（cell=1 相邻格差 ≤1 级），避免整格跳变的线条
  for (let tx = 0; tx < 6; tx++) for (let ty = 0; ty < 4; ty++) {
    const densField = grassNoise(seed ^ 0xABCD, tx, ty, 1);
    const density = Math.round((0.55 - densField) * 6);   // -3..+3 连续
    bc.save(); bc.scale(zoom, zoom);
    renderBaseSeason(bc, seed, 0, tx, ty, c.season, density);
    bc.restore();
  }"""
assert old in s, 'density block not found'
s = s.replace(old, new)

# 2. renderBaseSeason overlay 再降（patch 0.28→0.2 / tone 0.16→0.12）；颗粒幅度 1.4→1.1
s = s.replace("const vary = Math.round((lo - 0.5) * grit * 1.4 + (hi - 0.5) * 2);", "const vary = Math.round((lo - 0.5) * grit * 1.1 + (hi - 0.5) * 2);")
s = s.replace("""  ctx.globalAlpha = 0.28;
  drawWrap(ctx, patchTile, ox, oy, tx, ty);
  ctx.globalAlpha = 0.16;
  drawWrap(ctx, toneTile, ox, oy, tx, ty);""", """  ctx.globalAlpha = 0.2;
  drawWrap(ctx, patchTile, ox, oy, tx, ty);
  ctx.globalAlpha = 0.12;
  drawWrap(ctx, toneTile, ox, oy, tx, ty);""")

io.open(p, 'w', encoding='utf-8').write(s)
print('de-line patched')
