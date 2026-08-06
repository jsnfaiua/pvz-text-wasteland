# 基底去"四条色块"：预览页改真实 biome 平滑（双线性插值，不固定行）
import io
p = 'dev-tools/_grass-preview.html'
s = io.open(p, encoding='utf-8').read()

# 1. renderBaseSeason 内部用 biomeColor 平滑（无 fixedBiome → hash 选 biome + 双线性）；BIOME_GRIT 按 biome 取值
old = """function renderBaseSeason(ctx, seed, biome, tx, ty, seasonKey, density) {
  const bc = biomeColor(seed, tx, ty, biome);"""
new = """function renderBaseSeason(ctx, seed, biome, tx, ty, seasonKey, density) {
  // biome 参数仅供 BIOME_GRIT；基底色用 biomeColor 平滑（hash 选 biome + 双线性插值 → 无硬切色带）
  const bc = biomeColor(seed, tx, ty);"""
assert old in s, 'renderBaseSeason head not found'
s = s.replace(old, new)

# 2. 简化 renderBase(ctx, seed, biome, tx, ty) 兼容（图鉴用）——已存在，无需改

# 3. buildCol 两处调用：去掉 ty%4 → 传 0（内部已忽略 biome 选色）
s = s.replace("renderBaseSeason(bc, seed, ty % 4, tx, ty, c.season);   // 季节地面背景", "renderBaseSeason(bc, seed, 0, tx, ty, c.season);   // 季节地面背景（biome 色内部平滑）")
s = s.replace("renderBaseSeason(bc, seed, ty % 4, tx, ty, c.season, density);", "renderBaseSeason(bc, seed, 0, tx, ty, c.season, density);")

io.open(p, 'w', encoding='utf-8').write(s)
print('smooth base patched')
