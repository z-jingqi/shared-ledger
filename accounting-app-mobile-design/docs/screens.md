# 页面设计稿说明

本文件用于帮助 AI 或开发者理解每个移动端页面的用途。所有图片均为单页 PNG，位于 `screens/` 目录。

## 产品原则

- 简洁扁平，避免复杂嵌套。
- 一个页面只呈现当前任务最重要的信息。
- 账本不分类，记录只有收入和支出。
- 转账作为备注或标签处理，不作为独立记录类型。
- 免费用户无 AI 助手入口，仅在导入流程中使用后台智能识别。
- 订阅用户可使用完整 AI 助手，并可在任意页面呼出全局 AI 抽屉。
- 任何成员只能修改自己创建的记录；创建者/管理员可邀请成员、修改权限。
- 创建者只是特殊标记：只有创建者可以删除账本。

## 页面清单

### 01-account

- **登录**：`screens/01-account/01-login.png`  
  账号登录页，支持邮箱密码登录与第三方图标登录。
- **注册**：`screens/01-account/02-register.png`  
  创建新账号，包含邮箱、密码、确认密码与协议确认。
- **账号设置**：`screens/01-account/03-account-settings.png`  
  用户资料、安全、通知、语言、主题、订阅与退出登录入口。
- **订阅与套餐**：`screens/01-account/04-subscription.png`  
  订阅升级页，展示年度/月度套餐和高级版权益。

### 02-books

- **账本列表**：`screens/02-books/01-book-list.png`  
  展示用户创建或加入的账本，支持创建新账本。
- **创建账本**：`screens/02-books/02-create-book.png`  
  创建新账本，填写名称、默认货币、备注以及基础开关。
- **账本首页**：`screens/02-books/03-book-home.png`  
  当前账本的月度收入、支出、结余、待确认和最近记录。
- **账本设置**：`screens/02-books/04-book-settings.png`  
  账本名称、货币、成员权限、预算、分类、标签与删除账本。

### 03-invitations

- **我的邀请**：`screens/03-invitations/01-my-invitations.png`  
  查看收到的账本邀请，支持接受或拒绝。
- **已发邀请**：`screens/03-invitations/02-sent-invitations.png`  
  查看已发出的邀请状态，支持提醒或撤回。

### 04-records

- **记录列表**：`screens/04-records/01-record-list.png`  
  按日期展示收入和支出记录，支持搜索、筛选和记一笔。
- **新增记录**：`screens/04-records/02-new-record.png`  
  新增收入或支出记录，填写金额、分类、成员、时间、账户、标签、备注与明细。
- **编辑记录**：`screens/04-records/03-edit-record.png`  
  编辑本人创建的记录，可修改基础字段、明细或删除记录。
- **记录详情**：`screens/04-records/04-record-detail.png`  
  查看记录详情、明细、附件和创建人。
- **添加明细**：`screens/04-records/05-add-line-items.png`  
  为一笔记录拆分明细，支持多项目金额分配。

### 05-import

- **导入**：`screens/05-import/01-import-upload.png`  
  上传图片、PDF、Excel、CSV 文件，进入智能识别流程。
- **待确认记录**：`screens/05-import/02-pending-records.png`  
  展示导入后识别出的待确认记录，支持编辑、确认、全部确认。
- **导入历史**：`screens/05-import/03-import-history.png`  
  查看导入任务历史、处理状态和识别记录数。

### 06-analysis

- **分析**：`screens/06-analysis/01-analysis.png`  
  收入、支出、结余、趋势、分类占比和成员支出排行。

### 07-members

- **成员管理**：`screens/07-members/01-member-management.png`  
  查看当前成员、邀请中的成员，并管理成员和邀请。
- **邀请成员**：`screens/07-members/02-invite-member.png`  
  通过邮箱、手机号或链接邀请成员加入当前账本。
- **成员权限编辑**：`screens/07-members/03-member-role-edit.png`  
  创建者/管理员/成员角色选择与权限说明。

### 08-settings

- **设置**：`screens/08-settings/01-settings-home.png`  
  分类、标签、账户、导出、隐私、通知、关于和退出登录。
- **分类管理**：`screens/08-settings/02-category-management.png`  
  管理收入/支出分类，支持排序和新增。
- **标签管理**：`screens/08-settings/03-tag-management.png`  
  查看、搜索、新增标签。
- **账户管理**：`screens/08-settings/04-payment-account-management.png`  
  管理现金、微信、支付宝、银行卡、信用卡等账户。
- **导出数据**：`screens/08-settings/05-export-data.png`  
  选择导出范围、内容、格式和导出方式。
- **隐私设置**：`screens/08-settings/06-privacy-settings.png`  
  控制金额、收入、记录可见性、导入文件保存和 AI 分析授权。

### 09-ai

- **AI 助手**：`screens/09-ai/01-ai-assistant-page.png`  
  订阅用户可见的完整对话页，类似 ChatGPT 首页。
- **全局 AI 助手抽屉**：`screens/09-ai/02-global-ai-drawer.png`  
  订阅用户在任何页面可呼出的 AI 助手抽屉。

## AI 可见性

- 免费用户：不显示 AI 助手页、AI 悬浮按钮、AI 对话入口。
- 免费用户：上传图片/文件时，后端可以使用 OCR/AI 生成待确认记录。
- 订阅用户：显示 AI 助手页和全局 AI 抽屉。
- AI Provider 与模型切换属于后端配置，用户不可见、不可选择。