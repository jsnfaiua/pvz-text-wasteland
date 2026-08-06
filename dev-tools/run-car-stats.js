// 复查：失败案例中是否还有 goal=true 且 pl=0 的 route（穿墙模式残留）
const { execFileSync } = require('child_process');
const path = require('path');

const testPath = path.join(__dirname, 'car-pathfinding-test.js');
const runs = 8;
const failBlocks = [];

for (let i = 0; i < runs; i++) {
    let out;
    try {
        out = execFileSync(process.execPath, [testPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
        out = e.stdout ? e.stdout.toString() : '';
    }
    const lines = out.split(/\r?\n/);
    for (let j = 0; j < lines.length; j++) {
        if (lines[j].includes('FAIL seed')) {
            const block = [lines[j].trim()];
            for (let k = j + 1; k < Math.min(j + 30, lines.length); k++) {
                block.push(lines[k].trim());
                if (lines[k].includes('mods.tiles')) break;
            }
            failBlocks.push(block.join('\n'));
        }
    }
}

let emptyPathGoalTrue = 0, total = 0;
for (const b of failBlocks) {
    total++;
    const m = b.match(/route: goal=(true|false) best=([^ ]*) pathLen=(\d+)/);
    if (m && m[1] === 'true' && +m[3] === 0) {
        emptyPathGoalTrue++;
        console.log('=== 残留: goal=true 且 pathLen=0 ===');
        console.log(b.split('\n').slice(0, 8).join('\n'));
    }
}
console.log(`\n失败案例共 ${total} 个，其中 goal=true且pl=0 的残留：${emptyPathGoalTrue}`);
