import {
  canDeleteBook,
  canInvite,
  canManageMembers,
  canMutateTransaction,
  categorySchema,
  createBookSchema,
  createTransactionSchema,
  tagSchema,
  updateProfileSchema,
  type AiActionName,
  type AiChatPart,
  type AiToolCallPlan,
  type Role,
} from "@shared-ledger/shared";
import { supportedFileExtensions } from "@shared-ledger/shared";
import { supportedFileTypes } from "@shared-ledger/import";
import { z } from "zod";
import { D1LedgerRepository } from "../repository";
import type { MemoryLedgerStore, SimpleEntity } from "../store";
import type { LedgerUser, Transaction } from "../types";
import type { Env } from "../types";
import { updateUserAvatar, updateUserProfile } from "./auth";
import {
  isOcrImportFileType,
  isImageImportFileType,
  markFailed,
  submitAlephOcrJob,
  submitAlephPipelineJob,
  type ImportQueueMessage,
} from "./imports";

export type AiToolRepository = D1LedgerRepository | MemoryLedgerStore;

export type AiToolDefinition = {
  name: AiActionName;
  description: string;
  confirmation: "never" | "dangerous" | "always";
  argsSchemaDescription: string;
};

type AiToolRuntime = {
  env: Env;
  repository: AiToolRepository;
  store?: MemoryLedgerStore;
  user: LedgerUser;
  sessionId: string;
  bookId?: string;
  prompt: string;
  today: string;
  timeZone: string;
  origin: string;
  attachments: File[];
};

type ToolExecutionResult = {
  parts: Array<Record<string, unknown>>;
  result?: Record<string, unknown>;
  changed?: string[];
};

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

export const aiToolDefinitions: AiToolDefinition[] = [
  {
    name: "chat",
    description: "普通聊天、解释、写作、闲聊、与账本无关的问题，或不需要真实应用数据的问题。",
    confirmation: "never",
    argsSchemaDescription: "{ message?: string }",
  },
  {
    name: "search-records",
    description: "查询、列出、筛选流水记录。需要真实账本数据时使用。",
    confirmation: "never",
    argsSchemaDescription: "{ type?, minAmount?, maxAmount?, from?, to?, categoryId?, categoryName?, q?, limit? }",
  },
  {
    name: "analyze-records",
    description: "分析收支、异常、大额、不合理消费、趋势和汇总。",
    confirmation: "never",
    argsSchemaDescription: "{ type?, minAmount?, maxAmount?, from?, to?, categoryId?, categoryName?, q?, limit? }",
  },
  {
    name: "create-record",
    description: "新增一笔或多笔收入/支出记录，用户要求创建测试/mock 数据时也使用这个工具。",
    confirmation: "never",
    argsSchemaDescription: "{ type, amount, occurredAt?, categoryId?, categoryName?, note?, tagIds?, tagNames?, items? } 或 { records: [{ type, amount, occurredAt?, categoryId?, categoryName?, note?, tagIds?, tagNames?, items? }] }",
  },
  {
    name: "update-record",
    description: "修改已有交易记录，可通过 transactionId 或 relative='last' 指向刚才/最近创建的记录。",
    confirmation: "never",
    argsSchemaDescription: "{ transactionId?, relative?, amount?, type?, occurredAt?, categoryId?, categoryName?, note?, tagIds?, tagNames?, items? }",
  },
  {
    name: "delete-record",
    description: "删除已有交易记录，可通过 transactionId、transactionIds、relative='last' 或 q 查询删除；批量删除必须确认。",
    confirmation: "always",
    argsSchemaDescription: "{ transactionId?, transactionIds?, relative?, amount?, note?, q? }",
  },
  {
    name: "create-category",
    description: "新增收入或支出分类。",
    confirmation: "never",
    argsSchemaDescription: "{ name, type, icon?, sortOrder? }",
  },
  {
    name: "update-category",
    description: "修改分类名称、类型、图标或排序。",
    confirmation: "never",
    argsSchemaDescription: "{ id?, name?, newName?, type?, icon?, sortOrder? }",
  },
  {
    name: "delete-category",
    description: "删除分类。关联记录保留，但分类会清空。",
    confirmation: "always",
    argsSchemaDescription: "{ id?, name?, type? }",
  },
  {
    name: "create-tag",
    description: "新增标签。",
    confirmation: "never",
    argsSchemaDescription: "{ name, color? }",
  },
  {
    name: "update-tag",
    description: "修改标签名称或颜色。",
    confirmation: "never",
    argsSchemaDescription: "{ id?, name?, newName?, color? }",
  },
  {
    name: "delete-tag",
    description: "删除标签。记录保留，标签关联会移除。",
    confirmation: "always",
    argsSchemaDescription: "{ id?, name? }",
  },
  {
    name: "create-book",
    description: "创建新账本。",
    confirmation: "never",
    argsSchemaDescription: "{ name, currency? }",
  },
  {
    name: "update-book",
    description: "修改当前账本名称或币种。",
    confirmation: "never",
    argsSchemaDescription: "{ id?, name?, currency? }",
  },
  {
    name: "delete-book",
    description: "删除账本。",
    confirmation: "always",
    argsSchemaDescription: "{ id? }",
  },
  {
    name: "update-profile",
    description: "修改当前用户用户名、邮箱，或把上传的图片设置为头像。",
    confirmation: "never",
    argsSchemaDescription: "{ name?, email?, avatarFromAttachment? }",
  },
  {
    name: "update-member",
    description: "修改账本成员角色。",
    confirmation: "never",
    argsSchemaDescription: "{ memberId?, userId?, name?, role }",
  },
  {
    name: "remove-member",
    description: "移除账本成员或当前用户退出账本。",
    confirmation: "always",
    argsSchemaDescription: "{ memberId?, userId?, name?, self? }",
  },
  {
    name: "invite-member",
    description: "邀请成员加入账本。",
    confirmation: "always",
    argsSchemaDescription: "{ target?, email?, phone?, userId?, role? }",
  },
  {
    name: "export-book",
    description: "导出当前账本数据。",
    confirmation: "always",
    argsSchemaDescription: "{ bookId? }",
  },
  {
    name: "save-attachments",
    description: "用户明确要求保存、导入、OCR、入账或处理附件为账本数据时使用。",
    confirmation: "never",
    argsSchemaDescription: "{ autoConfirm? }",
  },
  {
    name: "confirm-import-batch",
    description: "确认导入批次中的待确认记录。",
    confirmation: "always",
    argsSchemaDescription: "{ importJobId?, recordIds? }",
  },
  {
    name: "cancel-task",
    description: "取消可取消的导入或 AI 任务。",
    confirmation: "always",
    argsSchemaDescription: "{ taskId }",
  },
  {
    name: "retry-task",
    description: "重试失败且可重试的导入或 AI 任务。",
    confirmation: "never",
    argsSchemaDescription: "{ taskId }",
  },
];

