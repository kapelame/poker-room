# Poker Room

一个支持多人房间和 GTO 练习的德州扑克应用，技术栈为 React、Vite、Hono、tRPC、WebSocket 和 MySQL。

## 一键运行

需要先安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)，然后：

- macOS：双击 `start.command`
- Linux / macOS 终端：运行 `./start.sh`
- Windows：双击 `start.bat`

启动完成后打开 <http://localhost:3000>。

首次运行会自动构建应用镜像、启动 MySQL，并保存数据库数据到 Docker volume。停止服务：

```bash
docker compose down
```

删除本地数据库数据：

```bash
docker compose down -v
```

## 本地开发

```bash
npm ci
npm run dev
```

开发服务器默认运行在 <http://localhost:3000>。本地开发模式不要求配置生产环境变量。

常用检查：

```bash
npm run check
npm test
npm run build
```

## 配置

复制 `.env.example` 为 `.env` 后按需修改。默认 Docker Compose 配置使用本地 MySQL；共享部署或公网部署时，请务必替换 `APP_SECRET` 和数据库密码，并通过部署平台的密钥管理功能注入，不要把 `.env` 提交到 Git。

## 项目结构

- `src/`：React 页面和组件
- `api/`：Hono、tRPC 和 WebSocket 服务端
- `contracts/`：前后端共享类型
- `db/`：Drizzle schema 和迁移目录
- `docker-compose.yml`：应用 + MySQL 的一键运行配置

## License

暂未指定许可证。
