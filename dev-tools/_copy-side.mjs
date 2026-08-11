const fs = require('node:fs');
const src = 'C:/Users/24601/Desktop/未标题-1.png';
const dst = 'source-code/mod-wasteland/sprites/sprite-side.png';
if (!fs.existsSync(src)) { console.log('[skip] 源不存在:', src); process.exit(1); }
fs.copyFileSync(src, dst);
console.log('[ok ] sprite-side.png <- 未标题-1.png');