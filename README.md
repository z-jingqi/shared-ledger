# 一起记 / shared-ledger

移动端优先的多人共享记账 Web MVP。家庭、情侣、室友和旅行小组可在同一本账本记录收支、邀请成员、导入文件并分析支出。

## 技术栈

- Web：React、TypeScript、Vite、Tailwind CSS v4、React Router、React Hook Form、Zod、Recharts。
- API：Hono on Cloudflare Workers、D1、R2、Queues、Drizzle；AI 通过 Aleph AI Platform，图片/PDF OCR 通过 Aleph Tools。
- 工程：pnpm monorepo、Vitest、Testing Library、Playwright、MSW。

## 目录

```text
apps/web       React 移动端界面
apps/api       Hono Worker API 与队列消费者
packages/shared 权限、类型、Zod schema
packages/db     Drizzle schema 与 D1 migrations
packages/ai     Aleph AI Platform adapter
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
pnpm db:seed:local
```

也可以一次执行：

```bash
pnpm db:setup:local
```

`db:seed:local` 会可重复地创建本地测试账号 `SoundOnly / 123456`、默认账本 `SoundOnly` 和 creator 成员关系。执行 destructive migration 后旧数据会被清空，如果浏览器还带着旧 `bookId`，前端会自动落到有效账本或空账本状态。

`pnpm --filter @shared-ledger/api dev` 使用本地 D1、R2、Queue 模拟，认证、账本与 CSV/Excel 导入均可本地验证。AI 调用必须经过 shared-ledger API 再到 Aleph AI Platform；图片和 PDF 的 OCR 需要可访问的 Aleph Tools 服务。Aleph Tools 本地默认指向 `http://127.0.0.1:8787`，API key 写入 `apps/api/.dev.vars`：

```bash
ALEPH_AI_SERVICE_TOKEN=...
ALEPH_TOOLS_API_KEY=dev-key
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

每个环境各自拥有 D1、R2 和 Queue：`shared-ledger-{preview|prod}`。preview 资源已由 wrangler 创建，prod 需要先创建资源并把 D1 id 写入环境变量，再生成配置：

```bash
wrangler d1 create shared-ledger-prod
wrangler r2 bucket create shared-ledger-files-prod
wrangler queues create shared-ledger-imports-prod
$env:CLOUDFLARE_D1_DATABASE_ID_PROD = "<D1 id>"
node scripts/prepare-wrangler-config.mjs api prod
pnpm --filter @shared-ledger/api exec wrangler d1 migrations apply shared-ledger-prod --remote --config wrangler.generated-api-prod.json
```

迁移位于 `packages/db/migrations`。Web 与 API 分开部署：Web 使用 Worker static assets，API 使用 Hono Worker。自定义域名已作为模板配置：生产为 `leger.aleph-cat.com` 与 `api.leger.aleph-cat.com`，preview 为 `dev.leger.aleph-cat.com` 与 `api.dev.leger.aleph-cat.com`。Cloudflare zone 必须已托管 `aleph-cat.com`，首次部署需具备编辑 DNS/Workers routes 的 API token 权限。

## 身份与订阅

密码账号注册时只要求昵称和至少 10 位密码，邮箱、手机号均可选。账号在开通 Pro 前必须补充至少一个可恢复身份的信息（邮箱或手机号）。会话和 refresh token 都保存在 D1，并只在浏览器中以 `HttpOnly` session cookie 传递。

## 文件导入、OCR 与 AI

原文件先进入 R2，再通过 Queue 处理；CSV 和 Excel 在 Worker 中解析。图片或 PDF 通过公共 Aleph Tools v6 工具接口处理：图片先按需调用 `image.convert`，随后统一调用 `image.compress`，最后将压缩后的图片提交给 `ocr`；PDF 直接提交给 `ocr`。OCR ready 后再交给 AI 结构化。AI 输出会经过 Zod 校验，只生成待确认记录，确认后才创建 Transaction。测试用 mock 仅位于测试目录，运行时代码不会回退到 mock 或本地 OCR。

生产环境需要为 API Worker 配置：

- 普通变量：`ALEPH_TOOLS_BASE_URL`，默认模板为 preview `https://ocr.dev.aleph-cat.com`、prod `https://ocr.aleph-cat.com`
- Secret：`ALEPH_TOOLS_API_KEY`
- Secret：`ALEPH_TOOLS_WEBHOOK_SECRET`

缺少 `ALEPH_TOOLS_API_KEY` 时，图片/PDF 导入会明确失败；CSV/Excel 不受影响。

免费用户没有 AI 对话入口；Pro 用户可使用全局抽屉与完整对话页。shared-ledger 后端负责业务上下文、prompt、tool schema、用户身份和权限，AI 出入口、provider/model 路由、quota 与 usage 由 Aleph AI Platform 负责。部署时需要 Worker secret `ALEPH_AI_SERVICE_TOKEN`。

## CI/CD

`.github/workflows/deploy.yml` 通过 paths filter 判断 web、api、migration、shared 与基础设施的变更；仅部署受影响的层。Actions 不创建或部署 D1/R2/Queue，只在 `packages/db/migrations` 变化时执行 migration，且 migration 会先于 API 部署完成。`main` 部署 prod，`develop` 部署 preview。需要 GitHub secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`ALEPH_AI_SERVICE_TOKEN`、`ALEPH_TOOLS_API_KEY`、`ALEPH_TOOLS_WEBHOOK_SECRET`。prod D1 id 使用 GitHub variable `CLOUDFLARE_D1_DATABASE_ID_PROD`。
