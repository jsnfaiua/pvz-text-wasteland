# MC 角色 - v3 备份(当前动画全成果,唯一基准)

**备份时间**: 2026-08-08 03:15
**状态**: 走路 f2/f3(用户新图 d364/5d51 无背景无水印)+ 站立三方向(裁切统一高度)+ 全部 walk 帧。
**用途**: 顶替 v0/v1/v2,后续修复(绿色/黑色噪点)失败可回退到本版本。

## 内容
- `render.js` / `wbalance.js` — 当前渲染与数值
- `sprite-{front,side,back}.png` — 站立(已裁切到内容 bbox,统一高度 48px 渲染)
- `walk-{front,side,back}-f{0..3}.png` — 走路帧
  - front f2/f3 = 用户新图(934×2390 区域,裁切后 879×2360 / 934×2390)
  - front f0/f1 = 旧占位(走路用 f2/f3 交替,映射见 render.js WALK_FRAME_FILES)
  - side/back = v2 旧帧
- `_make-f2f3-from-new.py` — f2/f3 生成脚本(裁切+对称+f3=f2 上半身)
- `_rollback-f2f3.py` / `_fix-f2f3-v2.py` — 历史脚本

## 待修复问题(备份后开始)
- 走路时脚/臀部/左手周围绿色像素点跳来跳去
- 头部黑色像素点一闪一闪
