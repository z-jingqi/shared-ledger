import { aiActionNames, type AiActionName } from "@shared-ledger/shared";
import { z } from "zod";

export const ledgerSkillNames = [
  "general.chat",
  "ledger.records",
  "ledger.search",
  "ledger.analysis",
  "ledger.imports",
  "ledger.categories",
  "ledger.books",
  "ledger.members",
  "ledger.profile",
  "ledger.subscription",
  "ledger.export",
  "ledger.navigation",
] as const;

export type LedgerSkillName = (typeof ledgerSkillNames)[number];
export type LedgerToolName = AiActionName;
export type ConfirmationPolicy = "never" | "dangerous" | "always";
export type ToolResultPartType =
  | "text"
  | "record-card"
  | "record-list"
  | "filter-result"
  | "search-result-card"
  | "analysis-card"
  | "import-job-card"
  | "pending-record-card"
  | "profile-card"
  | "member-card"
  | "confirmation-card"
  | "navigation-card";

export const ledgerToolStepSchema = z.object({
  skillName: z.enum(ledgerSkillNames),
  toolName: z.enum(aiActionNames),
  args: z.record(z.unknown()).default({}),
  userMessage: z.string().trim().max(2000).optional(),
  requiresConfirmation: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0.7),
  isFinal: z.boolean().default(true),
});
export type LedgerToolStep = z.infer<typeof ledgerToolStepSchema>;

export const ledgerSkillSelectionSchema = z.object({
  skillName: z.enum(ledgerSkillNames),
  reason: z.string().trim().max(500).optional(),
  confidence: z.number().min(0).max(1).default(0.7),
});
export type LedgerSkillSelection = z.infer<typeof ledgerSkillSelectionSchema>;

export type LedgerToolDefinition = {
  name: LedgerToolName;
  description: string;
  inputSchemaDescription: string;
  outputPartTypes: ToolResultPartType[];
  confirmation: ConfirmationPolicy;
  permissions: string[];
};

export type LedgerSkillDefinition = {
  name: LedgerSkillName;
  title: string;
  description: string;
  useWhen: string;
  tools: LedgerToolDefinition[];
};

const tool = (
  name: LedgerToolName,
  description: string,
  inputSchemaDescription: string,
  outputPartTypes: ToolResultPartType[],
  confirmation: ConfirmationPolicy = "never",
  permissions: string[] = ["book:read"],
): LedgerToolDefinition => ({
  name,
  description,
  inputSchemaDescription,
  outputPartTypes,
  confirmation,
  permissions,
});