const searchArgsSchema = z.object({
  type: z.enum(["income", "expense"]).optional(),
  minAmount: z.coerce.number().positive().optional(),
  maxAmount: z.coerce.number().positive().optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  categoryId: z.string().trim().min(1).optional(),
  categoryName: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["date_desc", "date_asc", "amount_desc", "amount_asc"]).default("date_desc"),
});

const singleRecordArgsSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.coerce.number().positive(),
  occurredAt: z.string().trim().min(1).optional(),
  categoryId: z.string().trim().min(1).optional(),
  categoryName: z.string().trim().min(1).optional(),
  note: z.string().trim().max(500).optional(),
  tagIds: z.array(z.string().trim().min(1)).default([]),
  tagNames: z.array(z.string().trim().min(1)).default([]),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        amount: z.coerce.number().positive(),
        categoryId: z.string().trim().min(1).optional(),
        categoryName: z.string().trim().min(1).optional(),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .default([]),
});

const recordArgsSchema = singleRecordArgsSchema;
const createRecordsArgsSchema = z.union([
  singleRecordArgsSchema,
  z.object({ records: z.array(singleRecordArgsSchema).min(1).max(20) }),
]);

const updateRecordArgsSchema = recordArgsSchema.partial().extend({
  transactionId: z.string().trim().min(1).optional(),
  relative: z.enum(["last", "previous", "latest"]).optional(),
});

const targetRecordArgsSchema = z.object({
  transactionId: z.string().trim().min(1).optional(),
  transactionIds: z.array(z.string().trim().min(1)).default([]),
  relative: z.enum(["last", "previous", "latest"]).optional(),
  amount: z.coerce.number().positive().optional(),
  note: z.string().trim().max(500).optional(),
  q: z.string().trim().max(200).optional(),
});

const categoryArgsSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(30).optional(),
  newName: z.string().trim().min(1).max(30).optional(),
  type: z.enum(["income", "expense"]).optional(),
  icon: z.string().trim().max(40).optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
});

const tagArgsSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(30).optional(),
  newName: z.string().trim().min(1).max(30).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

const memberArgsSchema = z.object({
  memberId: z.string().trim().min(1).optional(),
  userId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  role: z.enum(["admin", "member"]).optional(),
  self: z.boolean().optional(),
});

export function toolDefinitionsForModel() {
  return aiToolDefinitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    confirmation: tool.confirmation,
    argsSchemaDescription: tool.argsSchemaDescription,
  }));
}

export async function executeAiTool(
  runtime: AiToolRuntime,
  plan: AiToolCallPlan,
  options: { confirmed?: boolean; toolCallId?: string } = {},
): Promise<ToolExecutionResult> {
  const definition = aiToolDefinitions.find((tool) => tool.name === plan.toolName);
  if (!definition) return textResult(`暂不支持工具：${plan.toolName}`);
  if (definition.name === "chat") return textResult(plan.userMessage || "我在。");
  const bookId = await resolveBookId(runtime.repository, runtime.user.id, runtime.bookId);
  const needsBook = !["create-book", "update-profile"].includes(definition.name);
  if (needsBook && !bookId) return textResult("请先选择一个账本。");
  if (bookId) {
    const currentRole = await bookRoleFor(runtime.repository, bookId, runtime.user.id);
    if (!currentRole) return textResult("你没有访问这个账本的权限。");
  }
  const requiresConfirmation = definition.confirmation === "always" || plan.requiresConfirmation;
  const toolCall =
    options.toolCallId && runtime.repository instanceof D1LedgerRepository
      ? { id: options.toolCallId }
      : runtime.repository instanceof D1LedgerRepository
        ? await runtime.repository.createAiToolCall({
            sessionId: runtime.sessionId,
            userId: runtime.user.id,
            bookId,
            toolName: definition.name,
            status: requiresConfirmation && !options.confirmed ? "pending_confirmation" : "running",
            args: plan.args,
          })
        : undefined;
  try {
    if (requiresConfirmation && !options.confirmed) {
      const confirmation = await createConfirmation(runtime.repository, {
        userId: runtime.user.id,
        bookId,
        action: definition.name,
        payload: { toolName: definition.name, args: plan.args, sessionId: runtime.sessionId, toolCallId: toolCall?.id },
      });
      const parts: AiChatPart[] = [
        {
          type: "tool-status",
          tool: definition.name,
          status: "pending_confirmation",
          label: "等待确认",
          message: confirmationSummary(definition.name, plan.args),
        },
        confirmationPart(confirmation, definition.name),
      ];
      return { parts, result: { confirmationId: confirmation.id, toolCallId: toolCall?.id } };
    }
    const result = await executeConfirmedTool(runtime, definition.name, plan.args, bookId);
    if (toolCall && runtime.repository instanceof D1LedgerRepository) {
      await runtime.repository.updateAiToolCall(toolCall.id, { status: "completed", result: result.result }, runtime.user.id);
    }
    return result;
  } catch (error) {
    if (toolCall && runtime.repository instanceof D1LedgerRepository) {
      await runtime.repository.updateAiToolCall(
        toolCall.id,
        {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "工具执行失败",
        },
        runtime.user.id,
      );
    }
    return {
      parts: [
        {
          type: "tool-status",
          tool: definition.name,
          status: "error",
          label: "执行失败",
          message: error instanceof Error ? error.message : "工具执行失败",
        },
      ],
    };
  }
}

