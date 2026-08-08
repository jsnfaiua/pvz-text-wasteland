# 开发规则 · 强制契约（Repository Guidelines）

> **本文件是仓库内最高优先级的开发规则。** 本文件与 `docs/系统架构与设计文档.md`
> （权威设计基准，含 `docs/architecture-diagram.svg`）共同构成开发契约；两者冲突时
> 以基线文档为准，基线文档未覆盖处按本文件执行。
> **语义强度**：「必须 / 禁止 / 不得」= 硬性规则，违反即缺陷（defect），不得以
> 「设计选择」为由保留；「建议 / 可以」= 非硬性。
> **任何改动必须满足 §9 验证矩阵；未验证的改动不得提交。**
> **新功能默认门槛：所有新开发的功能必须满足单机/联机零差异（§5.1）；禁止「单机先行、联机后补」。**

---

## 0. 规则优先级

1. 本文件（AGENTS.md）> `docs/系统架构与设计文档.md` > `docs/ARCHITECTURE.md` > 代码注释。
2. 硬性规则冲突时，**更严格的一方生效**；拿不准时先问，禁止自行猜测后大量返工。

---

## 1. 项目结构与模块职责

浏览器端文字主题 PvZ 游戏：`index.html` / `style.css` / `game-init.js` 为页面、全局样式、
应用入口。可复用 JS 一律放 `source-code/`，职责分区如下：

| 目录 | 职责 | 说明 |
|---|---|---|
| `source-code/core/` | 引擎原语 | 不依赖业务 |
| `source-code/systems/` | 玩法行为 | |
| `source-code/entities/` | 玩家逻辑 | |
| `source-code/ui/` | 屏幕与 HUD | |
| `source-code/persistence/` | 持久化 | |
| `source-code/multiplayer/` | 联机 | |
| `source-code/mod-wasteland/` | 荒原模组 | 唯一允许引用 wstate/survival 的区域 |

- `assets/audio/`：音频资源；`docs/`：设计文档；
  **`saves/` 与 `users.json` 是运行时数据，不是源码**，禁止提交、禁止写入测试逻辑。
- **循环依赖区（禁止把新模块拖入）**：`render↔windoor↔wzombie`、`wnpc↔wgear`、
  `wvehicle→wdev→wnpc→wvehicle`。新增模块必须靠 `wstate.js` 的 `STATE_DEPS` 注入等方式
  规避环依赖，而非新增环边。

---

## 2. 运行与构建

无需安装依赖（仅 `peer` 包）、无编译步骤。

| 用途 | 命令 |
|---|---|
| 首选启动 | `RUN.bat`（:8000 + 打开游戏） |
| 直接启动 | `node server.js`（内置本地 PeerServer :9000） |
| 备用服务器 | `powershell -ExecutionPolicy Bypass -File ps-server.ps1` |
| 模块路径/重复声明检查 | `powershell -ExecutionPolicy Bypass -File dev-tools/CHECK-MODULES.ps1` |

测试命令见 §9 验证矩阵。

---

## 3. 代码风格（硬性）

- 浏览器代码一律 **ES modules**；4 空格缩进；语句分号；字符串单引号；多行对象尾逗号。
- 命名：变量/函数 `camelCase`，常量 `UPPER_SNAKE_CASE`。
- 模块聚焦（单一职责）；保持 `docs/ARCHITECTURE.md` 描述的依赖方向。
- 无 formatter/linter：**匹配相邻代码，禁止无关重排**。
- 注释精简，只注释关键逻辑；禁止逐行解释。

---

## 4. 序列化唯一真相源（红线 #2）

- **禁止 `JSON.stringify` 任何游戏状态对象（如 `sv`）** —— 其中含 DOM/canvas/函数引用，
  会抛错或静默损坏。存档与联机快照**必须**走 `source-code/mod-wasteland/wstate.js` 白名单：
  `serializeSV` / `applySnapshot` / `createRunDefaults` / `buildRun`。
- 新持久化/联机同步字段**必须加入 wstate.js 白名单**，禁止 ad hoc 序列化。
- 新增/变更存档字段**必须同步更新 wstate.js 头部「存档字段迁移表」**；历史档兼容由
  `buildRun` 自动迁移处理（如路带 SIDEWALK 还原），禁止跳过迁移直接改读法。