export const ledgerSkillRegistry: LedgerSkillDefinition[] = [
  {
    name: "general.chat",
    title: "通用聊天",
    description: "回答任意普通问题、解释、建议、写作和不需要真实账本数据的内容。",
    useWhen: "用户没有要求读取或修改应用数据，或者只是普通聊天。",
    tools: [tool("chat", "自然聊天回复。", "{ message?: string }", ["text"], "never", [])],
  },
  {
    name: "ledger.records",
    title: "交易记录",
    description: "创建、修改、删除、复制交易记录。",
    useWhen: "用户要记一笔、改一笔、删除交易、创建测试数据或批量处理记录。",
    tools: [
      tool(
        "create-record",
        "新增一笔或多笔收入/支出。",
        "{ type, amount, occurredAt?, categoryId?, categoryName?, note?, items? } 或 { records: [...] }",
        ["text", "record-card"],
        "never",
        ["book:write"],
      ),
      tool(
        "update-record",
        "修改已有交易，可用 transactionId 或 relative='last'。",
        "{ transactionId?, relative?, amount?, type?, occurredAt?, categoryId?, categoryName?, note?, items? }",
        ["text", "record-card"],
        "never",
        ["transaction:own-write"],
      ),
      tool(
        "delete-record",
        "删除已有交易，支持单条或批量。",
        "{ transactionId?, transactionIds?, relative?, amount?, note?, q? }",
        ["text"],
        "always",
        ["transaction:own-delete"],
      ),
    ],
  },
  {
    name: "ledger.search",
    title: "流水搜索",
    description: "把自然语言转换为流水筛选条件，并返回真实记录。",
    useWhen: "用户要查找、列出或筛选交易，例如金额、日期、收入支出、分类、关键词。",
    tools: [
      tool(
        "search-records",
        "查询、列出、筛选流水记录。",
        "{ type?, minAmount?, minStrict?, maxAmount?, maxStrict?, from?, to?, categoryId?, categoryName?, q?, limit?, sort? }",
        ["text", "search-result-card", "filter-result"],
        "never",
        ["book:read"],
      ),
    ],
  },
  {
    name: "ledger.analysis",
    title: "账本分析",
    description: "分析收支、趋势、异常、不合理消费和汇总。",
    useWhen: "用户要理解账本数据、总结消费、找异常或做建议。",
    tools: [
      tool(
        "analyze-records",
        "基于真实交易做分析。",
        "{ type?, minAmount?, maxAmount?, from?, to?, categoryId?, categoryName?, q?, limit? }",
        ["text", "analysis-card"],
        "never",
        ["book:read"],
      ),
    ],
  },
  {
    name: "ledger.imports",
    title: "导入与识别",
    description: "处理图片附件、OCR 任务和待确认记录。",
    useWhen: "用户明确要导入、保存、OCR、入账、处理文件或确认导入结果。",
    tools: [
      tool(
        "save-attachments",
        "把附件提交为导入任务。",
        "{ autoConfirm? }",
        ["text", "import-job-card"],
        "never",
        ["book:write"],
      ),
      tool(
        "confirm-import-batch",
        "确认导入批次中的待确认记录。",
        "{ importJobId?, recordIds? }",
        ["text", "pending-record-card"],
        "always",
        ["book:write"],
      ),
      tool("cancel-task", "取消导入或 AI 任务。", "{ taskId }", ["text", "import-job-card"], "always", [
        "book:write",
      ]),
      tool("retry-task", "重试失败任务。", "{ taskId }", ["text", "import-job-card"], "never", [
        "book:write",
      ]),
    ],
  },
  {
    name: "ledger.categories",
    title: "分类",
    description: "创建、修改、删除收入和支出分类。",
    useWhen: "用户要维护分类。",
    tools: [
      tool(
        "create-category",
        "新增当前用户的个人分类。",
        "{ name, type, icon?, sortOrder? }",
        ["text"],
        "never",
        ["account:write"],
      ),
      tool(
        "update-category",
        "修改当前用户的个人分类。",
        "{ id?, name?, newName?, type?, icon?, sortOrder? }",
        ["text"],
        "never",
        ["account:write"],
      ),
      tool("delete-category", "删除当前用户的个人分类。", "{ id?, name?, type? }", ["text"], "always", [
        "account:write",
      ]),
    ],
  },
  {
    name: "ledger.books",
    title: "账本",
    description: "创建、修改、删除账本。",
    useWhen: "用户要管理账本本身。",
    tools: [
      tool("create-book", "创建新账本。", "{ name, currency? }", ["text", "navigation-card"], "never", [
        "account:write",
      ]),
      tool("update-book", "修改当前账本。", "{ id?, name?, currency? }", ["text"], "never", ["book:admin"]),
      tool("delete-book", "删除账本。", "{ id? }", ["text"], "always", ["book:owner"]),
    ],
  },
  {
    name: "ledger.members",
    title: "成员与邀请",
    description: "邀请成员、修改角色、移除成员或退出账本。",
    useWhen: "用户要处理成员、邀请、权限或退出。",
    tools: [
      tool(
        "invite-member",
        "邀请成员加入账本。",
        "{ target?, email?, phone?, userId?, role? }",
        ["text", "member-card"],
        "always",
        ["book:admin"],
      ),
      tool(
        "update-member",
        "修改成员角色。",
        "{ memberId?, userId?, name?, role }",
        ["member-card"],
        "never",
        ["book:admin"],
      ),
      tool(
        "remove-member",
        "移除成员或当前用户退出。",
        "{ memberId?, userId?, name?, self? }",
        ["text"],
        "always",
        ["book:admin"],
      ),
    ],
  },
  {
    name: "ledger.profile",
    title: "个人资料",
    description: "修改用户名、邮箱、头像等账户资料。",
    useWhen: "用户要修改自己的资料，或把上传图片设置为头像。",
    tools: [
      tool(
        "update-profile",
        "修改当前用户资料。",
        "{ name?, email?, avatarFromAttachment? }",
        ["text", "profile-card"],
        "never",
        ["account:write"],
      ),
    ],
  },
  {
    name: "ledger.subscription",
    title: "订阅",
    description: "查看套餐与升级入口。",
    useWhen: "用户询问套餐、权益、升级或当前 plan。",
    tools: [
      tool(
        "chat",
        "回答套餐相关说明；需要真实订阅数据时使用上下文。",
        "{ message?: string }",
        ["text"],
        "never",
        ["account:read"],
      ),
    ],
  },
  {
    name: "ledger.export",
    title: "导出",
    description: "导出账本数据。",
    useWhen: "用户要下载或导出当前账本。",
    tools: [
      tool("export-book", "生成导出入口。", "{ bookId? }", ["text", "navigation-card"], "always", [
        "book:read",
      ]),
    ],
  },
  {
    name: "ledger.navigation",
    title: "导航",
    description: "打开页面、Sheet 或定位记录。",
    useWhen: "用户要求打开某个功能、页面或查看详情。",
    tools: [
      tool("chat", "返回导航建议或说明。", "{ message?: string }", ["text", "navigation-card"], "never", []),
    ],
  },
];

export function listLedgerSkills() {
  return ledgerSkillRegistry;
}

export function getLedgerSkill(name: LedgerSkillName) {
  return ledgerSkillRegistry.find((skill) => skill.name === name);
}

export function listLedgerToolsForSkill(name: LedgerSkillName) {
  return getLedgerSkill(name)?.tools ?? [];
}

export function getLedgerTool(toolName: LedgerToolName, skillName?: LedgerSkillName) {
  const skills = skillName
    ? ledgerSkillRegistry.filter((skill) => skill.name === skillName)
    : ledgerSkillRegistry;
  return skills
    .flatMap((skill) => skill.tools.map((toolDefinition) => ({ ...toolDefinition, skillName: skill.name })))
    .find((toolDefinition) => toolDefinition.name === toolName);
}

export function assertToolBelongsToSkill(step: LedgerToolStep) {
  const toolDefinition = getLedgerTool(step.toolName, step.skillName);
  if (!toolDefinition) throw new Error(`工具 ${step.toolName} 不属于 Skill ${step.skillName}`);
  return toolDefinition;
}
