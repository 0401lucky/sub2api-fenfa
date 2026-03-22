# welfare-frontend

`welfare-frontend` 是福利站前端，基于 React + Vite。

## 环境变量

`.env.example`：

- `VITE_WELFARE_API_BASE`：福利后端地址，如 `http://localhost:8787`

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
- `/auth/callback`：OAuth 回调页，只负责处理错误提示与会话校验
- `/checkin`：签到页，展示今日状态与签到历史
- `/admin`：管理员页，展示配置、统计、白名单；前端会先做管理员守卫

## 鉴权策略

- 默认仍使用后端设置的 `HttpOnly Cookie` 维持登录态
- 当前端与后端跨站部署时，会在 OAuth 回调后通过一次性交接码换取 session token，并保存到浏览器本地存储，后续请求改走 `Authorization: Bearer`
- 前端通过 `GET /api/auth/me` 刷新当前会话状态
- 所有 API 请求统一携带 `credentials: include`
- 遇到 `401` 时会自动回到登录页
- 未登录访问受保护页时，登录成功后会回到原始目标页，而不是固定跳回 `/checkin`
- `/admin` 路由在前端会先校验 `is_admin`，避免非管理员先打后台接口再显示无权限
- 如果会话刷新遇到 `500`、网络异常或 CORS 问题，前端会显示明确错误态，而不是误判成“未登录”

## 当前页面行为

- 签到页会读取后端返回的 `can_checkin`，`pending` 且尚未可接管时会禁用签到按钮
- 如果后端判断某条 `pending` 记录已超时可恢复，签到页会允许用户重新发起处理
- 管理页“每日奖励余额”输入框改为字符串态编辑，避免用户清空输入时被立刻折叠成 `0`

## 测试覆盖

- `src/App.test.tsx`：管理员路由守卫、会话错误态
- `src/pages/LoginPage.test.tsx`：登录后原路返回
- `src/lib/auth.test.tsx`：会话恢复失败时的错误分类
