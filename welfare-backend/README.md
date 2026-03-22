# welfare-backend

`welfare-backend` 是福利站后端服务，负责：

- LinuxDo OAuth 登录与会话签发
- sub2api 用户识别与签到额度发放
- 签到配置管理、签到记录统计、管理员白名单管理

## 环境变量

基于 `.env.example` 配置，关键变量如下：

- 服务与安全
  - `PORT`：后端端口
  - `WELFARE_FRONTEND_URL`：前端地址，用于 OAuth 回跳
  - `WELFARE_CORS_ORIGINS`：允许跨域来源，多个值用逗号分隔；留空时默认仅允许 `WELFARE_FRONTEND_URL` 对应的 origin
  - `WELFARE_JWT_SECRET`：会话签名密钥，至少 16 位
  - `WELFARE_JWT_EXPIRES_IN`：JWT 过期时间，如 `30m`、`12h`、`7d`；同时会同步作为会话 Cookie 生命周期
  - `WELFARE_COOKIE_SECURE`：生产环境建议设为 `true`；布尔值仅接受 `true/false/1/0/yes/no/on/off`
  - `WELFARE_SESSION_COOKIE_SAME_SITE`：会话 Cookie 的 SameSite 策略；前后端分域部署时建议设为 `none`

- 数据库
  - `DATABASE_URL`：PostgreSQL 连接串

- LinuxDo OAuth
  - `LINUXDO_CLIENT_ID`
  - `LINUXDO_CLIENT_SECRET`
  - `LINUXDO_AUTHORIZE_URL`
  - `LINUXDO_TOKEN_URL`
  - `LINUXDO_USERINFO_URL`
  - `LINUXDO_REDIRECT_URI`
  - `LINUXDO_SCOPE`

- sub2api 集成
  - `SUB2API_BASE_URL`：sub2api 服务地址
  - `SUB2API_ADMIN_API_KEY`：sub2api 管理接口密钥
  - `SUB2API_TIMEOUT_MS`：请求超时毫秒数

- 福利默认配置
  - `DEFAULT_CHECKIN_ENABLED`
  - `DEFAULT_DAILY_REWARD`
  - `DEFAULT_TIMEZONE`，默认 `Asia/Shanghai`
  - `BOOTSTRAP_ADMIN_SUBJECTS`：启动时自动写入管理员白名单，逗号分隔

## 运行方式

```bash
npm install
cp .env.example .env
npm run dev
```

生产构建：

```bash
npm run build
npm start
```

测试：

```bash
npm test
```

## 当前行为说明

- 会话 Cookie 生命周期与 `WELFARE_JWT_EXPIRES_IN` 保持一致，避免浏览器 Cookie 与 JWT 过期时间脱节
- 布尔环境变量会严格校验，拼错值会在启动时报错，而不是静默当成 `false`
- 签到记录新增 `updated_at`，用于识别超时 `pending` 记录
- 用户重试签到时，若遇到超时的 `pending` 记录，系统会自动接管并继续发放流程
- 失败签到重试会保留原始 `reward_balance`，不会因为后台后来改了奖励配置而漂移
- 管理后台“最近 N 天”统计按业务时区推导起始日期，不依赖数据库 `CURRENT_DATE`

## 数据库行为

- 启动时自动执行 `migrations/*.sql`
- 首次自动写入 `welfare_settings` 默认配置
- 签到流水写入 `welfare_checkins`
- 通过 `(sub2api_user_id, checkin_date)` 保证每日唯一签到
- `welfare_checkins.updated_at` 用于恢复超时未完成的签到状态

## 核心接口

### 鉴权

- `GET /api/auth/linuxdo/start`：跳转 LinuxDo 登录
- `GET /api/auth/linuxdo/callback`：处理 OAuth 回调，写入 `HttpOnly Cookie` 会话
- `POST /api/auth/session-handoff/exchange`：把前端回调页拿到的一次性交接码换成 session token
- `GET /api/auth/me`：返回当前会话信息，包含 `is_admin`
- `POST /api/auth/logout`：退出登录

### 签到

- `GET /api/checkin/status`：今日签到状态，返回 `can_checkin` 供前端判断是否可再次发起
- `GET /api/checkin/history`：签到历史
- `POST /api/checkin`：执行签到并发放额度

### 管理后台

- `GET /api/admin/settings`：读取签到配置
- `PUT /api/admin/settings`：更新签到配置
- `GET /api/admin/stats/daily`：按天统计
- `GET /api/admin/checkins`：分页查询签到明细
- `POST /api/admin/checkins/:id/retry`：重试失败签到，或接管已超时的 `pending` 签到
- `GET /api/admin/whitelist`：管理员白名单列表
- `POST /api/admin/whitelist`：新增或更新白名单
- `DELETE /api/admin/whitelist/:id`：删除白名单

## 与 sub2api 的对接细节

- 用户识别规则：`linuxdo-{subject}@linuxdo-connect.invalid`
- 查询用户：`GET /api/v1/admin/users?search=<synthetic_email>`
- 发放额度：`POST /api/v1/admin/users/:id/balance`
- 幂等键：`Idempotency-Key: welfare-checkin:{userId}:{checkinDate}`
