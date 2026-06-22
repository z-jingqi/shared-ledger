# 一起记 / shared-ledger

移动端优先的多人共享记账 Web MVP。家庭、情侣、室友和旅行小组可在同一本账本记录收支、邀请成员、导入文件并分析支出。

## 技术栈

- Web：React、TypeScript、Vite、Tailwind CSS v4、React Router、React Hook Form、Zod、Recharts。
- API：Hono on Cloudflare Workers、D1、R2、Queues、Workers AI、Drizzle；可选 PaddleOCR Container。
- 工程：pnpm monorepo、Vitest、Testing Library、Playwright、MSW。

## 目录

```text
apps/web       React 移动端界面
apps/api       Hono Worker API 与队列消费者
packages/shared 权限、类型、Zod schema
packages/db     Drizzle schema 与 D1 migrations
packages/ai     可替换 AI Provider adapter
packages/import 文件解析、OCR 与导入编排
packages/ui     复用 UI 原子组件
```

## 本地启动

```bash
corepack enable
pnpm install
pnpm dev
```

网页默认位于 `http://localhost:5173`，Worker 位于 `http://localhost:8787`。复制 `.env.example` 为 `.env` 后可设置 `VITE_API_URL`。

先初始化本地 D1：

```bash
pnpm db:migrate:local
```

`pnpm --filter @shared-ledger/api dev` 使用完全离线的 D1、R2、Queue 模拟，认证、账本与 CSV/Excel 导入均可本地验证。Workers AI 不能本地模拟，登录 Cloudflare 后可使用远程 AI 绑定；图片和 PDF 的 OCR 需要 Docker 与 Container：

```bash
pnpm --filter @shared-ledger/api dev:ai
pnpm --filter @shared-ledger/api dev:containers
```

```bash
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test:coverage
pnpm lint
pnpm typecheck
pnpm build
```

## Cloudflare 资源

每个环境各自拥有 D1、R2 和 Queue：`shared-ledger-{dev|prod}`。先创建资源并把 ID 写入环境变量，再生成配置：

```bash
wrangler d1 create shared-ledger-dev
wrangler r2 bucket create shared-ledger-files-dev
wrangler queues create shared-ledger-imports-dev
$env:CLOUDFLARE_D1_DATABASE_ID_DEV = "<D1 id>"
node scripts/prepare-wrangler-config.mjs api dev
pnpm --filter @shared-ledger/api exec wrangler d1 migrations apply shared-ledger-dev --local --config wrangler.generated-api-dev.json
```

生产环境使用同样命令并替换为 `prod`；迁移位于 `packages/db/migrations`。Web 与 API 分开部署：Web 使用 Worker static assets，API 使用 Hono Worker。自定义域名已作为模板配置：生产为 `leger.aleph-cat.com` 与 `api.leger.aleph-cat.com`，开发为 `dev.leger.aleph-cat.com` 与 `api.dev.leger.aleph-cat.com`。Cloudflare zone 必须已托管 `aleph-cat.com`，首次部署需具备编辑 DNS/Workers routes 的 API token 权限。

## 身份与订阅

密码账号注册时只要求昵称和至少 10 位密码，邮箱、手机号均可选。密码账号在开通 Pro 前必须补充至少一个可恢复身份的信息（邮箱或手机号）；Google、微信 OAuth 身份已经是可恢复身份，不需要补充。会话、OAuth state 和密码重置 token 都保存在 D1，并只在浏览器中以 `HttpOnly` session cookie 传递。

## 文件导入、OCR 与 AI

原文件先进入 R2，再通过 Queue 处理；CSV 和 Excel 在 Worker 中解析，图片或 PDF 由 PaddleOCR Container 识别，最后交给 Workers AI。AI 输出会经过 Zod 校验，只生成待确认记录，确认后才创建 Transaction。测试用 mock 仅位于测试目录，运行时代码不会回退到 mock。

默认的 `wrangler.template.jsonc` 与 CI/CD 保持免费 Worker 部署，不绑定 Container；因此在未升级时，CSV/Excel 导入完整可用，图片/PDF 任务会明确标记失败而不会伪造结果。升级 Workers Containers 后，使用专用配置部署 OCR：

```bash
# Docker 必须已运行；这会构建并发布 PaddleOCR 镜像
pnpm cf:deploy:containers:dev
pnpm cf:deploy:containers:prod
```

相应模板位于 `apps/api/wrangler.container.template.jsonc`，本地全链路配置为 `wrangler.container.local.jsonc`。

免费用户没有 AI 对话入口；Pro 用户可使用全局抽屉与完整对话页。Provider 与模型保存在每位用户的 D1 配置中，切换会在下一次对话立即生效。密钥不写入 D1：通过 Worker secret `AI_PROVIDER_KEYS` 提供 JSON 映射，例如 `{"openai":"...","anthropic":"...","openrouter":"..."}`；配置中的“密钥引用”选择映射的键名。

## CI/CD

`.github/workflows/deploy.yml` 通过 paths filter 判断 web、api、migration、shared 与基础设施的变更；仅部署受影响的层。Actions 不创建或部署 D1 数据库，只在 `packages/db/migrations` 变化时执行 migration，且 migration 会先于 API 部署完成。`main` 部署 prod，`develop` 部署 dev。需要 GitHub secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_D1_DATABASE_ID_DEV`、`CLOUDFLARE_D1_DATABASE_ID_PROD`。OAuth 密钥使用 `wrangler secret put` 分别写入 dev/prod Worker，绝不提交到仓库。
