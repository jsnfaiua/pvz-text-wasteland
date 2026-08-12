# 开发规则 · 强制契约（Repository Guidelines）

> **最高优先级开发规则**，与 `docs/系统架构与设计文档.md`（权威设计基准）共同构成契约；冲突以基线文档为准，未覆盖处按本文件执行。**「必须/禁止/不得」=硬性（违反即缺陷）；「建议」=非硬性。任何改动必须满足 §9 验证矩阵；未验证不得提交。新功能必须满足单机/联机零差异（§5.1）。**

## 0. 优先级
1. 本文件 > `系统架构与设计文档.md` > `统一开发文档-v2.103.md` > 代码注释。2. 硬性冲突时**更严格者生效**；拿不准先问。

## 1. 模块职责
- 页面/入口 `index.html`/`style.css`/`game-init.js`；可复用 JS 放 `source-code/`。`core`/`systems`/`entities`/`ui`/`persistence`/`multiplayer`：引擎/玩法/玩家/UI/持久化/联机。`mod-wasteland/`：荒原模组，唯一允许引用 wstate/survival。
- `saves/`、`users.json` 是**运行时数据**，禁提交、禁写入测试逻辑。**循环依赖区（勿拖入新模块）**：`render↔windoor↔wzombie`、`wnpc↔wgear`、`wvehicle→wdev→wnpc→wvehicle`；新模块靠 `wstate.js STATE_DEPS` 注入规避。

## 2. 运行
启动 `RUN.bat`（:8000+开游戏）；联机 `联机对战.bat`（含 PeerServer :9000+双实例）；备用 `node server.js`/`ps-server.ps1`。

## 3. 代码风格（硬性）
ES modules；4 空格缩进；分号；单引号；尾逗号；camelCase/UPPER_SNAKE；单一职责；**匹配相邻代码，禁止无关重排**。

## 4. 序列化真相源（红线 #2）
- **禁止 `JSON.stringify(sv)`**（含 DOM/canvas/函数引用会损坏）。存档与联机快照**必须**走 `wstate.js` 白名单（`serializeSV`/`applySnapshot`/`createRunDefaults`/`buildRun`）。
- 新持久化/联机字段**必须入白名单**并同步迁移表；`buildRun` 自动迁移旧档。
- `T.FLOOR`/`T.SIDEWALK` 同值 `'·'`，断言**必须对象值比较**。

## 5. 六条不变量（破坏任何一条 = 缺陷）
1. **单机/联机零差异**：除多玩家共游外，规则/数值/特效/音效/UI/掉落/结算/存档与单机一致。2. **序列化真相源 = wstate.js 白名单**（§4）。3. **循环依赖区不扩大**（§1）。4. **联机 host 权威完整保留**（§6）。5. **性能防线不回归**（§7）。6. **验证纪律**：按 §9 跑验证通过才完成。

### 5.1 新功能零差异门槛（默认适用）
任何新功能从设计起必须满足联机=单机，禁止「单机先行、联机后补」。核对：①共用代码路径（禁 guest 特判分支）②新字段入 wstate 白名单+补 smoke 断言 ③伤害/掉落/结算/召唤/交易/建造 host 权威 ④音效/特效/UI 双端可见 ⑤拾取/攻击/上车手感双端一致 ⑥camp/pause 类全局事件双向同步 ⑦全量回归+双端 CDP 实测。

## 6. 联机 host 权威（硬性）
- 入口 `mpWasteland.js startWastelandMP('host'|'guest')`，复用 `window.Net.mp`（PeerJS）；握手 `wstart{seed,difficulty,character}`，host 生成 seed，双端确定性生成（`world.js hash2`）。
- 同步：`updateGuest` 分流；100ms `wsync` 快照（**34 格裁剪** plants/drops/effects/bullets）；`wevt` 事件（`sv.mpOutbox` 50ms）；`wdiff` 双向改地。
- 战斗 host 权威：guest 只画特效+上报 atk，**禁本地扣自己 hp**；僵尸带 id（`sv._zIdSeq`）按 id 合并；掉落 host 生成、guest 拾取上报。NPC 队伍本地管理（wsync 不带 npcs）；dev 属性 `devflags`、召唤 `devcmd`。
- **泰拉瑞亚双档**：世界档归 host（含双方 wdiff），guest 只落角色档；断线重连=guest 重连→`wrejoin`→host 重发 winit+补 wsync。
- 联机教训（违反=不一致，详记忆库/联机系统）：①序列化返回结构须与断言一致 ②host 权威字段 guest 变更须上报 ③camp/pause 在 `onWevt` 开头本地应用防回环 ④NPC 队伍不同步 ⑤guest 禁扣自己 hp ⑥特效/掉落/植物 34 格裁剪 ⑦音效 outbox `sfx` 双端 ⑧暂停须同步 ⑨僵尸走 `spawnZombie`（记 id）⑩改 wstate 后跑 smoke+full-run。

