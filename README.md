# Poker Room

一个可直接在浏览器中玩的多人德州扑克房间，同时提供 GTO 练习模式。

## 功能

- 最多 9 人入座，创建房间后可立即选择座位
- 新玩家可自选买入金额，由房主审批
- 支持单手买入、补到当前平均筹码、补到当前筹码领先者
- 买入申请、审批、到账和每手结果都会记录在日志与总结中
- 点击其他玩家头像，可向指定玩家投掷带飞行动画的表情
- 房主可随时调整盲注、买入额、行动时间和时间银行
- 牌局中的设置变更从下一手生效
- 摊牌结算后自动倒计时开始下一手
- 支持暂停、返回大厅、聊天、胜率显示和 GTO 练习

## 技术结构

- React 19 + Next.js 16
- Vinext + Vite
- Cloudflare Worker 兼容运行时
- D1 持久化房间、玩家会话和事件
- 同源 HTTP 轮询协议，不依赖固定服务器域名
- Drizzle 管理数据库结构

主要目录：

- `app/`：页面入口和全局样式
- `src/pages/`：大厅、房间和练习模式
- `api/game/room.ts`：牌局状态机、买入与结算
- `worker/`：HTTP 和 Worker 入口
- `contracts/`：前后端共享协议与牌型计算
- `drizzle/`：D1 数据库迁移

## 一键运行

需要 Docker Desktop。macOS 双击 `start.command`，Windows 双击 `start.bat`，也可以在终端运行：

```bash
docker compose up --build
```

启动后访问 `http://localhost:3000`。牌局数据保存在 Docker volume 中，停止容器不会丢失。

## 本地开发

需要 Node.js `>=22.13.0`。

```bash
npm ci
npm run db:migrate:local
npm run dev
```

前端始终通过同源 `/api/poker` 请求牌局接口，不需要配置外部 API 地址。

## 验证

```bash
npm run lint
npm run check
npm test
```

## Cloudflare 部署

先创建名为 `poker-room` 的 D1 数据库，将返回的数据库 ID 写入 `wrangler.jsonc`，然后执行：

```bash
npm run db:migrate:remote
npm run deploy
```