export async function confirmAiTool(runtime: AiToolRuntime, confirmationId: string) {
  const confirmation = await getConfirmation(runtime.repository, runtime.user.id, confirmationId);
  if (!confirmation) return { status: 404, body: { error: "确认项不存在" } };
  if (confirmation.status !== "pending") return { status: 409, body: { confirmation } };
  if (new Date(confirmation.expiresAt).getTime() <= Date.now()) {
    const cancelled = await updateConfirmation(runtime.repository, confirmation, {
      status: "cancelled",
      result: { reason: "expired" },
      cancelledAt: now(),
    });
    return { status: 409, body: { confirmation: cancelled, expired: true } };
  }
  const payload = confirmation.payload as { toolName?: AiActionName; args?: Record<string, unknown>; sessionId?: string; toolCallId?: string };
  if (!payload.toolName) return { status: 400, body: { error: "确认项缺少工具信息" } };
  const result = await executeAiTool(
    { ...runtime, sessionId: payload.sessionId ?? runtime.sessionId, bookId: confirmation.bookId ?? runtime.bookId },
    {
      toolName: payload.toolName,
      args: payload.args ?? {},
      requiresConfirmation: false,
      confidence: 1,
    },
    { confirmed: true, toolCallId: payload.toolCallId },
  );
  const updated = await updateConfirmation(runtime.repository, confirmation, {
    status: "confirmed",
    result: result.result ?? {},
    confirmedAt: now(),
  });
  return { status: 200, body: { confirmation: updated, parts: result.parts, result: result.result } };
}

export async function cancelAiToolConfirmation(repository: AiToolRepository, userId: string, confirmationId: string) {
  const confirmation = await getConfirmation(repository, userId, confirmationId);
  if (!confirmation) return { status: 404, body: { error: "确认项不存在" } };
  if (confirmation.status !== "pending") return { status: 409, body: { confirmation } };
  const updated = await updateConfirmation(repository, confirmation, {
    status: "cancelled",
    result: { reason: "user_cancelled" },
    cancelledAt: now(),
  });
  return { status: 200, body: { confirmation: updated } };
}

async function executeConfirmedTool(
  runtime: AiToolRuntime,
  toolName: AiActionName,
  args: Record<string, unknown>,
  bookId?: string,
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case "search-records":
      return searchRecords(runtime, bookId!, args);
    case "analyze-records":
      return analyzeRecords(runtime, bookId!, args);
    case "create-record":
      return createRecord(runtime, bookId!, args);
    case "update-record":
      return updateRecord(runtime, bookId!, args);
    case "delete-record":
      return deleteRecord(runtime, bookId!, args);
    case "create-category":
      return createCategory(runtime, bookId!, args);
    case "update-category":
      return updateCategory(runtime, bookId!, args);
    case "delete-category":
      return deleteCategory(runtime, bookId!, args);
    case "create-tag":
      return createTag(runtime, bookId!, args);
    case "update-tag":
      return updateTag(runtime, bookId!, args);
    case "delete-tag":
      return deleteTag(runtime, bookId!, args);
    case "create-book":
      return createBook(runtime, args);
    case "update-book":
      return updateBook(runtime, bookId!, args);
    case "delete-book":
      return deleteBook(runtime, bookId!, args);
    case "update-profile":
      return updateProfile(runtime, args);
    case "update-member":
      return updateMember(runtime, bookId!, args);
    case "remove-member":
      return removeMember(runtime, bookId!, args);
    case "invite-member":
      return inviteMember(runtime, bookId!, args);
    case "export-book":
      return {
        parts: [
          { type: "text", text: "可以，下面是导出入口。" },
          { type: "navigation-card", pageName: "导出账本", href: `/books/${bookId}/export`, description: "下载当前账本 JSON 数据" },
        ],
      };
    case "save-attachments":
      return saveAttachments(runtime, bookId!, args);
    case "confirm-import-batch":
      return textResult("我已经准备好确认导入；这个工具会在待确认记录重构后接入批量确认。");
    case "cancel-task":
    case "retry-task":
      return textResult("任务操作已收到；请在文件任务卡片中继续查看状态。");
    default:
      return textResult("这个操作暂时还没有对应的工具。");
  }
}

async function searchRecords(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const args = searchArgsSchema.parse(rawArgs);
  const transactions = await searchTransactions(runtime.repository, bookId, args);
  const limited = transactions.slice(0, args.limit);
  const expense = transactions.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount, 0);
  const income = transactions.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amount, 0);
  return {
    parts: [
      {
        type: "text",
        text: `找到 ${transactions.length} 条记录，支出 ¥${expense.toFixed(2)}，收入 ¥${income.toFixed(2)}。`,
      },
      {
        type: "search-result-card",
        title: "搜索结果",
        summary: `共 ${transactions.length} 条记录`,
        results: limited.map(transactionResult),
        pageName: "记录页",
        href: `/records?bookId=${bookId}`,
      },
    ],
    result: { count: transactions.length, ids: limited.map((item) => item.id) },
  };
}

async function analyzeRecords(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const args = searchArgsSchema.parse(rawArgs);
  const transactions = await searchTransactions(runtime.repository, bookId, args);
  const expenseItems = transactions.filter((item) => item.type === "expense");
  const incomeItems = transactions.filter((item) => item.type === "income");
  const expense = expenseItems.reduce((sum, item) => sum + item.amount, 0);
  const income = incomeItems.reduce((sum, item) => sum + item.amount, 0);
  const largest = [...expenseItems].sort((left, right) => right.amount - left.amount)[0];
  const summary = largest
    ? `当前范围内支出 ¥${expense.toFixed(2)}，收入 ¥${income.toFixed(2)}。最大支出是「${largest.note ?? "无备注"}」¥${largest.amount.toFixed(2)}。`
    : `当前范围内支出 ¥${expense.toFixed(2)}，收入 ¥${income.toFixed(2)}。`;
  return {
    parts: [
      { type: "text", text: summary },
      {
        type: "analysis-card",
        title: "账本分析",
        summary,
        metrics: [
          { label: "收入", value: `¥${income.toFixed(2)}` },
          { label: "支出", value: `¥${expense.toFixed(2)}` },
          { label: "结余", value: `¥${(income - expense).toFixed(2)}` },
          { label: "记录数", value: transactions.length },
          ...(largest ? [{ label: "最大支出", value: `¥${largest.amount.toFixed(2)}`, hint: largest.note ?? "无备注" }] : []),
        ],
      },
    ],
    result: { count: transactions.length, income, expense },
  };
}

