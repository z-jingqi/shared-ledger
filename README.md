# 一起记 / shared-ledger

移动端优先的多人共享记账 Web MVP。家庭、情侣、室友和旅行小组可在同一本账本记录收支、邀请成员、导入文件并分析支出。

## 技术栈

- Web：React、TypeScript、Vite、Tailwind CSS v4、React Router、React Hook Form、Zod、Recharts。
- API：Hono on Cloudflare Workers、D1、R2、Drizzle；AI 通过 Aleph AI Platform service binding，图片 OCR 通过 Aleph Tools service binding。
- 工程：pnpm monorepo、Vitest、Testing Library、Playwright、MSW。

## 目录

```text
apps/web       React 移动端界面
apps/api       Hono Worker API 与队列消费者
packages/shared 权限、类型、Zod schema
packages/db     Drizzle schema 与 D1 migrations
packages/ai     Aleph AI Platform adapter
packages/import 图片 OCR 文本结构化与导入 schema
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
pnpm db:seed:local
```

也可以一次执行：

```bash
pnpm db:setup:local
```

`db:seed:local` 会可重复地创建本地测试账号 `SoundOnly / 123456`、默认账本 `SoundOnly` 和 creator 成员关系。执行 destructive migration 后旧数据会被清空，如果浏览器还带着旧 `bookId`，前端会自动落到有效账本或空账本状态。

`pnpm --filter @shared-ledger/api dev` 使用本地 D1、R2 模拟。AI 调用必须经过 shared-ledger API，再通过 `AI_ORCHESTRATOR` service binding 调用 Aleph AI Platform；图片 OCR 通过 `ALEPH_TOOLS` service binding 调用 Aleph Tools。Aleph AI Platform 与 Aleph Tools 的 `/v1/*` 均要求 secret/API key，写入 `apps/api/.dev.vars`：

```bash
ALEPH_AI_SERVICE_TOKEN=<local-ai-service-token>
ALEPH_TOOLS_API_KEY=dev-key
ALEPH_TOOLS_WEBHOOK_SECRET=aleph-tools-local-webhook-secret
pnpm --filter @shared-ledger/api dev
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

每个环境各自拥有 D1 和 R2：`shared-ledger-{preview|prod}`。preview 资源已由 wrangler 创建，prod 需要先创建资源并把 D1 id 写入环境变量，再生成配置：

```bash
wrangler d1 create shared-ledger-prod
wrangler r2 bucket create shared-ledger-files-prod
$env:CLOUDFLARE_D1_DATABASE_ID_PROD = "<D1 id>"
node scripts/prepare-wrangler-config.mjs api prod
pnpm --filter @shared-ledger/api exec wrangler d1 migrations apply shared-ledger-prod --remote --config wrangler.generated-api-prod.json
```

迁移位于 `packages/db/migrations`。Web 与 API 分开部署：Web 使用 Worker static assets，API 使用 Hono Worker。自定义域名已作为模板配置：生产为 `leger.aleph-cat.com` 与 `api.leger.aleph-cat.com`，preview 为 `dev.leger.aleph-cat.com` 与 `api.dev.leger.aleph-cat.com`。Cloudflare zone 必须已托管 `aleph-cat.com`，首次部署需具备编辑 DNS/Workers routes 的 API token 权限。

## 身份与订阅

密码账号注册时只要求昵称和至少 10 位密码，邮箱、手机号均可选。账号在开通 Pro 前必须补充至少一个可恢复身份的信息（邮箱或手机号）。会话和 refresh token 都保存在 D1，并只在浏览器中以 `HttpOnly` session cookie 传递。

## 图片导入、OCR 与 AI

shared-ledger 现在只支持图片导入：jpg/jpeg/png/gif/webp/tif/tiff/bmp/raw/dng/heic/heif。非图片不会进入上传导入流程。原图先进入 shared-ledger R2，然后 API Worker 通过 `ALEPH_TOOLS` service binding 调用 Aleph Tools 最新 `POST /v1/tools/ocr`；multipart 只发送 `file`、`callbackUrl`、`metadata`。OCR ready 后读取 `/v1/jobs/:id/result` 的 `plainText`/`markdown`，再交给 AI 结构化。AI 输出会经过 Zod 校验，只生成待确认记录，确认后才创建 Transaction。

图片识别有套餐限制：

- free：不显示图片识别入口；直接调用上传接口会被拒绝。
- pro：每天最多 10 张成功生成导入数据的图片。
- 上传后取消、OCR 失败、AI 结构化失败或没有生成记录时，不计入 shared-ledger 图片识别额度。

生产环境需要为 API Worker 配置：

- Service binding：`AI_ORCHESTRATOR`，preview 指向 `aleph-ai-orchestrator-preview`，prod 指向 `aleph-ai-orchestrator`
- Service binding：`ALEPH_TOOLS`，preview 指向 `aleph-tools-gateway-preview`，prod 指向 `aleph-tools-gateway-prod`
- 普通变量：`ALEPH_AI_ENV`
- Secret：`ALEPH_AI_SERVICE_TOKEN`
- Secret：`ALEPH_TOOLS_API_KEY`
- Secret：`ALEPH_TOOLS_WEBHOOK_SECRET`

缺少 `AI_ORCHESTRATOR` / `ALEPH_AI_SERVICE_TOKEN` 或 `ALEPH_TOOLS` service binding 时，对应 AI/OCR 功能会明确失败。缺少 `ALEPH_TOOLS_API_KEY` 时，图片导入会明确失败。

所有已登录用户都可以进入 AI 助手；shared-ledger 后端负责业务上下文、skill/tool schema、用户身份和权限，AI 出入口、provider/model 路由、quota 与 usage 由 Aleph AI Platform 负责，并通过 service binding 调用。

## CI/CD

`.github/workflows/deploy.yml` 通过 paths filter 判断 web、api、migration、shared 与基础设施的变更；仅部署受影响的层。Actions 不创建或部署 D1/R2，只在 `packages/db/migrations` 变化时执行 migration，且 migration 会先于 API 部署完成。`main` 部署 prod，`develop` 部署 preview。需要 GitHub secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`ALEPH_AI_SERVICE_TOKEN`、`ALEPH_TOOLS_API_KEY`、`ALEPH_TOOLS_WEBHOOK_SECRET`。prod D1 id 使用 GitHub variable `CLOUDFLARE_D1_DATABASE_ID_PROD`。
