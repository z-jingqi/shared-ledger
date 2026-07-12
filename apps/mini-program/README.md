# shared-ledger 微信小程序

这是 shared-ledger 的微信原生小程序客户端，不使用 Taro、React 或 WebView。

## 本地打开

1. 在微信开发者工具中导入 `apps/mini-program`。
2. 首次视觉预览可以保留 `project.config.json` 中的 `touristappid`。
3. 联调前，将 AppID 写入本机的项目私有配置，不要提交真实 AppID 或密钥。
4. 将 `https://dev.leger.aleph-cat.com` 配置为 request 与 uploadFile 合法域名。

默认 API 地址为 `https://dev.leger.aleph-cat.com/api`，只调用 shared-ledger API。Aleph AI Platform 与 Aleph-OCR 仍由 API Worker 的 Service Binding 调用，不进入小程序包。

## 页面

- 四个原生 Tab：首页、流水、分析、我的。
- 核心子页面：登录、记一笔、交易详情、图片识别、分类管理、成员与邀请、AI 助手。
- 自定义 TabBar 中间按钮根据套餐展示手动记账、图片识别和 AI 助手入口；free 用户不显示图片识别。

## 校验

```powershell
pnpm --filter @shared-ledger/mini-program check
pnpm --filter @shared-ledger/mini-program test
```

`check` 会验证所有页面四件套、JSON、原生组件声明、自定义 TabBar，以及源码中不存在跨端运行时。

## 当前联调边界

页面当前通过原生 `wx.request` / `wx.uploadFile` 对接已有用户名密码会话。微信 code 登录、Bearer session、AI chunked SSE、图片任务实时状态和完整编辑流程仍需要与 API 后端一起完成后才能发布正式版；页面不会用 mock 数据替代这些生产能力。
