# sub2api 福利站（独立部署版）

本仓库实现了一个**不改动 `sub2api` 源码**的福利站方案，包含：

- `welfare-backend`：签到业务、LinuxDo 登录、管理员配置、兑换码与补发
- `welfare-frontend`：签到页与管理后台页

## 当前版本补充

- 后端已加入**超时 `pending` 签到/兑换恢复机制**，异常中断后不再只能手工改库
- 签到失败重试会保留**原始奖励额度**，避免奖励随配置漂移
- 管理后台统计按**业务时区**计算，不再受数据库时区影响
- 前端已补上**管理员路由守卫**、**登录后原路返回**和**会话错误态**
- 当前鉴权方案已统一为 **Bearer session token**，不再依赖 Cookie
- Bearer token 现已支持**服务端撤销**，并会定期清理过期撤销记录
- OAuth `state` 与 `session handoff` 现已支持**单次消费**，降低重放风险
- 登录回跳与 API 入口已支持**子路径部署**
- 前后端都已补充自动化测试入口，并新增 CI 工作流

## 架构说明

核心设计是“零侵入 sub2api”：

1. 用户在福利站通过 LinuxDo OAuth 登录；
2. 福利后台将 LinuxDo `subject` 映射为合成邮箱：`linuxdo-{subject}@linuxdo-connect.invalid`；
3. 后台调用 `sub2api` 管理接口确认该邮箱用户存在；
4. 登录成功前，后端会先校验并消费一次性 OAuth `state`；
5. 登录成功后，后端向前端回跳并附带一次性交接码；
6. 前端将交接码换成 Bearer session token，并在后续请求中携带 `Authorization: Bearer <token>`；
7. 签到或兑换时，后台调用 `sub2api` 管理接口发放额度；
8. 签到配置、兑换码和管理员白名单都由福利后台独立维护。

## 目录结构

```text
.
├── welfare-backend
│   ├── migrations
│   └── src
├── welfare-frontend
│   └── src
└── .github/workflows
```

## 快速开始

### 1) 启动后端

```bash
cd welfare-backend
cp .env.example .env
npm install
npm run dev
```

> 后端启动时会自动执行数据库迁移，并按需写入管理员白名单种子。

### 2) 启动前端

```bash
cd welfare-frontend
cp .env.example .env
npm install
npm run dev
```

## 测试与构建

后端：

```bash
cd welfare-backend
npm test
npm run build
```

前端：

```bash
cd welfare-frontend
npm test
npm run build
```

## 对接要点

- `SUB2API_BASE_URL`：你的 sub2api 服务地址
- `SUB2API_ADMIN_API_KEY`：sub2api 后台管理员 API Key
- `LINUXDO_*`：LinuxDo OAuth 应用参数，回调需指向  
  `http(s)://<welfare-backend>/api/auth/linuxdo/callback`
- `WELFARE_FRONTEND_URL` / `VITE_WELFARE_API_BASE`：如果前后端挂在子路径下，填写完整 base path

## 更多说明

- 后端详细配置与接口：`welfare-backend/README.md`
- 前端运行与页面说明：`welfare-frontend/README.md`
