# 双客户端冒烟清单（collab 断连恢复——批 0a-4 文件化，批 7 E2E 脚本化底稿）

> 用途：CI/E2E 缺位期的手动发布门禁底稿。三个最值钱场景（杀 API 自动恢复 / 断连期双端编辑合并 / AI 执行态对齐）在批 7 脚本化前按本清单手动跑。

## 环境准备

1. 基础设施：PG(5432)/Redis(6379)/MinIO(9000) 在跑（`netstat -an | grep -E ":(5432|6379)"` + `curl http://127.0.0.1:9000/minio/health/live`）
2. 起 API：`preview_start "api"`（Nest --watch，端口 3000/WS 3001，首编译 10-15s）
3. 起 Web：`preview_start "web"`（Vite，5173）
4. 测试账号：333@333.com / DevTest123456（邮箱登录：登录页「邮箱登录」tab）
5. 双客户端：两个浏览器 profile（或一个普通窗口+一个隐身窗口）分别登录后打开同一 `http://localhost:5173/canvas?projectId=<id>`

## 场景 1：杀 API → 自动恢复（已验证 2026-09-30，见下）

1. 画布页连接指示器显示「已连接」（connStatus=connected，可经 store 采样：`useCanvasStore.getState().connStatus`）
2. 杀 API：`netstat -ano | grep ":3001" | grep LISTEN` 取 PID → `taskkill //F //T //PID <pid>`
3. 观察：指示器经 offline/connecting 反映断连（不允许卡死在旧状态）
4. 重启 API（preview_stop + preview_start "api"）
5. **判据：≤ 自动重连周期内（实测 ~5s）指示器回到「已连接」，全程零手动刷新**

### 2026-09-30 实测记录（单客户端，批 0a 收尾）

- 登录 → /canvas → connStatus=connected、projectId 写入 store（openSession 漏斗生效）
- 首屏请求序列零 429（批 0c-8 ThrottlerGuard 300/min 验证）
- 杀 API：connStatus 采样 offline（派生正确）
- 重启 API：offline → connecting(4s) → **connected(5s)** 零刷新恢复——R1「卡 connecting >2min 需手动刷新」症状根修验证通过

## 场景 2：断连期编辑 → 重连合并（双端）

1. A/B 两端开同一项目，均「已连接」
2. 杀 API；断连期 A 端加节点/拖动（允许编辑——失联非阻断）
3. 重启 API；A 端恢复「已连接」后刷新 B 端
4. **判据：B 端可见 A 断连期编辑（批 1 前靠 library 重连+SS2 合并；若失败登记批 1 验证，不阻塞）**
5. 双端并发编辑收敛（A 拖 X、B 拖 Y → 两端最终一致）

## 场景 3：AI 执行态对齐（批 0.5/批 1 后启用）

1. A 端发起生成（loading）；杀 API；重启
2. **判据：重连后节点状态从 doc/表对齐，不永转圈、不误报失败**

## 场景 4：会话过期 → 重登重连（批 3 后启用）

1. 等session 过期（或 DB 手改 expiresAt）
2. **判据：编辑被引导重登；重登后回原画布重连（批 2 redirect 收口后验证返回链路）**

## 已知登记

- preview 工具单视口——完整双端验证需两 profile 手动开（批 7 脚本化为 playwright 双 context）
- 断连期编辑合并（场景 2）在批 1 watchdog/recoverConnection 落地前依赖 provider ladder 自动重连