- `T.FLOOR` 与 `T.SIDEWALK` 值相同（`'·'`），**诊断/断言必须做对象值比较，禁止字符串字面量比较**。
- 触达本规则的改动后必须跑：`smoke-test.js` + `full-run-test.mjs`（见 §9）。

---

## 5. 不可破坏的红线（六条不变量）

以下六条**任何一条被破坏 = 缺陷**，禁止以「设计差异 / 已知问题」名义保留：

1. **单机 / 联机零差异**：联机除「多玩家共游」外，规则/反馈/数值/特效/音效/UI/掉落/
   结算/存档表现必须与单机完全一致。不一致必须修复（Checklist 见基线文档 §5）。
   **此红线覆盖所有新开发的功能**，具体门槛见 §5.1。
2. **序列化真相源 = wstate.js 白名单**（见 §4）。禁止 `JSON.stringify(sv)`。
3. **循环依赖区不扩大**（见 §1）。
4. **联机 host 权威模型完整保留**（见 §6）：guest 不扣血、僵尸按 id 合并、
   快照 34 格裁剪、NPC 队伍本地管理、世界档归 host —— 全部不得移除或削弱。
5. **性能防线不回归**（见 §7）：存档宏任务队列、A* 流场节流+近距化、驾驶 BFS 分帧、
   快照裁剪、实体硬上限、主循环防崩溃冻结 —— 全部不得回退。
6. **验证纪律**：按 §9 矩阵跑对应验证，改完必须验证通过才算完成。

### 5.1 新功能零差异门槛（所有新功能默认适用，2026-08-07 增补）

**任何新开发的功能（玩法 / 系统 / UI / 数值 / 实体 / 存档字段）从设计第一刻起必须满足
联机与单机体验完全一致；禁止「单机先行、联机后补」——后补必然产生差异。**
新功能设计时按以下检查表逐项核对，全部通过才算完成：

| # | 检查项 | 硬性要求 |
|---|---|---|
| 1 | 共用代码路径 | 单机与联机必须走同一套逻辑；禁止为 guest 特判出不同规则分支 |
| 2 | 序列化 | 新状态/实体/掉落/结算字段必须加入 wstate.js 白名单（存档与 wsync 共用同一真相源），并补 smoke 断言 |
| 3 | 权威归属 | 伤害/掉落/结算/召唤/交易/建造类逻辑必须 host 权威；guest 只上报意图 + 画表现 |
| 4 | 双端可见 | 新音效/特效/UI 反馈必须双端可听可见（34 格裁剪外 → wevt / outbox sfx） |
| 5 | 交互反馈 | 拾取/攻击/上下车等手感反馈双端一致（对照 §6 教训 1-10 逐条核对） |
| 6 | 全局事件 | 若涉及全局状态变更（camp/pause 类），必须双向同步 |
| 7 | 验证 | 全量回归 + 双端 CDP 实测（`_cdp-mp-real.mjs` 等，见 §9），单机/联机表现一致才可提交 |

违反本小节任何一项 = 缺陷；「功能单机正常但联机不一致」不得作为已知问题发布。

---

## 6. 联机架构硬规则（host 权威模型）

- 入口：`mod-wasteland/mpWasteland.js` 的 `startWastelandMP('host'|'guest')`，复用
  `window.Net.mp`（PeerJS 房间层）；握手 topic `wstart`（`{seed, difficulty, character}`），
  **host 生成 seed，双端本地确定性生成世界**（seed 确定性 = `world.js` hash2 纯函数）。
- 同步通道：`updateGuest` 分流；100ms `wsync` 快照
  （`serializeMpSnapshot`/`applyMpSnapshot`，**34 格空间裁剪** plants/drops/effects/bullets）；
  `wevt` 事件（`sv.mpOutbox` 50ms 中继）；`wdiff` 双向改地（`setTile` 上报）。
- **战斗 host 权威**：guest 只画特效 + 上报 atk；**guest 禁止本地扣自己 hp**；
  僵尸带运行时 id（`sv._zIdSeq`）并按 id 合并；掉落 host 生成、guest 拾取上报防重复。
- **NPC 队伍各自本地管理**（wsync 不带 npcs，防主控覆盖）；dev 属性共用
  （wsync 白名单 + `devflags` 事件）；召唤类 host 权威（`devcmd` 回传）。
