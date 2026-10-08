# guysfall

**guysfall** 是一个回合制开放世界 Agent 游戏 Demo：八名船员在最后七日航程中维持一艘殖民船，其中一人是隐藏拟态宿主。玩家扮演监察官，把人物、物资牌、权限牌和 Energy 投入桌面上的压力位、事件、谈话或放逐，然后查看世界如何结算。

玩家安排工作、选择事件处理办法、投入已有手牌。普通船员按规则执行，宿主提交隐藏行动，World Agent 根据公开结果和之前的选择提出后续处境，服务端结算成本与后果。

当前实施契约见 [docs/guysfall_当前设计.md](docs/guysfall_当前设计.md)。原始世界观和扩展设想保留在 [WorldWeaver_最终方案v1.0_七日寄生.md](WorldWeaver_最终方案v1.0_七日寄生.md)，其中与实施契约冲突的逐步模拟、地图移动和复杂高阶系统属于历史设计，不是当前 Demo 的验收范围。

## 作品集

[查看 lux 的作品集 PDF](output/pdf/lux%2B%E4%BD%9C%E5%93%81%E9%9B%86.pdf)。作品集用实际运行截图和系统图解释如何把 Agent 决策接入游戏：行动协议、规则裁定、信息隔离、回合反馈与失败恢复。科幻航程用于承载这些机制。

![作品集预览](output/pdf/preview.png)

## 运行

需要 Node.js >= 22.13。首次运行安装 Phaser 与构建依赖：

```sh
npm install
npm start
```

打开 <http://127.0.0.1:4317/>。主界面采用 Phaser + TypeScript，首次打开会恢复当前航程；没有存档时，已配置模型默认进入真实模式，否则进入固定策略演练。左侧「航程菜单」可切换固定策略演练和真实 Agent 两种模式。固定策略不消耗模型额度，适合验证牌、资源、轮换、事件和终局；真实模式读取 `.env` 中的模型配置。

```sh
npm run art:check            # 图集、角色裁切和机制图标覆盖盘点
npm run sim                  # 40 种固定策略组合，每种 300 局
npm run trial -- --full       # 本地固定策略跑完七日
npm run trial -- --live       # 真实模型跑一日，按整轮工具调用
```

真实模式需要：

```text
GUYSFALL_BASE_URL=https://...
GUYSFALL_MODEL=gpt-6.1-sol
GUYSFALL_WIRE_API=responses
GUYSFALL_API_KEY=...
```

密钥只在服务端使用，不写入网页。普通人类船员不请求模型；新航程先由 World 生成开场，通常每日宿主和 World 各 1 次逻辑决策，真相终局可提前结束。参数错误最多修正 1 次；429/5xx、网络错误和超时最多尝试 3 次，成功决策在整轮失败后重用，并随私有存档保存。人类规则决定不计入 API 日志；宿主和世界请求失败不会由脚本兜底。全组决定齐备后才公布船员回报进度，避免完成速度泄露身份。

## 玩法与验证

当前规则、事件来源、旧存档转换、自动检查和浏览器实测范围统一维护在 [当前实施设计](docs/guysfall_当前设计.md)。世界 Agent 可生成有资源代价的办法，或让玩家先调查、保留原事件、打开新办法；选择和发现会进入后续生成上下文。隐藏干扰与设备损伤形成公开压力，后续事件由世界 Agent 提出。World 为新事件提交期限与逾期代价，零代价表示可放过的机会；事件奖励可发调遣令供之后增加派遣人手。新航程资源从 75 开始；监工花 2 精力保护一处系统，派遣决定宿主的接触范围，调查核对往日真实操作痕迹，谈话可确认普通领用。事件结束后关闭，不能用同一条旧后果无限续单。普通船员按规则执行；没有人物疲劳、士气或独立加工系统。

```sh
npm test
npm run typecheck
npm run sim:builds -- --runs=30 --verify-replay
```

固定策略验证使用临时副本，不覆盖当前航程；真实模型实验只在明确授权后运行。固定策略和模拟模型响应不代表真实模型叙事质量，也不能证明玩法平衡已完成。

每局开发记录保存在本地 `runs/`；网页下载只返回玩家投影。记录包含服务端回放所需的私有状态，但不会通过网页接口暴露。表现层使用 Phaser 3.90 + TypeScript，经 esbuild 输出到 `public/game.js`；服务仍采用 Node HTTP、SSE 和 JSON 存档。没有迁移世界规则或引入地图模拟。`npm start` 会先构建；`npm run typecheck` 检查前端类型。

## 入口文件

- `src/world.mjs`：规则、工具 schema、状态、可见性、台账、回放。
- `src/builds.mjs`：处理办法 schema、预算、历史契约及离线内容 fixture。
- `src/build-sim.mjs`：省人手/省物资/先调查三种固定策略矩阵，逐局重放核验。
- `src/sim.mjs`：固定策略矩阵、推理/放逐、锁定日、误杀率与资源最低点；可离线重放已有录制。
- `src/agents.mjs`：整轮 Agent 调度、Responses/Chat Completions 适配和固定策略。
- `src/event-generation.mjs`：真实模型的本轮事件任务、动态工具约束、重复提案纠错；与旧命令回放分离。
- `src/server.mjs`：本地 HTTP、SSE、会话、原子存档和整日失败回滚和成功决策缓存。
- `client/main.ts`：Phaser 桌面、卡牌拖放、报告和航程记录。
- `client/model.ts`：玩家投影、派遣草稿、HTTP/SSE 和刷新恢复。
- `client/audio.ts`：可关闭的合成反馈音。
- `public/assets/`：用户参考图及生成的无文字指挥台底图。
- `skills/guysfall-game-ui/SKILL.md`：项目 UI 约束。
- `docs/art/资产说明.md`：素材来源、临时角色映射和替换规格。
- `test/`：规则和模型协议测试。
