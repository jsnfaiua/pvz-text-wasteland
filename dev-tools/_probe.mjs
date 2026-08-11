// 临时脚本：读取 onDeath 完整 + softRespawn 完整 + 关键性能函数
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const f = resolve(root, 'source-code/mod-wasteland/survival.js');
const lines = readFileSync(f, 'utf8').split('\n');
// 找 onDeath
let onDeathStart = -1;
for (let i = 0; i < lines.length; i++) {
  if (/^function onDeath\b/.test(lines[i])) { onDeathStart = i; break; }
}
console.log('===== onDeath (' + (onDeathStart+1) + ') =====');
for (let i = onDeathStart; i < Math.min(onDeathStart + 130, lines.length); i++) console.log(`${i+1}: ${lines[i]}`);
