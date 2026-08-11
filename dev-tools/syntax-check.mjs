// 用 fs 读文件后 new Function 不可行（ESM）。改用 vm.SourceTextModule 报错定位
// 直接用 Node 的 module 编译错误信息（它已给出 1048 行）。这里只做二次确认。
import fs from 'node:fs';
const f = 'C:/Users/24601/Desktop/文字植物大战僵尸-优化版(1)(1)/文字植物大战僵尸-优化版(1)/source-code/mod-wasteland/survival.js';
const src = fs.readFileSync(f, 'utf8');
// 逐段编译定位：把文件按 function 切段，每段 vm 编译
// 简单方案：找到第 1048 行 export，往前找最近的函数声明，检查该函数是否括号完整
const lines = src.split('\n');
// 从 1048 往前找 function
for (let i = 1046; i >= 0; i--) {
    if (/function\s+\w+/.test(lines[i])) {
        console.log('Function near line', i + 1, ':', lines[i].trim().slice(0, 80));
        break;
    }
}