- **泰拉瑞亚双档**：世界档 `wasteland_world_<seed>` 归 host（含双方 wdiff），
  guest 只落角色档 `wasteland_character_<名>`；断线重连 = guest 重连 → `wrejoin` →
  host 重发 winit + 立即补 wsync，重连期间 guest 本地世界继续运行。
- **联机教训（违反 = 不一致 bug，基线文档 §5.2）**：
  1. 序列化返回结构必须与消费方断言一致（对象 vs `Array.isArray` 不符会**静默失效**）；
  2. host 权威字段，guest 端发起的变更必须上报回传，否则「改了被还原」；
  3. 双向全局事件（camp/pause）放 `onWevt` 开头统一处理，直接本地应用不广播防回环；
  4. NPC 队伍不随 wsync 同步；guest 操控 NPC 用 `npcctl` 事件，host 让渡该 NPC AI；
  5. guest 端禁止直接扣自己 hp，死亡必须同步；
  6. 特效/掉落/植物同步做 34 格空间裁剪，视野外无可见差异，走进后 100ms 内出现；
  7. 音效必须双端可听：本地播完 outbox `sfx` 通知对端（带 snd 名与参数）；
  8. 暂停必须同步（任一端暂停 → 对端同步暂停），防「一端暂停另一端被打」；
  9. 僵尸新增必须走 `spawnZombie`（分配 id），禁止手工 push 无 id 对象；
  10. 改 wstate.js 后必跑 smoke + full-run；改存档键结构后补双端存档兼容测试。

---

## 7. 性能红线（帧率防线，基线文档 §6）

- **主循环（RAF）禁止冻结**：任何帧内异常必须被捕获兜底，禁止让游戏卡死白屏。
- **已落实防线（禁止回归）**：

| # | 防线 | 禁止回退为 |
|---|---|---|
| P0-1 | `saveNow` 宏任务队列（`_saveQueued` + setTimeout 0；退出/切后台 `flushSave` 兜底） | RAF 帧内整包 JSON 落盘 |
| P0-2 | 僵尸 A* 流场 `_pathRebuildCd` 0.35s 冷却复用旧场 | 每换格全量重建 |
| P0-3 | 联机快照 34 格空间裁剪（plants/drops/effects/bullets） | 全量序列化 |
| P0-4 | 驾驶 BFS 分帧（首建 6000/重建 3000 格预算，确定性）；乘客落点 null 安全 | 同步展开 6 万格 / 空 `canStand` 崩溃 |
| P0-5 | 特效合并键控 Map（kind+12px 桶）O(1) | 线性 find O(n²) |
| P0-8 | 流场 targets 近距化（Z_CHASE_RANGE=8 方形 + horde）+ `playerAlerted` 门控 | 全地图僵尸进 targets 周期重建 |
| P1-6 | NPC `eatFromInv/drinkFromInv/workLog` 缺字段防御 | 缺字段直接崩溃 |

- **实体硬上限不得绕过**：特效 ≤50、掉落 ≤150、子弹 ≤80、僵尸场上限 45；
  NPC 死尸帧边界移除；chunk 缓存 5s 清理。
- 新增逐帧逻辑**必须**评估帧开销，不得引入帧尖峰；host 是性能瓶颈端
  （guest 端 wsync 解析仅 ~0.3ms/拍），优化 host = 优化双端体感。

---

## 8. 联机 / 浏览器实测纪律

- 联机测试**必须双 Chrome 实例**（不同 `--user-data-dir`，9222/9223）——同 profile 双 tab
  因 IndexedDB 缓存冲突无法连 PeerJS（`peer-unavailable`）。
- headless WebRTC：先 navigate 到 `http://localhost:8000` 再测；本地 PeerServer :9000
  优先于公共云。
- **改 ES module 后必须清缓存 reload**：`Network.clearBrowserCache` +
  `Page.reload{ignoreCache:true}`，否则读到旧模块误判。
- Windows 批量跑 Node：**单进程 + `--expose-gc`，禁止 spawn 并行**（ENOENT）。

---

## 9. 验证矩阵（改什么 → 必须跑什么）

