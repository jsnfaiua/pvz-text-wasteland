# 转换预览页为四季草样式
import io, sys
p = 'dev-tools/_grass-preview.html'
s = io.open(p, encoding='utf-8').read()

old_html = '''<div class="panel" style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;min-width:1100px;">
  <div class="col">
    <h2>A1 · <b>基础草甸</b></h2>
    <div style="font-size:11px;color:#7a8a92;margin-bottom:6px;">8-12px 长草 · 枯黄尖 · 稀疏小花<br>通用基准</div>
    <canvas id="gA1" width="216" height="144"></canvas>
  </div>
  <div class="col">
    <h2>A2 · <b>露珠草甸</b></h2>
    <div style="font-size:11px;color:#7a8a92;margin-bottom:6px;">长草 + 草尖露珠（浅蓝/白高光）<br>清晨湿润感</div>
    <canvas id="gA2" width="216" height="144"></canvas>
  </div>
  <div class="col">
    <h2>A3 · <b>双色草簇</b></h2>
    <div style="font-size:11px;color:#7a8a92;margin-bottom:6px;">深绿/亮黄绿草叶交织<br>层次更丰富</div>
    <canvas id="gA3" width="216" height="144"></canvas>
  </div>
  <div class="col">
    <h2>A4 · <b>花甸</b></h2>
    <div style="font-size:11px;color:#7a8a92;margin-bottom:6px;">长草 + 5 色繁花<br>花园氛围最浓</div>
    <canvas id="gA4" width="216" height="144"></canvas>
  </div>
  <div class="col">
    <h2>A5 · <b>秋光草甸</b></h2>
    <div style="font-size:11px;color:#7a8a92;margin-bottom:6px;">棕绿草身 + 金黄草尖<br>秋日暖阳感</div>
    <canvas id="gA5" width="216" height="144"></canvas>
  </div>
</div>'''
new_html = '''<div class="panel" style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;min-width:920px;">
  <div class="col">
    <h2>🌸 <b>春</b></h2>
    <div style="font-size:11px;color:#7a8a92;margin-bottom:6px;">嫩绿新草 · 花最多<br>草短偏嫩</div>
    <canvas id="gspring" width="216" height="144"></canvas>
  </div>
  <div class="col">
    <h2>☀️ <b>夏</b></h2>
    <div style="font-size:11px;color:#7a8a92;margin-bottom:6px;">深绿茂盛 · 草最长<br>基础草甸（你选的 A1）</div>
    <canvas id="gsummer" width="216" height="144"></canvas>
  </div>
  <div class="col">
    <h2>🍂 <b>秋</b></h2>
    <div style="font-size:11px;color:#7a8a92;margin-bottom:6px;">棕绿草身 · 金黄草尖<br>秋日暖阳感</div>
    <canvas id="gautumn" width="216" height="144"></canvas>
  </div>
  <div class="col">
    <h2>❄️ <b>冬</b></h2>
    <div style="font-size:11px;color:#7a8a92;margin-bottom:6px;">枯灰草叶 · 积雪白点<br>地面保持不变</div>
    <canvas id="gwinter" width="216" height="144"></canvas>
  </div>
</div>'''
assert old_html in s, 'html block not found'
s = s.replace(old_html, new_html)

old_cols = "const cols = ['A1', 'A2', 'A3', 'A4', 'A5'].map(k => {"
new_cols = "const cols = ['spring', 'summer', 'autumn', 'winter'].map(k => {"
assert old_cols in s, 'cols not found'
s = s.replace(old_cols, new_cols)

# STYLES → SEASONS / styleClusters → seasonClusters
s = s.replace('STYLES[c.k]', 'SEASONS[c.k]')
s = s.replace('styleClusters', 'seasonClusters')
s = s.replace('for (const k of Object.keys(STYLES)) {', 'for (const k of Object.keys(SEASONS)) {')
s = s.replace('mkStyleCluster(STYLES[k]', 'mkStyleCluster(SEASONS[k]')
s = s.replace('const styleClusters = {};', 'const seasonClusters = {};')
# 顶栏说明
s = s.replace('四列共用同一地面（已定稿不动）· 只有草层不同', '四季草样式（以你选的 A1 基础草甸为底）· 地面共用定稿不动 · 冬草带积雪')
io.open(p, 'w', encoding='utf-8').write(s)
print('patched ok')