async function createRecord(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const args = createRecordsArgsSchema.parse(rawArgs);
  const records = "records" in args ? args.records : [args];
  const transactions = [];
  for (const record of records) {
    const input = await transactionInput(runtime.repository, bookId, record, runtime.today);
    const parsed = createTransactionSchema.parse(input);
    const transaction =
      runtime.repository instanceof D1LedgerRepository
        ? await runtime.repository.createTransaction(bookId, runtime.user.id, parsed as any)
        : runtime.repository.createTransaction(bookId, runtime.user.id, parsed as any);
    transactions.push(transaction);
  }
  const first = transactions[0]!;
  return {
    parts: [
      {
        type: "text",
        text:
          transactions.length === 1
            ? `已保存${first.type === "income" ? "收入" : "支出"} ¥${first.amount.toFixed(2)}。`
            : `已创建 ${transactions.length} 笔记录。`,
      },
      recordCard(first, await categoryName(runtime.repository, bookId, first.categoryId)) as unknown as Record<string, unknown>,
    ],
    result: { transactionId: first.id, transactionIds: transactions.map((transaction) => transaction.id) },
    changed: ["transactions"],
  };
}

async function updateRecord(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const args = updateRecordArgsSchema.parse(rawArgs);
  const transaction = await resolveTransaction(runtime.repository, runtime.user.id, bookId, args);
  if (!transaction) return textResult("我没有找到要修改的那笔记录。");
  if (!canMutateTransaction(runtime.user.id, transaction.createdByUserId)) return textResult("只能修改你自己创建的记录。");
  const patch = await transactionInput(runtime.repository, bookId, { ...transaction, ...args } as any, runtime.today, transaction);
  const parsed = createTransactionSchema.parse(patch);
  const updated =
    runtime.repository instanceof D1LedgerRepository
      ? await runtime.repository.updateTransaction(transaction.id, parsed as any, runtime.user.id)
      : Object.assign(transaction, parsed);
  return {
    parts: [
      { type: "text", text: "已更新这笔记录。" },
      recordCard(updated as Transaction, await categoryName(runtime.repository, bookId, (updated as Transaction).categoryId)) as unknown as Record<string, unknown>,
    ],
    result: { transactionId: transaction.id },
    changed: ["transactions"],
  };
}

async function deleteRecord(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const args = targetRecordArgsSchema.parse(rawArgs);
  const transactions = await resolveTransactionsForDelete(runtime.repository, runtime.user.id, bookId, args);
  if (!transactions.length) return textResult("我没有找到要删除的记录。");
  const forbidden = transactions.find((transaction) => !canMutateTransaction(runtime.user.id, transaction.createdByUserId));
  if (forbidden) return textResult("只能删除你自己创建的记录。");
  if (runtime.repository instanceof D1LedgerRepository) {
    for (const transaction of transactions) await runtime.repository.deleteTransaction(transaction.id, runtime.user.id);
  } else {
    const ids = new Set(transactions.map((transaction) => transaction.id));
    runtime.repository.transactions = runtime.repository.transactions.filter((item) => !ids.has(item.id));
  }
  return {
    parts: [{ type: "text", text: transactions.length === 1 ? `已删除记录「${transactions[0]!.note ?? transactions[0]!.id}」。` : `已删除 ${transactions.length} 笔记录。` }],
    result: { transactionIds: transactions.map((transaction) => transaction.id) },
    changed: ["transactions"],
  };
}

async function createCategory(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const args = categoryArgsSchema.parse(rawArgs);
  const parsed = categorySchema.parse({
    name: args.name,
    type: args.type ?? "expense",
    icon: args.icon ?? (args.type === "income" ? "wallet" : "tag"),
    sortOrder: args.sortOrder ?? 0,
  });
  const existing = await findSimple(runtime.repository, "categories", bookId, parsed.name, parsed.type);
  const category = existing ?? (await createSimple(runtime.repository, "categories", bookId, parsed, runtime.user.id));
  return {
    parts: [{ type: "text", text: existing ? `分类「${category.name}」已经存在。` : `已创建分类「${category.name}」。` }],
    result: { category },
    changed: ["categories"],
  };
}

async function updateCategory(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const args = categoryArgsSchema.parse(rawArgs);
  const category = await resolveSimple(runtime.repository, "categories", bookId, args.id, args.name, args.type);
  if (!category) return textResult("我没有找到这个分类。");
  const parsed = categorySchema.parse({
    name: args.newName ?? args.name ?? category.name,
    type: args.type ?? (category.type === "income" ? "income" : "expense"),
    icon: args.icon ?? category.icon ?? "tag",
    sortOrder: args.sortOrder ?? category.sortOrder ?? 0,
  });
  const updated = await updateSimple(runtime.repository, "categories", category.id, parsed, runtime.user.id);
  return { parts: [{ type: "text", text: `已更新分类「${updated?.name ?? parsed.name}」。` }], result: { category: updated }, changed: ["categories"] };
}

async function deleteCategory(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const args = categoryArgsSchema.parse(rawArgs);
  const category = await resolveSimple(runtime.repository, "categories", bookId, args.id, args.name, args.type);
  if (!category) return textResult("我没有找到这个分类。");
  await deleteSimple(runtime.repository, "categories", category.id, runtime.user.id);
  return { parts: [{ type: "text", text: `已删除分类「${category.name}」，关联记录已保留。` }], result: { categoryId: category.id }, changed: ["categories", "transactions"] };
}

async function createTag(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const args = tagArgsSchema.parse(rawArgs);
  const parsed = tagSchema.parse({ name: args.name, color: args.color ?? "#ff6b1a" });
  const existing = await findSimple(runtime.repository, "tags", bookId, parsed.name);
  const tag = existing ?? (await createSimple(runtime.repository, "tags", bookId, parsed, runtime.user.id));
  return { parts: [{ type: "text", text: existing ? `标签「${tag.name}」已经存在。` : `已创建标签「${tag.name}」。` }], result: { tag }, changed: ["tags"] };
}

async function updateTag(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const args = tagArgsSchema.parse(rawArgs);
  const tag = await resolveSimple(runtime.repository, "tags", bookId, args.id, args.name);
  if (!tag) return textResult("我没有找到这个标签。");
  const parsed = tagSchema.parse({ name: args.newName ?? args.name ?? tag.name, color: args.color ?? tag.color ?? "#ff6b1a" });
  const updated = await updateSimple(runtime.repository, "tags", tag.id, parsed, runtime.user.id);
  return { parts: [{ type: "text", text: `已更新标签「${updated?.name ?? parsed.name}」。` }], result: { tag: updated }, changed: ["tags"] };
}

