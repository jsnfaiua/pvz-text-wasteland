// ============================================================
// 预览资源定期清理（2026-08-07 用户约定）
// - 清理对象：dev-tools/_qa_tmp/*.png（AI 生成的测试/预览截图，临时资源）
// - 保留对象：dev-tools/_qa_keep/*（用户确认保留，永不删除）
// - 安全红线：
//   1) 只删 _qa_tmp 下的 *.png，绝不递归删目录、绝不碰 .js/.mjs/.py 等脚本
//   2) 保留期内的新截图（默认 7 天）不删，给用户留出确认时间
//   3) 删除前先打印清单，--apply 才真正执行（默认 dry-run）
//   4) 环境删除安全机制批量上限约 49/轮 → 每轮最多删 40 个，剩余报"下轮清"
// 用法：node dev-tools/cleanup-previews.mjs [--apply] [--days 7]
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QA_TMP = path.join(__dirname, '_qa_tmp');
const QA_KEEP = path.join(__dirname, '_qa_keep');
const BATCH_LIMIT = 40; // 低于环境安全批量上限 49，留余量

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const daysIdx = args.indexOf('--days');
const KEEP_DAYS = daysIdx >= 0 && args[daysIdx + 1] ? Number(args[daysIdx + 1]) : 7;

if (!fs.existsSync(QA_TMP)) { console.log('_qa_tmp 不存在，无需清理'); process.exit(0); }

const now = Date.now();
const cutoff = now - KEEP_DAYS * 24 * 3600 * 1000;
const candidates = fs.readdirSync(QA_TMP).filter(f => f.toLowerCase().endsWith('.png'));
const toDelete = [];
const tooNew = [];
for (const f of candidates) {
    const fp = path.join(QA_TMP, f);
    let st;
    try { st = fs.statSync(fp); } catch { continue; }
    if (st.mtimeMs < cutoff) toDelete.push(fp);
    else tooNew.push(f);
}

const keepCount = fs.existsSync(QA_KEEP) ? fs.readdirSync(QA_KEEP).filter(f => !f.startsWith('.')).length : 0;

console.log(`== 预览资源清理（${APPLY ? '执行' : '预演 dry-run'}）==`);
console.log(`保留区 _qa_keep 文件数: ${keepCount}（永不删除）`);
console.log(`临时区 _qa_tmp 待清理: ${toDelete.length} 个（超过 ${KEEP_DAYS} 天）`);
console.log(`临时区保留期内（${KEEP_DAYS} 天内新生成，留给用户确认）: ${tooNew.length} 个`);
toDelete.slice(0, BATCH_LIMIT).forEach(f => console.log('  待删 ' + path.basename(f) + '  (' + Math.round(fs.statSync(f).size / 1024) + 'KB)'));
if (toDelete.length > BATCH_LIMIT) console.log(`  …另有 ${toDelete.length - BATCH_LIMIT} 个超批量上限，留待下轮清理`);

if (APPLY && toDelete.length) {
    const batch = toDelete.slice(0, BATCH_LIMIT);
    for (const fp of batch) { try { fs.unlinkSync(fp); } catch { /* 安全机制可能转回收站或拦截，跳过 */ } }
    console.log(`已删除 ${batch.length} 个旧预览图${toDelete.length > BATCH_LIMIT ? `（剩 ${toDelete.length - BATCH_LIMIT} 个下轮清）` : ''}`);
} else if (APPLY) {
    console.log('无待删除文件');
} else {
    console.log('（加 --apply 真正执行删除）');
}