| 改动范围 | 必须验证 |
|---|---|
| 新增功能（玩法/UI/数值/实体/存档字段） | 全量回归（按涉及面跑 smoke/full-run/寻路/车辆）+ 双端 CDP 实测零差异核对（`_cdp-mp-real.mjs` / `_cdp-mp3.mjs`）；逐项过 §5.1 检查表 |
| 改 wbalance.js 数值 / 配方 / 概率表 | `smoke-test.js` 数值断言（概率权重和=1、DIFF 倍率映射、配方可达性）+ 受影响系统回归 |
| 改 wstate.js / survival.js 存档读写路径 | `smoke-test.js`（198 断言）+ `full-run-test.mjs`（多 seed 存档往返） |
| 改寻路（wpath.js / 僵尸 A* / NPC 寻路） | `astar-verify.mjs` |
| 改车辆驾驶/代驾/停车兜底 | `car-pathfinding-test.js`（**237/237 全绿基线**） |
| 改渲染 / 主循环 / 存档路径 | `full-run-test.mjs` + 浏览器实测 |
| 改渲染 / 主循环 / 联机 | 真实浏览器 CDP 双端实测：`dev-tools/_cdp-perf.mjs`（单机五场景 FPS）+ `dev-tools/_cdp-mp-real.mjs`（双实例真联机）；**双端 61fps、零长帧、零 `Runtime.exceptionThrown`** |
| 联机 3+ 人 | `dev-tools/_cdp-mp3.mjs`（三 Chrome 实例） |
| host 代驾 → guest driving 同步 | `dev-tools/_cdp-mp-car.mjs` |
| 任何改动 | 模块检查 `CHECK-MODULES.ps1` + 手动验证启动、受影响屏幕、存读档 |

- `smoke-test.js` 断言按「模块 + 行为」命名；纯函数逻辑必须补断言
  （含联机协议层 `mergeZombieList` / `serializeMpSnapshot` cull 断言）。
- 提交前手动验证：启动、改动屏幕、存/读档、相关联机行为。

---

## 10. 提交规范

- 遵循 Conventional Commits：`type(scope): 描述`，如 `feat(wasteland-mp): ...`、
  `fix: ...`；单行主语；每次提交只做一件事（scoped）。
- 分支：main + dev；本仓库**无远端**，git 历史于 2026-08-06 重建为 root-commit——
  **禁止依赖 git 历史做基线对比**。
- 提交信息须说明验证方式（引用 §9 对应命令与结果）。
- **禁止提交**：`saves/`、`users.json`、`*.bak`、`_qa_tmp/`、`_cdp-*.png`、`.workbuddy/`、
  个人存档/账号数据。提交前先确认 `.gitignore` 覆盖。

---

## 11. AI 协作纪律（Agent 专属，必须遵守）

1. **禁止批量删除文件**；删除单文件须一条命令一个文件，且先取得用户显式同意。
2. 多会话并行前，**共享文件（render.js / survival.js / world.js）先备份**。
3. 实现功能/修 bug 后，必须在 `docs/` 记录用法与配置方式（若属行为变更）。
4. 诊断纪律：先读错误信息定位根因 → 一次性修复 → 修完重新验证；
   **同一问题连续修 3 次未解决必须停下向用户说明**（已尝试方案），禁止反复小修小补。
5. `survival.js` 的 `debugGetSv()` 是测试钩子，**仅诊断用，禁止进生产路径**。
6. 荒原模块级 `sv` 单例 + RAF 主循环；入口 `enterWasteland(opts)`——新功能接入
   必须沿既有入口，禁止另起全局状态。
7. 开发基准 = `docs/系统架构与设计文档.md` + `docs/architecture-diagram.svg`；
   新增功能先对照基线文档确认归属章节，必要时同步更新基线文档。
8. **开发前审计 + 无损改动 + 及时止损（硬性流程）**：
   - **开发前审计**：改代码前先读目标函数及其调用方/依赖，评估影响面
     （序列化 §4 / 联机 §6 / 性能 §7 / 验证 §9 按涉及面）；影响面不明先问，**禁止盲改**。
   - **无损改动**：禁止破坏既有功能与行为（含旧档兼容、联机零差异）；
     确需变更既有行为时，必须先取得用户同意，并在提交说明中标注「行为变更」。
   - **及时止损**：一旦发现改动损伤既有功能，**立即停止继续开发**，先回滚或修复该处，
     禁止带着损伤继续做后续功能（修了 A 坏 B 时禁止接着做 C）。
   - **每次做完必查**：每个功能/修复完成即按 §9 矩阵跑对应验证 + 手工复查受影响屏幕/流程，
     确认无破坏才提交；提交信息写明验证结果。

