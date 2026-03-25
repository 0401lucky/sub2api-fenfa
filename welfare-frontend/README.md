# welfare-frontend

`welfare-frontend` 是福利站前端，基于 React + Vite。

当前构建插件已切换到 `@vitejs/plugin-react-swc`，用于减少测试阶段的 Vite 弃用警告并保持构建链路更干净。

## 环境变量

`.env.example`：

- `VITE_WELFARE_API_BASE`：福利后端地址，如 `http://localhost:8787`
  - 支持绝对地址：`https://example.com/welfare-backend`
  - 也支持相对路径：`/welfare-backend`

## 运行方式

```bash
npm install
cp .env.example .env
npm run dev
```

测试：

```bash
npm test
```

生产构建：

```bash
npm run build
npm run preview
```

## 页面与路由

- `/login`：登录入口，跳转后端 `GET /api/auth/linuxdo/start`
- `/auth/callback`：OAuth 回调页，负责把一次性交接码换成 Bearer 会话，并处理错误提示
- `/checkin`：签到页，展示今日状态、兑换区和历史记录
- `/admin`：管理员页，展示配置、统计、白名单、兑换码与兑换记录；前端会先做管理员守卫

## 鉴权策略

- 当前前端统一使用后端签发的 Bearer token 维持登录态
- OAuth 回调成功后，前端会调用 `POST /api/auth/session-handoff/exchange` 换取 session token
- 一次性交接码只能消费一次；如果用户重复打开旧回调页，会被要求重新登录
- session token 保存到浏览器本地存储，后续请求自动携带 `Authorization: Bearer <token>`
- 前端通过 `GET /api/auth/me` 刷新当前会话状态
- 主动退出时会先调用后端注销当前 token，再清理本地 token
- 遇到 `401` 时会自动清理本地 token 并回到登录页
- 未登录访问受保护页时，登录成功后会回到原始目标页，而不是固定跳回 `/checkin`
- `/admin` 路由在前端会先校验 `is_admin`，避免非管理员先打后台接口再显示无权限
- 如果会话刷新遇到 `500`、网络异常或 CORS 问题，前端会显示明确错误态，而不是误判成“未登录”
- `VITE_WELFARE_API_BASE` 带子路径时，登录入口 URL 也会保留该 base path

## 当前页面行为

- 签到页会读取后端返回的 `can_checkin`，`pending` 且尚未可接管时会禁用签到按钮
- 如果后端判断某条 `pending` 记录已超时可恢复，签到页会允许用户重新发起处理
- 管理页“每日奖励余额”输入框改为字符串态编辑，避免用户清空输入时被立刻折叠成 `0`
- 签到页补齐了专用布局样式，头部、主按钮、历史区块会按响应式布局展示

## 测试覆盖

- `src/App.test.tsx`：管理员路由守卫、会话错误态
- `src/lib/api.test.ts`：Bearer 头注入、登录入口 URL 保留 base path
- `src/lib/auth.test.tsx`：会话恢复失败时的错误分类
- `src/pages/LoginPage.test.tsx`：登录后原路返回
- `src/pages/AuthCallbackPage.test.tsx`：一次性交接码换 token
- `src/pages/CheckinPage.test.tsx`：签到页主流程数据加载
- `src/pages/AdminPage.test.tsx`：后台总览与分区切换
