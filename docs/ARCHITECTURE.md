# 文字植物大战僵尸 - 模块化架构

## 目录结构

```
├── source-code/
│   ├── core/                     # 核心引擎层
│   │   ├── constants.js          # 全局常量配置 (FIELD, DIFFICULTY, PLANTS, ZOMBIES...)
│   │   ├── state.js              # 状态管理 (全局状态, 玩家状态)
│   │   ├── render.js             # Canvas渲染系统
│   │   └── utils.js              # 工具函数集合
│   │
│   ├── entities/                 # 实体层
│   │   └── player.js             # 玩家实体逻辑 (移动/闪避/格挡/武器)
│   │
│   ├── systems/                  # 系统层
│   │   ├── combat.js             # 战斗系统 (武器/植物攻击/伤害判定)
│   │   ├── spawner.js            # 生成系统 (僵尸/阳光/拾取物掉落)
│   │   ├── audio.js              # 音频系统 (WebAudio, BGM/音效)
│   │   ├── almanac.js            # 图鉴解锁状态
│   │   └── missions.js           # 任务系统 (进度/领奖)
│   │
│   ├── ui/                       # UI层
│   │   ├── screens.js            # 屏幕切换 + BGM 联动
│   │   ├── hud.js                # HUD / 卡槽渲染
│   │   ├── levelSelect.js        # 关卡选择
│   │   ├── cardSelect.js         # 选卡界面
│   │   ├── almanacUI.js          # 图鉴界面 (植物/僵尸/武器/护甲)
│   │   ├── missionPanel.js       # 任务面板
│   │   ├── shop.js               # 潘妮的小店
│   │   ├── settings.js           # 设置 / 开发者面板
│   │   └── training.js           # 训练营
│   │
│   ├── persistence/              # 持久化层
│   │   └── storage.js            # LocalStorage存储 (账户/存档/升级/货币)
│   │
│   └── multiplayer/              # 多人联机层
│       ├── mpGame.js             # 联机对局 (主机权威模拟 + 快照同步)
│       └── multiplayerUI.js      # 联机弹窗 (创建/加入房间)
│
├── index.html                    # 页面入口
├── style.css                     # 样式表
├── game-init.js                  # 游戏主入口 (循环/关卡/种植/输入绑定)
├── net.js                        # 账户&联机 (PeerJS 房间层)
└── backup/                       # 旧版代码存档 (game.js.old / main.js)
```

## 模块职责说明

### 🎯 Core Layer - 核心层

**`constants.js`**
- 所有静态常量定义：战场尺寸、植物/僵尸数据、武器配置、难度预设、关卡定义、升级表
- 无副作用，纯数据定义
- 可热插拔替换，便于 mod 开发

**`state.js`**
- 全局状态集中管理
- 玩家状态工厂函数
- 游戏运行时状态（暂停/结束等）
- UI 引用缓存
- 状态重置函数

**`render.js`**
- Canvas 渲染系统入口
- 所有绘制函数：战场/植物/僵尸/玩家/特效/UI覆盖层
- 无副作用，只做纯渲染（依赖 state，不修改它）

**`utils.js`**
- 无状态工具函数
- 坐标转换、随机、数学计算
- 通用判定函数

---

### 🎭 Entities Layer - 实体层

**`player.js`**
- 玩家行为封装
- 移动 / 跳跃 / 奔跑
- 闪避 / 格挡（含完美格挡判定）
- 植物种植 / 铲除
- 受击判定

---

### ⚙️ Systems Layer - 系统层

**`combat.js`**
- 武器攻击逻辑
- 植物攻击逻辑
- 子弹更新 & 命中判定
- 僵尸 AI & 吃植物
- 死亡处理

**`spawner.js`**
- 僵尸波次生成
- 自然阳光掉落
- 拾取物生成 & 收集
- 掉落奖励计算（碎片/货币）

---

### 💾 Persistence Layer - 持久化层

**`storage.js`**
- LocalStorage 读写封装
- 账户系统（登录/注册）
- 关卡进度存档
- 植物碎片 & 升级
- 武器碎片 & 解锁/升级
- 货币系统

---

### 🎮 UI Layer - 界面层
```
ui/screens.js       # 屏幕切换 + BGM 联动
ui/hud.js           # HUD更新 / 卡槽渲染
ui/levelSelect.js   # 关卡选择
ui/cardSelect.js    # 选卡界面
ui/almanacUI.js     # 图鉴界面 (植物/僵尸/武器/护甲)
ui/missionPanel.js  # 任务面板
ui/shop.js          # 商店
ui/settings.js      # 设置 / 开发者面板
ui/training.js      # 训练营
```

---

### 🌐 Multiplayer Layer - 联机层
```
net.js                    # PeerJS 房间层 (Net.mp: 创建/加入/消息)
multiplayer/mpGame.js     # 联机对局 (主机权威模拟 + 快照同步 + 渲染)
multiplayer/multiplayerUI.js  # 联机弹窗
```

---

## 设计原则

1. **单一职责原则**：每个模块只做一件事
2. **依赖方向明确**：上层依赖下层，下层不了解上层
3. **可测试性**：纯函数优先，易于单元测试
4. **可扩展性**：新植物/新僵尸/新武器只需要加常量配置 + 系统逻辑
5. **模块间解耦**：通过导出接口通信，不直接操作内部状态

---

## 数据流

```
用户输入 → 主循环更新 → 各系统处理 → 状态变更
                                          ↓
                                    渲染系统绘制
                                          ↓
                                      UI/HUD 更新
                                          ↓
                                    持久化保存
```

---

## 后续工作

1. **主入口瘦身**：将种植/波次逻辑从 game-init.js 剥离到 systems/planting.js、systems/waves.js
2. **添加事件总线**：各模块间通过事件通信，减少直接依赖
3. **添加实体组件系统**：植物/僵尸用 ECS 模式重构
4. **配置驱动**：所有内容通过 JSON 配置加载
5. **单元测试**：为各系统添加测试