async function deleteTag(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const args = tagArgsSchema.parse(rawArgs);
  const tag = await resolveSimple(runtime.repository, "tags", bookId, args.id, args.name);
  if (!tag) return textResult("我没有找到这个标签。");
  await deleteSimple(runtime.repository, "tags", tag.id, runtime.user.id);
  return { parts: [{ type: "text", text: `已删除标签「${tag.name}」。` }], result: { tagId: tag.id }, changed: ["tags", "transactions"] };
}

async function createBook(runtime: AiToolRuntime, rawArgs: Record<string, unknown>) {
  const parsed = createBookSchema.parse({ ...rawArgs, currency: String(rawArgs.currency ?? "CNY") });
  const book =
    runtime.repository instanceof D1LedgerRepository
      ? await runtime.repository.createBook(runtime.user.id, parsed.name, parsed.currency)
      : runtime.repository.createBook(runtime.user, parsed.name, parsed.currency);
  return {
    parts: [
      { type: "text", text: `已创建账本「${book.name}」。` },
      { type: "navigation-card", pageName: "打开账本", href: `/home?bookId=${book.id}` },
    ],
    result: { book },
    changed: ["book"],
  };
}

async function updateBook(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const input = z.object({ id: z.string().optional(), name: z.string().min(1).max(60).optional(), currency: z.string().length(3).optional() }).parse(rawArgs);
  const targetBookId = input.id ?? bookId;
  if (!(await canManageBook(runtime.repository, targetBookId, runtime.user.id))) return textResult("你需要是账本创建者或管理员才能修改账本。");
  const book =
    runtime.repository instanceof D1LedgerRepository
      ? await runtime.repository.updateBook(targetBookId, input, runtime.user.id)
      : updateMemoryBook(runtime.repository, targetBookId, input);
  return { parts: [{ type: "text", text: `已更新账本「${book?.name ?? targetBookId}」。` }], result: { book }, changed: ["book"] };
}

async function deleteBook(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const targetBookId = String(rawArgs.id ?? bookId);
  const userRole = await bookRoleFor(runtime.repository, targetBookId, runtime.user.id);
  if (!canDeleteBook(userRole ?? "member")) return textResult("只有账本创建者可以删除账本。");
  if (runtime.repository instanceof D1LedgerRepository) await runtime.repository.deleteBook(targetBookId, runtime.user.id);
  else runtime.repository.books = runtime.repository.books.filter((book) => book.id !== targetBookId);
  return { parts: [{ type: "text", text: "账本已删除。" }], result: { bookId: targetBookId }, changed: ["book"] };
}

async function updateProfile(runtime: AiToolRuntime, rawArgs: Record<string, unknown>) {
  const parsed = updateProfileSchema.partial().extend({ avatarFromAttachment: z.boolean().optional() }).parse(rawArgs);
  let user = runtime.user;
  if (parsed.avatarFromAttachment) {
    const avatar = runtime.attachments.find((file) => file.type.startsWith("image/"));
    if (!avatar) return textResult("请先上传一张图片，我才能把它设置为头像。");
    if (avatar.size > 1024 * 1024) return textResult("头像不能超过 1MB。");
    if (!["image/jpeg", "image/png", "image/webp"].includes(avatar.type)) return textResult("头像仅支持 JPG、PNG 或 WebP。");
    const avatarUrl = await dataUrlFromFile(avatar);
    if (runtime.env.DB) await updateUserAvatar(runtime.env.DB, runtime.user.id, avatarUrl);
    else {
      const stored = runtime.repository instanceof D1LedgerRepository ? undefined : runtime.repository.users.find((item) => item.id === runtime.user.id);
      if (stored) stored.avatarUrl = avatarUrl;
    }
    user = { ...user, avatarUrl };
  }
  if (parsed.name || parsed.email !== undefined) {
    const profile = { name: parsed.name ?? user.name, email: parsed.email ?? user.email };
    if (runtime.env.DB) user = await updateUserProfile(runtime.env.DB, runtime.user.id, profile);
    else if (!(runtime.repository instanceof D1LedgerRepository)) {
      const stored = runtime.repository.users.find((item) => item.id === runtime.user.id);
      if (stored) Object.assign(stored, profile);
      user = { ...user, ...profile };
    }
  }
  return {
    parts: [
      { type: "text", text: "资料已更新。" },
      { type: "profile-card", title: "当前资料", name: user.name, email: user.email, avatarUrl: user.avatarUrl },
    ],
    result: { user },
    changed: ["profile"],
  };
}

async function updateMember(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const args = memberArgsSchema.parse(rawArgs);
  if (!args.role) return textResult("请告诉我要把成员设置为管理员还是普通成员。");
  if (!(await canManageBook(runtime.repository, bookId, runtime.user.id))) return textResult("你需要是账本创建者或管理员才能修改成员。");
  const member = await resolveMember(runtime.repository, bookId, args);
  if (!member || member.role === "creator") return textResult("成员不存在或不能修改创建者。");
  const updated =
    runtime.repository instanceof D1LedgerRepository
      ? await runtime.repository.updateMemberRole(bookId, member.id, args.role, runtime.user.id)
      : Object.assign(member, { role: args.role });
  return { parts: [{ type: "member-card", title: "成员权限已更新", name: updated?.name, role: updated?.role }], result: { member: updated }, changed: ["members"] };
}

async function removeMember(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const args = memberArgsSchema.parse(rawArgs);
  const self = args.self || args.userId === runtime.user.id;
  if (!self && !(await canManageBook(runtime.repository, bookId, runtime.user.id))) return textResult("你需要是账本创建者或管理员才能移除成员。");
  const member = self ? await memberByUser(runtime.repository, bookId, runtime.user.id) : await resolveMember(runtime.repository, bookId, args);
  if (!member || member.role === "creator") return textResult(self ? "创建者不能退出账本。" : "成员不存在或不能移除创建者。");
  if (runtime.repository instanceof D1LedgerRepository) {
    if (self) await runtime.repository.removeMemberByUser(bookId, runtime.user.id);
    else await runtime.repository.removeMember(bookId, member.id, runtime.user.id);
  } else runtime.repository.members = runtime.repository.members.filter((item) => item.id !== member.id);
  return { parts: [{ type: "text", text: self ? "已退出账本。" : `已移除成员「${member.name}」。` }], result: { memberId: member.id }, changed: ["members"] };
}

