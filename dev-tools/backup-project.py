# ============================================================
# backup-project.py — 项目 zip 快照备份（P2-5，不依赖远端）
# ------------------------------------------------------------
# 用途：将项目完整打包为 zip（含 .git 提交历史 + 源码 + 文档 +
#       音频资源），输出到项目外备份目录，保留最近 KEEP_N 份。
# 排除：运行时/本地数据（saves/users.json/.workbuddy/node_modules/
#       临时产物）——与 .gitignore 对齐，备份目标是代码资产。
# 用法：python dev-tools/backup-project.py
# ============================================================
import os, io, sys, time, zipfile, glob

# ---- 路径 ----
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)                       # 项目根
OUT_DIR = os.path.join(os.path.dirname(ROOT), '文字植物大战僵尸-优化版-backups')
KEEP_N = 5                                          # 保留最近 N 份

# ---- 排除规则（相对项目根；目录名匹配任意层级） ----
# .git 历史要保留（备份目标是代码资产+历史）；运行时/本地数据排除
EXCLUDE_DIRS = {'.workbuddy', 'node_modules', 'saves', '_qa_tmp'}
EXCLUDE_FILES = {'users.json'}
EXCLUDE_PATTERNS = ('*.bak', '*.bak-*', '*_cdp-*.png', '*.tmp', '*~', '*.swp', 'Thumbs.db', 'desktop.ini', '.DS_Store')

def excluded_dir(name, rel):
    if name in EXCLUDE_DIRS: return True
    return any(rel.startswith(d + os.sep) for d in EXCLUDE_DIRS)

def excluded_file(name):
    if name in EXCLUDE_FILES: return True
    for pat in EXCLUDE_PATTERNS:
        if glob.fnmatch.fnmatch(name, pat): return True
    return False

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    out = os.path.join(OUT_DIR, f'pz-wasteland-{stamp}.zip')
    count = 0
    total = 0
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for dirpath, dirnames, filenames in os.walk(ROOT):
            rel = os.path.relpath(dirpath, ROOT)
            # 剪枝排除目录
            dirnames[:] = [d for d in dirnames if not excluded_dir(d, os.path.join(rel, d))]
            for fn in filenames:
                if excluded_file(fn): continue
                fpath = os.path.join(dirpath, fn)
                arc = os.path.join(os.path.basename(ROOT), rel, fn) if rel != '.' else os.path.join(os.path.basename(ROOT), fn)
                try:
                    z.write(fpath, arc)
                    count += 1
                    total += os.path.getsize(fpath)
                except OSError as e:
                    print(f'  skip {arc}: {e}')
    size_mb = os.path.getsize(out) / 1048576
    print(f'✅ 备份完成: {out}')
    print(f'   文件数 {count}（原始 {total/1048576:.1f}MB → zip {size_mb:.1f}MB）')

    # 保留最近 KEEP_N 份，清理更旧的
    all_backups = sorted(glob.glob(os.path.join(OUT_DIR, 'pz-wasteland-*.zip')))
    for old in all_backups[:-KEEP_N]:
        os.remove(old)
        print(f'   清理旧备份: {os.path.basename(old)}')

    # 完整性校验
    with zipfile.ZipFile(out) as z:
        bad = z.testzip()
        print('   完整性: ' + ('✅ 全部文件可读' if bad is None else f'❌ 损坏: {bad}'))
    return 0

if __name__ == '__main__':
    sys.exit(main())
