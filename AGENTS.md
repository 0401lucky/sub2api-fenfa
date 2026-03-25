# Repository Guidelines

## Project Structure & Module Organization

本仓库是一个前后端分离的福利站项目，根目录包含 `welfare-backend/`、`welfare-frontend/`、总览 `README.md` 和页面预览图 `login-page-preview.png`。

- `welfare-backend/src/`：后端源码，按职责拆分为 `routes/`、`services/`、`repositories/`、`middleware/`、`utils/`、`types/`
- `welfare-backend/migrations/`：数据库初始化与迁移脚本
- `welfare-frontend/src/`：前端源码，`pages/` 放页面，`lib/` 放接口与鉴权封装，入口为 `App.tsx` 和 `main.tsx`
- 两个子项目的构建产物都输出到各自的 `dist/`

## Architecture Overview

后端负责 LinuxDo OAuth 登录、签到逻辑、管理员配置和 `sub2api` 管理接口调用；登录成功后后端会把一次性交接码回跳给前端，前端再换成 Bearer session token，并在后续请求中通过 `Authorization` 头维持会话。修改接口、鉴权、CORS 或环境变量时，请同时检查前后端是否需要联动更新。

## Build, Test, and Development Commands

先进入对应子项目，再执行命令。

- `cd welfare-backend; Copy-Item .env.example .env; npm run dev`：启动后端开发服务
- `cd welfare-backend; npm run build; npm start`：构建并运行后端生产包
- `cd welfare-backend; npm test`：运行 Vitest 单元测试
- `cd welfare-frontend; Copy-Item .env.example .env; npm run dev`：启动前端开发环境
- `cd welfare-frontend; npm run build; npm run preview`：构建并预览前端生产包

## Coding Style & Naming Conventions

项目使用 TypeScript，保持 **2 空格缩进**、**单引号**、**显式分层** 和 **小而专注的模块**。

- 后端文件使用 kebab-case，如 `auth-routes.ts`
- React 页面与组件使用 PascalCase，如 `AdminPage.tsx`
- 变量、函数和 hooks 使用 camelCase
- 路由只处理请求编排，外部调用放 `services/`，数据访问放 `repositories/`

当前未见独立的 ESLint 或 Prettier 配置，提交前至少确保 `npm run build` 与相关测试通过。

## Testing Guidelines

后端测试框架为 Vitest，按 `src/**/*.test.ts` 匹配，现有用例与源码同目录放置，如 `src/utils/date.test.ts`。新增测试请保持命名一致、执行稳定，并尽量在 60 秒内完成。前端同样使用 Vitest；改动登录、签到、后台页面时，除补充/更新测试外，也需手动验证关键流程。

## Commit & Pull Request Guidelines

提交历史采用 Conventional Commits 风格，常见前缀有 `feat:`、`fix:`、`feat(ui):`。建议一条提交只聚焦一类改动。

PR 请说明影响范围（前端 / 后端）、配置或数据库变更、验证方式；涉及界面改动时附截图，涉及环境变量时同步更新 `.env.example`。

## Security & Configuration Tips

不要提交 `.env`、真实 API Key、LinuxDo OAuth 密钥或生产地址。新增配置项时，同时更新两个子项目各自的示例环境文件；修改 `migrations/` 前先确认对现有数据和启动流程的影响。