---

## 12. 已知边界（非本次引入，改动时勿误判为回归）

- `car-pathfinding-test.js` 存在 1 个**原版既存**失败用例：车到达「最近可停处」后 4 个车门
  方向全被障碍挡住 → `stopDrive` 失败 → 车辆留在驾驶态（游戏内设计为「按 WASD 挪车后 F
  下车」，需玩家介入）。行为与原版一致，非回归。
- 废墟深处 >40 格的「死路」是真迷宫死路：替换为可达边界 + 提示，属合理行为。

---

## 13. 游戏开发规则（Game Dev · 13.1~13.8 硬性；13.9~13.11 建议）

### 13.1 数值唯一收口（硬性）

- 所有游戏数值 / 概率 / 倍率 / 属性表**必须定义在 `wbalance.js`（或具名 X_INFO 表）**，
  禁止在业务代码中散落魔法数字；局部派生常量可贴近使用处，但源值必须可追溯。
- 改数值必须跑 `smoke-test.js` 数值断言（若涉及）+ 受影响系统回归；数值断言命名
  `balance:<常量名>`。

### 13.2 随机确定性分级（硬性）

- 世界生成 / 双端必须一致的随机，**必须走 seed 派生纯函数**（`world.js hash2` /
  `wgrass.js grassNoise` 等）；禁止 `Math.random` 参与世界生成、存档字段或联机快照。
- `Math.random` 仅限运行时表现类随机（特效抖动、弹道散布等）——允许，但不得影响
  世界内容、存档内容或双端结算差异。

### 13.3 新增地块类型「四件套」（硬性）

- 新增 T 表地块必须同步完成四件事，缺一不可：
  ① `wconst.js` T 表登记；② 通行性接入（canStand / isWalk / 车辆判定）；
  ③ 渲染分类（render.js 静态层 / 草地 / 路面等）；④ 序列化（tiles 差分 + 迁移表默认值）。
- 禁止新增只改一处（如只画出来、不能走）的「半成品地块」。
- 诊断与断言中 `T.FLOOR` / `T.SIDEWALK` 等**同值地块必须对象值比较**（见 §4）。

### 13.4 新系统接入主循环 checklist（硬性）

任何新系统（玩法 / 实体 / 环境 / UI 更新）接入 `survival.js` RAF 主循环必须逐项核对：
① update 顺序注册（不破坏现有依赖序）；② 帧预算评估（§7，禁止帧尖峰）；
③ 暂停 / 离屏 / 切后台行为（挂起而非继续模拟）；④ onDeath / 重生边界处理；
⑤ 序列化白名单（§4）；⑥ 联机双端一致性（§5.1 检查表）。

### 13.5 文案收口（硬性）

- 玩家可见文案（播报 / 消息 / UI 标签 / 掉落与物品名 / 事件播报）统一走
  `wmsg.js pushMsg` 与具名常量（name + color），**禁止散落字符串字面量**；颜色从既有调色板取。
- 涉及新物品 / 新掉落时同步登记名称表（如 `WEDGE_INFO` / 掉落表）；文案改动不影响逻辑。

### 13.6 配方 / 概率表注册与断言（硬性）

- 新合成配方必须进 `wwordcraft-rules.js` 的 `RECIPES`（纯规则文件：不依赖 DOM / 音频 /
  浏览器全局，供系统与测试共用），并接入 `recipeAvailability` 统一判定。
- 概率表（掉落表 / 字源池等）**权重和必须 = 1**，在 `smoke-test.js` 中加断言；
  新增配方补可达性 / 输入输出断言。

### 13.7 难度倍率联动（硬性）

- 新增任何影响玩家 / 怪物 / 环境强度的数值，必须对照 `wbalance.js DIFF_TABLE.mul`
  （hardcore ×1.5）决定是否应受难度缩放——**漏乘 = 难度失效，属缺陷**。
- 新增难度档位必须同步：难度表 / 旧档归一映射 / UI / 存档键。

### 13.8 离屏缓存 key 完整维度（硬性）

