# 一起记 / shared-ledger

移动端优先的多人共享记账 Web MVP。家庭、情侣、室友和旅行小组可在同一本账本记录收支、邀请成员、导入文件并分析支出。

## 技术栈

- Web：React、TypeScript、Vite、Tailwind CSS v4、React Router、React Hook Form、Zod、Recharts。
- API：Hono on Cloudflare Workers、D1、R2、Drizzle；AI 在 shared-ledger Worker 内通过 Vercel AI SDK 调用 OpenRouter/OpenAI/Workers AI，图片 OCR 在 shared-ledger Worker 内直接调用 Google Vision。
- 工程：pnpm monorepo、Vitest、Testing Library、Playwright、MSW。

## 目录

```text
apps/web       React 移动端界面
apps/api       Hono Worker API 与队列消费者
packages/shared 权限、类型、Zod schema
packages/db     Drizzle schema 与 D1 migrations
packages/ai     AI SDK provider adapter
packages/import 图片 OCR 文本结构化与导入 schema
packages/ui     复用 UI 原子组件
```

## 本地启动

```bash
corepack enable
pnpm install
pnpm dev
```

网页默认位于 `http://localhost:5175`，Worker 位于 `http://localhost:8789`。Web 默认通过同源 `/api` 调用 API，本地由 Vite proxy 转发到 Worker。

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

`pnpm --filter @shared-ledger/api dev` 使用本地 D1、R2 模拟。浏览器端仍只调用 shared-ledger API；OCR 和 AI 都由 API Worker 在服务端完成。写入 `apps/api/.dev.vars`：

```bash
GOOGLE_VISION_API_KEY=<google-vision-api-key>
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=<openrouter-api-key>
OPENROUTER_MODEL=deepseek/deepseek-v4-flash
pnpm --filter @shared-ledger/api dev
```

AI 也可以改用 OpenAI 或 Workers AI：

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=<openai-api-key>
OPENAI_MODEL=gpt-4.1-mini

AI_PROVIDER=workers-ai
WORKERS_AI_BASE_URL=https://api.cloudflare.com/client/v4/accounts/<account-id>/ai/v1
WORKERS_AI_API_TOKEN=<workers-ai-token>
WORKERS_AI_MODEL=@cf/meta/llama-3.1-8b-instruct
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
node scripts/ensure-cloudflare-queues.mjs prod
node scripts/prepare-wrangler-config.mjs api prod
pnpm --filter @shared-ledger/api exec wrangler d1 migrations apply shared-ledger-prod --remote --config wrangler.generated-api-prod.json
```

迁移位于 `packages/db/migrations`。迁移必须保持向后兼容：发布流程会先迁移 D1，再部署 API Worker，因此新迁移不能在同一次发布里删除当前线上 Worker 仍可能读取的旧列。Web 与 API 分开部署：Web 使用 Worker static assets，API 使用 Hono Worker。Web 与 API 共用同一个域名，API 挂在 `/api/*`：生产为 `leger.aleph-cat.com` 与 `leger.aleph-cat.com/api/*`，preview 为 `dev.leger.aleph-cat.com` 与 `dev.leger.aleph-cat.com/api/*`。Cloudflare zone 必须已托管 `aleph-cat.com`，首次部署需具备编辑 DNS/Workers routes 的 API token 权限。

## 身份与订阅

密码账号注册时只要求昵称和至少 10 位密码，邮箱、手机号均可选。账号在开通 Pro 前必须补充至少一个可恢复身份的信息（邮箱或手机号）。会话和 refresh token 都保存在 D1，并只在浏览器中以 `HttpOnly` session cookie 传递。

## 图片导入、OCR 与 AI

shared-ledger 现在只支持图片导入：jpg/jpeg/png/gif/webp/tif/tiff/bmp/raw/dng/heic/heif/avif。非图片不会进入上传导入流程。上传接口只把原图保存到 shared-ledger R2 并创建导入任务，后续由 Cloudflare Queue 串行执行四段流水线：格式转换、Google Vision OCR、AI 结构化、生成待确认记录。Google Vision 可直接识别的图片会跳过转换；OCR 不支持但 Worker 内 codec 可解码的 HEIC/HEIF/AVIF 会转成 JPEG OCR 输入对象；其它不支持格式会失败并提示用户重传。OCR 原文保存在 shared-ledger D1 里，随后交给本项目的 AI 结构化流程。AI 输出会经过 Zod 校验，只生成待确认记录，确认后才创建 Transaction。

图片识别有套餐限制：

- free：不显示图片识别入口；直接调用上传接口会被拒绝。
- pro：每天最多 10 张成功生成导入数据的图片。
- 上传后取消、OCR 失败、AI 结构化失败或没有生成记录时，不计入 shared-ledger 图片识别额度。

生产环境需要为 API Worker 配置：

- 普通变量：`AI_PROVIDER`，可选 `openrouter`、`openai`、`workers-ai`
- OpenRouter 普通变量：`OPENROUTER_MODEL`，默认建议 `deepseek/deepseek-v4-flash`
- Queue binding：`IMPORT_PIPELINE_QUEUE` 指向 `shared-ledger-import-pipeline-{preview|prod}`，consumer `max_batch_size=1`、`max_concurrency=1`、`max_retries=3`
- Secret：`GOOGLE_VISION_API_KEY`
- OpenRouter Secret：`OPENROUTER_API_KEY`
- 微信小程序 Secret：`WECHAT_MINI_APP_SECRET`（AppID 为 `wx1d840b80e978929d`）
- OpenAI：`OPENAI_API_KEY`、`OPENAI_MODEL`
- Workers AI：`WORKERS_AI_BASE_URL`、`WORKERS_AI_API_TOKEN`、`WORKERS_AI_MODEL`

缺少 `GOOGLE_VISION_API_KEY` 时图片导入会明确失败。缺少当前 `AI_PROVIDER` 对应 key/model 时，AI 聊天和图片结构化会明确失败。

所有已登录用户都可以进入 AI 助手；shared-ledger 后端负责业务上下文、skill/tool schema、用户身份、权限和 AI/OCR 调用配置。产品侧的图片识别额度仍由 shared-ledger 自己的套餐规则限制。

## CI/CD

`.github/workflows/deploy.yml` 通过 paths filter 判断 web、api、migration、shared 与基础设施的变更；仅部署受影响的层。Actions 不创建或部署 D1/R2，只在 `packages/db/migrations` 变化时执行 migration，且 migration 会先于 API 部署完成。`main` 部署 prod，`develop` 部署 preview。GitHub Actions 只需要 Cloudflare 部署权限：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。Google Vision 与 AI provider token 是 API Worker runtime secrets，应直接配置在 Cloudflare Worker 上。prod D1 id 使用 GitHub variable `CLOUDFLARE_D1_DATABASE_ID_PROD`。