## 7. 性能红线（禁回归）
- **主循环（RAF）禁冻结**：帧内异常须捕获兜底，禁卡死白屏。实体上限：特效≤50、掉落≤150、子弹≤80、僵尸≤45；chunk 缓存 5s 清理。
- 防线（详记忆库/性能优化）：P0-1 存档宏任务队列 `saveNow`+setTimeout 0+`flushSave`；P0-2 流场 `_pathRebuildCd` 0.35s 复用；P0-3 快照 34 格裁剪；P0-4 驾驶 BFS 分帧（6000/3000 预算，确定性）；P0-5 特效键控 Map O(1)；P0-8 targets 近距化（Z_CHASE_RANGE=8+horde）。

## 8. 联机/浏览器实测
双 Chrome 实例（不同 `--user-data-dir`，9222/9223）——同 profile 双 tab 因 IndexedDB 冲突连不上 PeerJS；改 ES module 后清缓存 reload；Windows 批量 Node 单进程 `--expose-gc`，禁 spawn 并行。

## 9. 验证矩阵（改什么→跑什么）
- 新功能：全量回归+双端 CDP 零差异（`_cdp-mp-real.mjs`/`_cdp-mp3.mjs`）+ §5.1。
- wbalance 数值/概率：`smoke-test.js`（权重和=1/DIFF 倍率/配方可达性）。
- wstate/survival 存档：`smoke-test.js`+`full-run-test.mjs`（多 seed 往返）；寻路 `astar-verify.mjs`；车辆 `car-pathfinding-test.js`（237/237）；战斗死亡 `combat-death-matrix.mjs`（898）；任意模块 `module-matrix-test.mjs`（380）；游玩流程 `playtest-matrix.mjs`（408）。
- 渲染/主循环/联机：CDP 双端实测（61fps、零长帧、零异常）。任何改动：`CHECK-MODULES.ps1`+手动验证启动/屏幕/存读档。

## 10. 提交规范
- **未经用户明确允许，AI 不得擅自执行 git 写操作**（`commit`/`push`/`tag`/发布），日常改动一律等用户指令。
- 建议：Conventional Commits；scoped；禁提交 `saves/`、`users.json`、`_qa_tmp/`、`_cdp-*.png`。

## 11. AI 协作纪律
1. **禁批量删除文件**；删单文件一条命令一个文件且先经用户同意（`dev-tools/_*.mjs` 临时脚本除外）。
2. 多会话并行前**共享文件（render/survival/world）先备份**；功能/修 bug 后须在 `docs/` 记录用法。
3. 诊断：先读错误定位根因→一次性修复→重验；**同问题修 3 次未解决须停下说明**。`debugGetSv()` 仅诊断用，禁进生产。
4. 荒原模块 `sv` 单例+RAF 主循环；新功能沿 `enterWasteland(opts)` 入口。
5. **开发前审计**：改代码前读目标函数及调用方，评估影响面（§4/§6/§7/§9）；**无损改动**，改既有行为先经同意并标注「行为变更」；**及时止损**，损伤既有功能立即停、先回滚。
6. **文档待办不自动等于开发任务**：docs 中 ⬜/🟡 待办须用户明确指示才开发。
7. **美术/渲染类改动先临时浏览器预览、确认后定稿**；逻辑/玩法/数值/存档/联机类按 §9 跑测试。
8. **更新知识库（知识库≡记忆库，触发硬性）**：用户说「更新知识库/记忆/知识」时，自动在 `docs/记忆库/` 新建六段式记忆文档（领域概述→核心技术→关键代码改动→涉及模块→验证方式→历史教训，`文件:函数` 必须真实），并在 §14 追加一行；改完跑 `node dev-tools/verify-memory-links.mjs`。只新增/维护 `.md`，禁改源码/saves/users.json；归属既有领域则追加条目不新建。

