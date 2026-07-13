# shared-ledger 微信小程序

这是 shared-ledger 的微信原生小程序客户端，不使用 Taro、React 或 WebView。

## 本地打开

1. 在微信开发者工具中导入 `apps/mini-program`。
2. 工程已配置小程序 AppID `wx1d840b80e978929d`。
3. 将 `https://dev.leger.aleph-cat.com` 配置为 request 与 uploadFile 合法域名。

默认 API 地址为 `https://dev.leger.aleph-cat.com/api`，只调用 shared-ledger API。Aleph AI Platform 与 Aleph-OCR 仍由 API Worker 的 Service Binding 调用，不进入小程序包。

小程序使用 `wx.login()` 一键登录。游客可以预览四个主 Tab；读取真实账本或执行操作时会提示登录。API Worker 必须配置 `WECHAT_MINI_APP_SECRET`，该值不能进入小程序包或 Git 仓库。

Preview Worker 首次部署前交互式设置 Secret：

```powershell
pnpm --filter @shared-ledger/api exec wrangler secret put WECHAT_MINI_APP_SECRET --name shared-ledger-api-preview
```

本地开发将同名变量写入 `apps/api/.dev.vars`。AppSecret 在微信公众平台获取，不要写入 `project.config.json`。

## 页面

- 四个原生 Tab：首页、流水、分析、我的。
- 核心子页面：登录、记一笔、交易详情、图片识别、分类管理、成员与邀请、AI 助手。
- 自定义 TabBar 中间按钮根据套餐展示手动记账、图片识别和 AI 助手入口；free 用户不显示图片识别。

## 校验

```powershell
pnpm --filter @shared-ledger/mini-program check
pnpm --filter @shared-ledger/mini-program typecheck
pnpm --filter @shared-ledger/mini-program test
```

`typecheck` 使用微信 API 类型定义检查全部 TypeScript 运行时代码；`check` 会验证所有页面四件套、JSON、原生组件声明、自定义 TabBar、无 JavaScript 残留，以及源码中不存在跨端运行时。

## 当前联调边界

页面当前通过原生 `wx.request` / `wx.uploadFile` 和 Bearer access/refresh token 对接 API Worker。微信 code 登录已接入；AI chunked SSE、图片任务实时状态和完整编辑流程仍需要完成真机验收后才能发布正式版。页面不会用 mock 数据替代这些生产能力。