- 任何新增的外观 / 状态维度（发型 / 动画状态 / 皮肤 / 季节 / 朝向等）**必须加入
  离屏缓存 key**（render.js 缓存 key 生成处）；缺失维度 = 脏读旧缓存 = 颜色错乱，属缺陷。
- 缓存 key 变更后跑渲染相关 CDP 实测（§9）。

### 13.9 CDP 脚本规范（建议）

- 新增浏览器实测脚本用 `_cdp-<场景>.mjs` 命名；文件头注释复现场景与断言目标；
  截图输出到 `_qa_tmp/`；一次性用途脚本完成后可清理，不进 git。

### 13.10 音频统一入口（建议）

- 音效统一走单一触发函数（snd 名 + 参数），本地播放 + 联机 outbox `sfx` 双端
  （§5.1 检查项 4）；禁止业务代码直接 new AudioContext 散落调用。

### 13.11 键盘全覆盖（建议）

- 新交互必须纯键盘可操作（方向键 / WASD / 数字键 / Enter 等）；鼠标为增强而非必需。

### 13.12 预览资源定期清理（硬性）

- **预览产物（CDP 截图 `_cdp-*.png`、`_qa_tmp/` 临时文件、临时预览页 `_*-preview.html`、
  临时 json 快照等）在预览验收完成后必须清理**；至少每个功能迭代结束 / 提交前清一次，
  禁止长期堆积。
- **保留机制**：用户确认保留的预览图移入 `dev-tools/_qa_keep/`（保留区，**永不参与清理**）；
  未确认保留的一律按清理策略删除。
- **自动清理**：`node dev-tools/cleanup-previews.mjs`（默认 dry-run，`--apply` 执行，
  `--days N` 调保留期）；每周日 03:00 自动化执行（默认保留 7 天）。
- 保留例外（仅此三类）：① 设计文档（docs/）引用的图；② 明确标注为回归基线的对照素材；
  ③ 用户明确要求保留的效果图。
- 预览截图默认输出到 `dev-tools/_qa_tmp/`（已 gitignore）；
  **不得把预览产物提交进 git**（含 `_cdp-*.png`，见 §10）。

### 13.13 代码行数统计与冗余清理（硬性）

- **每个功能迭代完成后必须统计代码行数**：`node dev-tools/count-lines.mjs`
  （总行数 + 按模块/功能分布），提交说明中记录与基线（2026-08-07：32099 行 / 58 文件）的增减。
- **按功能对应代码行数评估**：新增功能应有合理行数增量；出现异常增长
  （单功能 >500 行、同逻辑多处重复实现、巨型文件 >1500 行）必须排查冗余。
- **冗余清理流程**（以下前置条件**全部满足**才可删除）：
  ① grep 确认无任何引用（死代码 / 调试残留）；② 按 §9 矩阵全量验证
  （smoke / full-run / 寻路 / 车辆 / 双端 CDP，按涉及面）；③ 游戏正常运行、
  **所有功能不受影响**才可提交。
- 禁止为「行数好看」做无意义压缩（牺牲可读性/可维护性）；优化目标 = 功能完整 + 无冗余。
- 统计口径：源码 = `source-code/**/*.js`；dev-tools 工具/测试与 docs 文档不计入游戏代码。

### 13.14 开发者模式可测性（硬性）

- **所有新开发的功能必须提供开发者模式测试入口**（`wdev.js` 局内 F9 面板 +
  `saveData.devMode`）：属性/物品/召唤/状态/时间/倍率等至少一类可测手段，
  保证功能**无需走完整自然流程即可被直接验证**（如直接召唤、直接设状态、直接触发结算）。
- **开发者模式对任何玩家开放**：单机 / 联机 host / 联机 guest 均可开启，无账号或权限门槛；
  联机下属性类走 `devflags` 上报（host 权威 → wsync 回传双端共用），召唤/结算类走
  `devcmd`（host 权威执行 → 双端可见）——遵循 §6 host 权威模型，**不得因「是 guest」而禁用 dev**。
- 新功能完成后，dev 面板必须能测到该功能（或在 wdev.js 注释/文档中说明用哪个现有入口测），
  并纳入 §9 验证矩阵。
- dev 入口**默认关闭，仅主动开启时生效**；不得影响正常玩家体验与数值平衡（§13.1 / §13.7）。