## 12. 已知边界（勿误判为回归）
- `car-pathfinding-test.js` 1 个原版既存失败：车到最近可停处后 4 车门全被挡→留驾驶态（设计为 WASD 挪车后 F 下车）。
- 废墟深处 >40 格死路是真迷宫死路，替换为可达边界+提示。

## 13. 游戏开发规则
- **13.1 数值唯一收口**：数值/概率/倍率必须定义在 `wbalance.js`（或具名 X_INFO 表）。
- **13.2 随机确定性**：世界生成/双端一致随机走 seed 纯函数（`hash2`/`grassNoise`）；`Math.random` 仅限表现类。
- **13.3 新增地块「四件套」**：T 表登记+通行+渲染+序列化，禁半成品地块。
- **13.4 新系统接入主循环 checklist**：update 顺序/帧预算/暂停离屏/onDeath/序列化白名单/联机一致性。
- **13.5 文案收口**：玩家可见文案走 `wmsg.js pushMsg` 与具名常量。
- **13.6 配方/概率表**：新配方进 `wwordcraft-rules.js RECIPES`；概率表权重和=1，补断言。
- **13.7 难度倍率联动**：影响强度数值对照 `DIFF_TABLE.mul`（hardcore×1.5）。
- **13.8 离屏缓存 key 完整维度**：新增外观/状态维度必须入缓存 key，否则脏读颜色错乱。
- **13.9-13.11 建议**：CDP 脚本 `_cdp-<场景>.mjs` 命名；音频统一入口；纯键盘可操作。
- **13.12 预览资源清理**：`_cdp-*.png`/`_qa_tmp/` 清理；保留区 `_qa_keep/` 不参与。
- **13.13 行数统计与冗余清理**：每迭代跑 `count-lines.mjs`；删除须 grep 无引用+全量验证。
- **13.14 开发者模式可测性**：新功能须有 dev 入口（`wdev.js` F9）；单机/host/guest 均可开；dev 默认关闭。

## 14. 记忆库索引
> `docs/记忆库/` 领域记忆文档（六段式），新增维护按 §11.8。

| # | 领域 | 概述 |
|---|---|---|
| 01 | [世界生成与地形](docs/记忆库/世界生成与地形.md) | seed 确定性、地形、路网/草地、chunk 缓存 |
| 02 | [序列化与存档](docs/记忆库/序列化与存档.md) | wstate 白名单、双档、迁移、宏任务落盘 |
| 03 | [联机系统](docs/记忆库/联机系统.md) | host 权威、wsync/wevt/wdiff、34 格裁剪、重连 |
| 04 | [性能优化](docs/记忆库/性能优化.md) | 流场节流、快照裁剪、BFS 分帧、特效 Map、上限 |
| 05 | [战斗、僵尸与感染](docs/记忆库/战斗、僵尸与感染.md) | 僵尸 AI/流场、刷新/尸群、武器、感染、死亡 v2 |
| 06 | [NPC 生态](docs/记忆库/NPC生态.md) | AI 状态机、队伍/雇佣、成长、营地生育 |
| 07 | [载具驾驶](docs/记忆库/载具驾驶.md) | 汽车 BFS、分帧导航、车体 2×2、停车兜底 |
| 08 | [建造与植物](docs/记忆库/建造与植物.md) | 建造系统、野生植物、生长、驯化 |
| 09 | [探索与字词合成](docs/记忆库/探索与字词合成.md) | 字楔/字源/配方、权重表、搜索、像素具象 |
| 10 | [室内系统](docs/记忆库/室内系统.md) | 楼层、室内交互、躲藏者、室内外统一 |
| 11 | [渲染系统](docs/记忆库/渲染系统.md) | 离屏缓存、角色染色、特效 Map、草/昼夜 |
| 12 | [玩家系统与捏脸](docs/记忆库/玩家系统与捏脸.md) | 动作/冲刺、捏脸、MC_PAL、sprite、镜像 |
| 13 | [数值平衡与难度](docs/记忆库/数值平衡与难度.md) | 数值收口、权重和=1、难度倍率 |
| 14 | [开发者模式](docs/记忆库/开发者模式.md) | wdev F9、devflags/devcmd、可测性 |
