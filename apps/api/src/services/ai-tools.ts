import {
  getLedgerTool,
  listLedgerSkills,
  type LedgerSkillName,
  type LedgerToolStep,
} from "@shared-ledger/ledger-skills";
import {
  canDeleteBook,
  canInvite,
  canManageMembers,
  canMutateTransaction,
  categorySchema,
  createBookSchema,
  createTransactionSchema,
  updateProfileSchema,
  type AiActionName,
  type AiChatPart,
  type Role,
} from "@shared-ledger/shared";
import { z } from "zod";
import { D1LedgerRepository } from "../repository";
import type { MemoryLedgerStore, SimpleEntity } from "../store";
import type { LedgerUser, Transaction } from "../types";
import type { Env } from "../types";
import { updateUserAvatar, updateUserProfile } from "./auth";
import {
  markFailed,
  submitAlephOcrJob,
} from "./imports";
import { assertImageImportFile, assertImageOcrQuota, imageImportFileType, maximumImageImportBatchFiles } from "./import-validation";

export type AiToolRepository = D1LedgerRepository | MemoryLedgerStore;

type AiToolDefinition = {
  name: AiActionName;
  skillName: LedgerSkillName;
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

const runtimeToolDefinitions: AiToolDefinition[] = listLedgerSkills().flatMap((skill) =>
  skill.tools.map((toolDefinition) => ({
    name: toolDefinition.name,
    skillName: skill.name,
    description: toolDefinition.description,
    confirmation: toolDefinition.confirmation,
    argsSchemaDescription: toolDefinition.inputSchemaDescription,
  })),
);

const searchArgsSchema = z.object({
  type: z.enum(["income", "expense"]).optional(),
  minAmount: z.coerce.number().positive().optional(),
  minStrict: z.boolean().default(false),
  maxAmount: z.coerce.number().positive().optional(),
  maxStrict: z.boolean().default(false),
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

const memberArgsSchema = z.object({
  memberId: z.string().trim().min(1).optional(),
  userId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  role: z.enum(["admin", "member"]).optional(),
  self: z.boolean().optional(),
});

export async function executeAiTool(
  runtime: AiToolRuntime,
  plan: LedgerToolStep,
  options: { confirmed?: boolean; toolCallId?: string } = {},
): Promise<ToolExecutionResult> {
  const registryTool = getLedgerTool(plan.toolName, plan.skillName);
  const definition = runtimeToolDefinitions.find((tool) => tool.name === plan.toolName && tool.skillName === plan.skillName);
  if (!registryTool) return textResult(`暂不支持 Skill 工具：${plan.skillName}.${plan.toolName}`);
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
            skillName: definition.skillName,
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
        payload: { skillName: definition.skillName, toolName: definition.name, args: plan.args, sessionId: runtime.sessionId, toolCallId: toolCall?.id },
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
  const payload = confirmation.payload as { skillName?: LedgerSkillName; toolName?: AiActionName; args?: Record<string, unknown>; sessionId?: string; toolCallId?: string };
  if (!payload.toolName) return { status: 400, body: { error: "确认项缺少工具信息" } };
  const skillName = payload.skillName ?? (getLedgerTool(payload.toolName)?.skillName as LedgerSkillName | undefined);
  if (!skillName) return { status: 400, body: { error: "确认项缺少 Skill 信息" } };
  const result = await executeAiTool(
    { ...runtime, sessionId: payload.sessionId ?? runtime.sessionId, bookId: confirmation.bookId ?? runtime.bookId },
    {
      skillName,
      toolName: payload.toolName,
      args: payload.args ?? {},
      requiresConfirmation: false,
      confidence: 1,
      isFinal: true,
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
      return textResult("任务操作已收到；请在图片识别任务卡片中继续查看状态。");
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
      {
        type: "filter-result",
        filters: args,
        chips: chipsFromSearchArgs(args),
        href: `/records?bookId=${bookId}`,
      } as any,
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
    const input = await transactionInput(runtime.repository, runtime.user.id, record, runtime.today);
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
      recordCard(first, await categoryName(runtime.repository, first.categoryId)) as unknown as Record<string, unknown>,
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
  const patch = await transactionInput(runtime.repository, runtime.user.id, { ...transaction, ...args } as any, runtime.today, transaction);
  const parsed = createTransactionSchema.parse(patch);
  const updated =
    runtime.repository instanceof D1LedgerRepository
      ? await runtime.repository.updateTransaction(transaction.id, parsed as any, runtime.user.id)
      : Object.assign(transaction, parsed);
  return {
    parts: [
      { type: "text", text: "已更新这笔记录。" },
      recordCard(updated as Transaction, await categoryName(runtime.repository, (updated as Transaction).categoryId)) as unknown as Record<string, unknown>,
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

async function createCategory(runtime: AiToolRuntime, _bookId: string, rawArgs: Record<string, unknown>) {
  const args = categoryArgsSchema.parse(rawArgs);
  const parsed = categorySchema.parse({
    name: args.name,
    type: args.type ?? "expense",
    icon: args.icon ?? (args.type === "income" ? "wallet" : "tag"),
    sortOrder: args.sortOrder ?? 0,
  });
  const existing = await findCategory(runtime.repository, runtime.user.id, parsed.name, parsed.type);
  const category = existing ?? (await createCategoryEntity(runtime.repository, runtime.user.id, parsed, runtime.user.id));
  return {
    parts: [{ type: "text", text: existing ? `分类「${category.name}」已经存在。` : `已创建分类「${category.name}」。` }],
    result: { category },
    changed: ["categories"],
  };
}

async function updateCategory(runtime: AiToolRuntime, _bookId: string, rawArgs: Record<string, unknown>) {
  const args = categoryArgsSchema.parse(rawArgs);
  const category = await resolveCategory(runtime.repository, runtime.user.id, args.id, args.name, args.type);
  if (!category) return textResult("我没有找到这个分类。");
  const parsed = categorySchema.parse({
    name: args.newName ?? args.name ?? category.name,
    type: args.type ?? (category.type === "income" ? "income" : "expense"),
    icon: args.icon ?? category.icon ?? "tag",
    sortOrder: args.sortOrder ?? category.sortOrder ?? 0,
  });
  const updated = await updateCategoryEntity(runtime.repository, category.id, parsed, runtime.user.id);
  return { parts: [{ type: "text", text: `已更新分类「${updated?.name ?? parsed.name}」。` }], result: { category: updated }, changed: ["categories"] };
}

async function deleteCategory(runtime: AiToolRuntime, _bookId: string, rawArgs: Record<string, unknown>) {
  const args = categoryArgsSchema.parse(rawArgs);
  const category = await resolveCategory(runtime.repository, runtime.user.id, args.id, args.name, args.type);
  if (!category) return textResult("我没有找到这个分类。");
  await deleteCategoryEntity(runtime.repository, category.id, runtime.user.id);
  return { parts: [{ type: "text", text: `已删除分类「${category.name}」，关联记录已保留。` }], result: { categoryId: category.id }, changed: ["categories", "transactions"] };
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
  if (!runtime.attachments.length) return textResult("请先上传图片。");
  if (!(runtime.repository instanceof D1LedgerRepository) || !runtime.env.FILES) return textResult("导入功能需要 D1 与 R2 绑定。");
  const args = z.object({ autoConfirm: z.boolean().default(false) }).parse(rawArgs);
  if (runtime.attachments.length > maximumImageImportBatchFiles) {
    return textResult(`一次最多上传 ${maximumImageImportBatchFiles} 张图片。`);
  }
  const files = runtime.attachments;
  for (const file of files) assertImageImportFile(file);
  await assertImageOcrQuota(runtime.repository, runtime.user.id, files.length);
  const jobs = [];
  for (const file of files) {
    jobs.push(await createImportJobFromFile(runtime, bookId, file, args.autoConfirm, { skipQuotaCheck: true }));
  }
  return {
    parts: [
      { type: "text", text: `已提交 ${jobs.length} 个文件，正在处理。` },
      { type: "import-job-card", title: "图片识别", message: "可以在待确认/图片识别任务中查看进度。", jobs: jobs as any, pageName: "图片识别", href: "/records/imports" } as any,
    ],
    result: { jobs },
    changed: ["imports"],
  };
}

async function transactionInput(
  repository: AiToolRepository,
  userId: string,
  args: z.infer<typeof recordArgsSchema> | (Partial<z.infer<typeof recordArgsSchema>> & Transaction),
  today: string,
  current?: Transaction,
) {
  const type = args.type ?? current?.type ?? "expense";
  const category =
    args.categoryId || !args.categoryName ? undefined : await findCategory(repository, userId, args.categoryName, type);
  const items = await Promise.all(
    (args.items ?? current?.items ?? []).map(async (item) => {
      const itemCategory =
        item.categoryId || !item.categoryName ? undefined : await findCategory(repository, userId, item.categoryName, type);
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
    items,
  };
}

async function searchTransactions(repository: AiToolRepository, bookId: string, args: z.infer<typeof searchArgsSchema>) {
  if (repository instanceof D1LedgerRepository) return repository.searchTransactions(bookId, args);
  return repository.transactions
    .filter((transaction) => transaction.bookId === bookId)
    .filter((transaction) => !args.type || transaction.type === args.type)
    .filter((transaction) => args.minAmount === undefined || (args.minStrict ? transaction.amount > args.minAmount : transaction.amount >= args.minAmount))
    .filter((transaction) => args.maxAmount === undefined || (args.maxStrict ? transaction.amount < args.maxAmount : transaction.amount <= args.maxAmount))
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

async function categoryName(repository: AiToolRepository, categoryId?: string) {
  if (!categoryId) return undefined;
  const category = repository instanceof D1LedgerRepository ? await repository.getCategory(categoryId) : repository.categories.find((item) => item.id === categoryId);
  return category?.name;
}

async function findCategory(repository: AiToolRepository, userId: string, name?: string, type?: string) {
  if (!name) return undefined;
  const values = repository instanceof D1LedgerRepository ? await repository.listCategories(userId) : repository.categories.filter((item) => item.userId === userId);
  return values.find((item) => item.name === name && (!type || !item.type || item.type === type));
}

async function resolveCategory(repository: AiToolRepository, userId: string, idValue?: string, name?: string, type?: string) {
  if (idValue) {
    const entity = repository instanceof D1LedgerRepository ? await repository.getCategory(idValue) : repository.categories.find((item) => item.id === idValue);
    return entity?.userId === userId ? entity : undefined;
  }
  return findCategory(repository, userId, name, type);
}

async function createCategoryEntity(repository: AiToolRepository, userId: string, data: Omit<SimpleEntity, "id" | "userId">, actorId: string) {
  return repository instanceof D1LedgerRepository ? repository.createCategory(userId, data, actorId) : repository.createCategory(userId, data);
}

async function updateCategoryEntity(repository: AiToolRepository, entityId: string, data: Omit<SimpleEntity, "id" | "userId">, actorId: string) {
  if (repository instanceof D1LedgerRepository) return repository.updateCategory(entityId, data, actorId);
  const entity = repository.categories.find((item) => item.id === entityId);
  return entity ? Object.assign(entity, data) : undefined;
}

async function deleteCategoryEntity(repository: AiToolRepository, entityId: string, actorId: string) {
  if (repository instanceof D1LedgerRepository) return repository.deleteCategory(entityId, actorId);
  repository.transactions.forEach((transaction) => {
    if (transaction.categoryId === entityId) delete transaction.categoryId;
    transaction.items.forEach((item) => {
      if (item.categoryId === entityId) delete item.categoryId;
    });
  });
  repository.categories = repository.categories.filter((item) => item.id !== entityId);
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

async function createImportJobFromFile(
  runtime: AiToolRuntime,
  bookId: string,
  file: File,
  autoConfirm: boolean,
  options: { skipQuotaCheck?: boolean } = {},
) {
  if (!(runtime.repository instanceof D1LedgerRepository)) throw new Error("导入功能需要 D1 运行时");
  if (!runtime.env.FILES) throw new Error("导入功能需要 R2 绑定");
  assertImageImportFile(file);
  const resolvedFileType = imageImportFileType(file);
  if (!options.skipQuotaCheck) await assertImageOcrQuota(runtime.repository, runtime.user.id);
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
    return await submitAlephOcrJob(runtime.env, runtime.repository, job, bytes, runtime.origin);
  } catch (error) {
    await markFailed(runtime.repository, job.id, error, "ocr");
    throw error;
  }
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

function chipsFromSearchArgs(args: z.infer<typeof searchArgsSchema>) {
  return [
    args.type === "income" ? "收入" : args.type === "expense" ? "支出" : "",
    args.from || args.to ? [args.from, args.to].filter(Boolean).join(" 至 ") : "",
    args.minAmount ? `金额 ${args.minStrict ? ">" : ">="} ${args.minAmount}` : "",
    args.maxAmount ? `金额 ${args.maxStrict ? "<" : "<="} ${args.maxAmount}` : "",
    args.categoryName ? `分类：${args.categoryName}` : "",
    args.q ? `关键词：${args.q}` : "",
    args.sort === "amount_desc" ? "金额最高" : "",
  ].filter(Boolean);
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