async function inviteMember(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  const args = z
    .object({
      target: z.string().optional(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      userId: z.string().optional(),
      role: z.enum(["admin", "member"]).default("member"),
    })
    .parse(rawArgs);
  const userRole = await bookRoleFor(runtime.repository, bookId, runtime.user.id);
  if (!canInvite(userRole ?? "member")) return textResult("你需要是账本创建者或管理员才能邀请成员。");
  if (!args.email && !args.phone && !args.userId && !args.target) return textResult("请提供要邀请的邮箱、手机号、用户名或用户 ID。");
  const invitation =
    runtime.repository instanceof D1LedgerRepository
      ? await runtime.repository.createInvitation({
          bookId,
          inviterUserId: runtime.user.id,
          inviteeEmail: args.email ?? (args.target?.includes("@") ? args.target : undefined),
          inviteePhone: args.phone,
          inviteeUserId: args.userId,
          role: args.role,
        })
      : createMemoryInvitation(runtime.repository, bookId, runtime.user.id, args);
  return {
    parts: [
      { type: "text", text: "邀请已创建。" },
      { type: "member-card", title: "成员邀请", name: args.target ?? args.email ?? args.phone ?? args.userId, role: args.role, status: invitation.status },
    ],
    result: { invitation },
    changed: ["members"],
  };
}

async function saveAttachments(runtime: AiToolRuntime, bookId: string, rawArgs: Record<string, unknown>) {
  if (!runtime.attachments.length) return textResult("请先上传文件。");
  if (!(runtime.repository instanceof D1LedgerRepository) || !runtime.env.FILES) return textResult("导入功能需要 D1 与 R2 绑定。");
  const args = z.object({ autoConfirm: z.boolean().default(false) }).parse(rawArgs);
  const jobs = [];
  for (const file of runtime.attachments.slice(0, 5)) {
    jobs.push(await createImportJobFromFile(runtime, bookId, file, args.autoConfirm));
  }
  return {
    parts: [
      { type: "text", text: `已提交 ${jobs.length} 个文件，正在处理。` },
      { type: "import-job-card", title: "文件任务", message: "可以在待确认/文件任务中查看进度。", jobs: jobs as any, pageName: "文件任务", href: "/records/imports" } as any,
    ],
    result: { jobs },
    changed: ["imports"],
  };
}

async function transactionInput(
  repository: AiToolRepository,
  bookId: string,
  args: z.infer<typeof recordArgsSchema> | (Partial<z.infer<typeof recordArgsSchema>> & Transaction),
  today: string,
  current?: Transaction,
) {
  const type = args.type ?? current?.type ?? "expense";
  const category =
    args.categoryId || !args.categoryName ? undefined : await findSimple(repository, "categories", bookId, args.categoryName, type);
  const tagIds = [
    ...(args.tagIds ?? current?.tagIds ?? []),
    ...(
      await Promise.all((args.tagNames ?? []).map((name) => findSimple(repository, "tags", bookId, name)))
    )
      .filter((tag): tag is SimpleEntity => Boolean(tag))
      .map((tag) => tag.id),
  ];
  const items = await Promise.all(
    (args.items ?? current?.items ?? []).map(async (item) => {
      const itemCategory =
        item.categoryId || !item.categoryName ? undefined : await findSimple(repository, "categories", bookId, item.categoryName, type);
      return { ...item, categoryId: item.categoryId ?? itemCategory?.id };
    }),
  );
  return {
    type,
    amount: args.amount ?? current?.amount,
    categoryId: args.categoryId ?? category?.id ?? current?.categoryId,
    memberId: current?.memberId,
    note: args.note ?? current?.note,
    occurredAt: normalizeOccurredAt(args.occurredAt ?? current?.occurredAt, today),
    tagIds: Array.from(new Set(tagIds)),
    items,
  };
}

async function searchTransactions(repository: AiToolRepository, bookId: string, args: z.infer<typeof searchArgsSchema>) {
  if (repository instanceof D1LedgerRepository) return repository.searchTransactions(bookId, args);
  return repository.transactions
    .filter((transaction) => transaction.bookId === bookId)
    .filter((transaction) => !args.type || transaction.type === args.type)
    .filter((transaction) => args.minAmount === undefined || transaction.amount > args.minAmount)
    .filter((transaction) => args.maxAmount === undefined || transaction.amount < args.maxAmount)
    .filter((transaction) => !args.from || transaction.occurredAt >= args.from)
    .filter((transaction) => !args.to || transaction.occurredAt <= args.to)
    .filter((transaction) => !args.categoryId || transaction.categoryId === args.categoryId)
    .filter((transaction) => !args.categoryName || repository.categories.some((category) => category.id === transaction.categoryId && category.name === args.categoryName))
    .filter((transaction) => !args.q || [transaction.note, ...transaction.items.map((item) => item.name)].filter(Boolean).join(" ").includes(args.q!))
    .sort((left, right) => sortTransactions(left, right, args.sort));
}

async function resolveTransaction(
  repository: AiToolRepository,
  userId: string,
  bookId: string,
  args: { transactionId?: string; relative?: string; amount?: number; note?: string },
) {
  if (args.transactionId) {
    const transaction =
      repository instanceof D1LedgerRepository
        ? await repository.getTransaction(args.transactionId)
        : repository.transactions.find((item) => item.id === args.transactionId);
    return transaction?.bookId === bookId ? transaction : undefined;
  }
  const transactions = repository instanceof D1LedgerRepository ? await repository.listTransactions(bookId) : repository.transactions.filter((item) => item.bookId === bookId);
  const own = transactions.filter((item) => item.createdByUserId === userId);
  if (args.relative) return own[0];
  return own.find((item) => (args.amount === undefined || Math.abs(item.amount - args.amount) < 0.001) && (!args.note || item.note?.includes(args.note)));
}

async function resolveTransactionsForDelete(
  repository: AiToolRepository,
  userId: string,
  bookId: string,
  args: z.infer<typeof targetRecordArgsSchema>,
) {
  const all = repository instanceof D1LedgerRepository ? await repository.listTransactions(bookId) : repository.transactions.filter((item) => item.bookId === bookId);
  if (args.transactionIds.length || args.transactionId) {
    const ids = new Set([args.transactionId, ...args.transactionIds].filter((value): value is string => Boolean(value)));
    return all.filter((transaction) => ids.has(transaction.id));
  }
  if (args.q || args.note) {
    const query = (args.q ?? args.note ?? "").toLowerCase();
    return all
      .filter((transaction) => transaction.createdByUserId === userId)
      .filter((transaction) =>
        [transaction.note, ...transaction.items.map((item) => `${item.name} ${item.note ?? ""}`)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query),
      );
  }
  const transaction = await resolveTransaction(repository, userId, bookId, args);
  return transaction ? [transaction] : [];
}

async function resolveBookId(repository: AiToolRepository, userId: string, bookId?: string) {
  if (bookId) return bookId;
  if (repository instanceof D1LedgerRepository) return (await repository.listBooks(userId))[0]?.id;
  return repository.books.find((book) => repository.role(book.id, userId))?.id;
}

async function bookRoleFor(repository: AiToolRepository, bookId: string, userId: string): Promise<Role | undefined> {
  return repository instanceof D1LedgerRepository ? await repository.role(bookId, userId) : repository.role(bookId, userId);
}

async function canManageBook(repository: AiToolRepository, bookId: string, userId: string) {
  return canManageMembers((await bookRoleFor(repository, bookId, userId)) ?? "member");
}

async function categoryName(repository: AiToolRepository, bookId: string, categoryId?: string) {
  if (!categoryId) return undefined;
  const category = repository instanceof D1LedgerRepository ? await repository.getSimple("categories", categoryId) : repository.categories.find((item) => item.id === categoryId && item.bookId === bookId);
  return category?.name;
}

async function findSimple(repository: AiToolRepository, kind: "categories" | "tags", bookId: string, name?: string, type?: string) {
  if (!name) return undefined;
  const values = repository instanceof D1LedgerRepository ? await repository.listSimple(kind, bookId) : repository[kind].filter((item) => item.bookId === bookId);
  return values.find((item) => item.name === name && (!type || !item.type || item.type === type));
}

async function resolveSimple(repository: AiToolRepository, kind: "categories" | "tags", bookId: string, idValue?: string, name?: string, type?: string) {
  if (idValue) {
    const entity = repository instanceof D1LedgerRepository ? await repository.getSimple(kind, idValue) : repository[kind].find((item) => item.id === idValue);
    return entity?.bookId === bookId ? entity : undefined;
  }
  return findSimple(repository, kind, bookId, name, type);
}

async function createSimple(repository: AiToolRepository, kind: "categories" | "tags", bookId: string, data: Omit<SimpleEntity, "id" | "bookId">, actorId: string) {
  return repository instanceof D1LedgerRepository ? repository.createSimple(kind, bookId, data, actorId) : repository.createSimple(kind, bookId, data);
}

async function updateSimple(repository: AiToolRepository, kind: "categories" | "tags", entityId: string, data: Omit<SimpleEntity, "id" | "bookId">, actorId: string) {
  if (repository instanceof D1LedgerRepository) return repository.updateSimple(kind, entityId, data, actorId);
  const entity = repository[kind].find((item) => item.id === entityId);
  return entity ? Object.assign(entity, data) : undefined;
}

async function deleteSimple(repository: AiToolRepository, kind: "categories" | "tags", entityId: string, actorId: string) {
  if (repository instanceof D1LedgerRepository) return repository.deleteSimple(kind, entityId, actorId);
  if (kind === "categories") {
    repository.transactions.forEach((transaction) => {
      if (transaction.categoryId === entityId) delete transaction.categoryId;
      transaction.items.forEach((item) => {
        if (item.categoryId === entityId) delete item.categoryId;
      });
    });
  } else {
    repository.transactions.forEach((transaction) => {
      transaction.tagIds = transaction.tagIds.filter((tagId) => tagId !== entityId);
    });
  }
  repository[kind] = repository[kind].filter((item) => item.id !== entityId) as never;
}

async function memberByUser(repository: AiToolRepository, bookId: string, userId: string) {
  if (repository instanceof D1LedgerRepository) {
    const members = await repository.listMembers(bookId);
    return members.find((member) => member.userId === userId);
  }
  return repository.members.find((member) => member.bookId === bookId && member.userId === userId);
}

async function resolveMember(repository: AiToolRepository, bookId: string, args: z.infer<typeof memberArgsSchema>) {
  const members = repository instanceof D1LedgerRepository ? await repository.listMembers(bookId) : repository.members.filter((member) => member.bookId === bookId);
  return members.find((member) => member.id === args.memberId || member.userId === args.userId || member.name === args.name);
}

function updateMemoryBook(store: MemoryLedgerStore, bookId: string, input: { name?: string; currency?: string }) {
  const book = store.books.find((item) => item.id === bookId);
  if (!book) return undefined;
  Object.assign(book, { name: input.name ?? book.name, currency: input.currency ?? book.currency, updatedAt: now() });
  return book;
}

function createMemoryInvitation(
  store: MemoryLedgerStore,
  bookId: string,
  inviterUserId: string,
  args: { target?: string; email?: string; phone?: string; userId?: string; role: "admin" | "member" },
) {
  const invitation = {
    id: id("invitation"),
    bookId,
    inviterUserId,
    inviteeEmail: args.email ?? (args.target?.includes("@") ? args.target : undefined),
    inviteePhone: args.phone,
    inviteeUserId: args.userId,
    role: args.role,
    status: "pending" as const,
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  };
  store.invitations.push(invitation);
  return invitation;
}

async function createImportJobFromFile(runtime: AiToolRuntime, bookId: string, file: File, autoConfirm: boolean) {
  if (!(runtime.repository instanceof D1LedgerRepository)) throw new Error("导入功能需要 D1 运行时");
  if (!runtime.env.FILES) throw new Error("导入功能需要 R2 绑定");
  const resolvedFileType = fileType(file);
  if (!isSupportedFile(resolvedFileType) && !hasSupportedExtension(file.name)) throw new Error(`${file.name} 不是支持的文件格式`);
  const needsOcr = isOcrImportFileType(resolvedFileType);
  if (!needsOcr && !runtime.env.IMPORT_QUEUE) throw new Error("CSV/Excel 导入功能需要 Queue 绑定");
  const suffix = file.name.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  const job = await runtime.repository.createImportJob({
    bookId,
    userId: runtime.user.id,
    fileName: file.name,
    fileType: resolvedFileType,
    r2Key: `imports/${bookId}/${crypto.randomUUID()}-${suffix}`,
    autoConfirm,
  });
  try {
    const bytes = await file.arrayBuffer();
    await runtime.env.FILES.put(job.r2Key, bytes, {
      httpMetadata: { contentType: resolvedFileType },
      customMetadata: { importJobId: job.id, bookId, uploadedBy: runtime.user.id },
    });
    if (needsOcr) {
      if (isImageImportFileType(resolvedFileType)) {
        return await submitAlephPipelineJob(runtime.env, runtime.repository, job, bytes, runtime.origin);
      }
      return await submitAlephOcrJob(runtime.env, runtime.repository, job, bytes, runtime.origin);
    }
    await runtime.env.IMPORT_QUEUE?.send({ jobId: job.id } satisfies ImportQueueMessage);
    return (await runtime.repository.getImportJob(job.id)) ?? job;
  } catch (error) {
    if (needsOcr) {
      await markFailed(
        runtime.repository,
        job.id,
        error,
        isImageImportFileType(resolvedFileType) ? "pipeline" : "ocr",
      );
    }
    else {
      await runtime.env.FILES.delete(job.r2Key);
      await runtime.repository.updateImportJob(job.id, "failed", error instanceof Error ? error.message : "上传失败");
    }
    throw error;
  }
}

function fileType(file: File) {
  if (isSupportedFile(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".heif")) return "image/heif";
  if (name.endsWith(".tif") || name.endsWith(".tiff")) return "image/tiff";
  if (name.endsWith(".bmp")) return "image/bmp";
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".csv")) return "text/csv";
  if (name.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (name.endsWith(".xls")) return "application/vnd.ms-excel";
  return file.type;
}

function isSupportedFile(type: string): type is (typeof supportedFileTypes)[number] {
  return (supportedFileTypes as readonly string[]).includes(type);
}

function hasSupportedExtension(name: string) {
  return supportedFileExtensions.some((extension) => name.toLowerCase().endsWith(extension));
}

function normalizeOccurredAt(value: string | undefined, today: string) {
  if (!value) return `${today}T12:00:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T12:00:00.000Z`;
  return value.includes("T") ? value : `${value}T12:00:00.000Z`;
}

function sortTransactions(left: Transaction, right: Transaction, sort: z.infer<typeof searchArgsSchema>["sort"]) {
  if (sort === "date_asc") return left.occurredAt.localeCompare(right.occurredAt);
  if (sort === "amount_desc") return right.amount - left.amount;
  if (sort === "amount_asc") return left.amount - right.amount;
  return right.occurredAt.localeCompare(left.occurredAt);
}

function transactionResult(transaction: Transaction) {
  return {
    id: transaction.id,
    title: transaction.note || (transaction.type === "income" ? "收入" : "支出"),
    description: `${transaction.type === "income" ? "收入" : "支出"} · ${transaction.occurredAt.slice(0, 10)}`,
    amount: transaction.type === "income" ? transaction.amount : -transaction.amount,
    pageName: "交易详情",
    href: `/records/${transaction.id}`,
  };
}

function recordCard(transaction: Transaction, category?: string): AiChatPart {
  return {
    type: "record-card",
    title: transaction.type === "income" ? "收入记录" : "支出记录",
    transactionId: transaction.id,
    transactionType: transaction.type,
    amount: transaction.amount,
    categoryName: category,
    note: transaction.note,
    occurredAt: transaction.occurredAt,
    pageName: "交易详情",
    href: `/records/${transaction.id}`,
  };
}

function textResult(text: string): ToolExecutionResult {
  return { parts: [{ type: "text", text }] };
}

function confirmationSummary(toolName: AiActionName, args: Record<string, unknown>) {
  const readable = typeof args.name === "string" ? `「${args.name}」` : "";
  const labels: Partial<Record<AiActionName, string>> = {
    "delete-record": "删除这笔记录？",
    "delete-category": `删除分类${readable}？`,
    "delete-tag": `删除标签${readable}？`,
    "delete-book": "删除这个账本？",
    "remove-member": "移除这个成员？",
    "invite-member": "发送成员邀请？",
    "export-book": "导出当前账本？",
  };
  return labels[toolName] ?? "执行这个操作？";
}

function confirmationPart(confirmation: { id: string; action: string; status: "pending" | "confirmed" | "cancelled"; expiresAt: string }, toolName: AiActionName): AiChatPart {
  return {
    type: "confirmation-card",
    confirmation: {
      id: confirmation.id,
      action: toolName,
      status: confirmation.status,
      expiresAt: confirmation.expiresAt,
      summary: confirmationSummary(toolName, {}),
      confirmLabel: "确认",
      cancelLabel: "取消",
    },
  };
}

async function createConfirmation(
  repository: AiToolRepository,
  input: { userId: string; bookId?: string; action: AiActionName; payload: Record<string, unknown> },
) {
  if (repository instanceof D1LedgerRepository) return repository.createAiConfirmation(input);
  const timestamp = now();
  const confirmation = {
    id: id("ai_confirmation"),
    userId: input.userId,
    bookId: input.bookId,
    action: input.action,
    status: "pending" as const,
    payload: input.payload,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  repository.aiConfirmations.push(confirmation);
  return confirmation;
}

async function getConfirmation(repository: AiToolRepository, userId: string, confirmationId: string) {
  if (repository instanceof D1LedgerRepository) return repository.getAiConfirmation(userId, confirmationId);
  return repository.aiConfirmations.find((confirmation) => confirmation.id === confirmationId && confirmation.userId === userId) ?? null;
}

async function updateConfirmation(
  repository: AiToolRepository,
  confirmation: Awaited<ReturnType<typeof getConfirmation>> extends infer T ? NonNullable<T> : never,
  fields: { status: "pending" | "confirmed" | "cancelled"; result?: Record<string, unknown>; confirmedAt?: string; cancelledAt?: string },
) {
  if (repository instanceof D1LedgerRepository) {
    await repository.updateAiConfirmation(confirmation.id, fields, confirmation.userId);
    return (await repository.getAiConfirmation(confirmation.userId, confirmation.id)) ?? { ...confirmation, ...fields };
  }
  Object.assign(confirmation, { ...fields, updatedAt: now() });
  return confirmation;
}

async function dataUrlFromFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return `data:${file.type};base64,${btoa(binary)}`;
}
