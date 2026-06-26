import {
  createTransactionSchema,
  type AiChatPart,
  type AiNavigationCardPart,
  type AiRecordCardPart,
  type AiToolStatusPart,
} from "@shared-ledger/shared";
import { z } from "zod";
import { D1LedgerRepository } from "../repository";
import type { AiActionAuditLog, MemoryLedgerStore } from "../store";
import type { LedgerUser, Transaction } from "../types";
import { normalizeTransactionCandidate as normalizeSharedTransactionCandidate } from "./ai-normalizer";

export type AiIngestionRepository = D1LedgerRepository | MemoryLedgerStore;

export type AiTransactionIngestionContext = {
  user: LedgerUser;
  repository: AiIngestionRepository;
  bookId: string;
  text?: string;
  candidate?: Record<string, unknown>;
  conversationId?: string;
  idempotencyKey?: string;
  today?: string;
  timeZone?: string;
};

type NormalizedCandidate = {
  type: "income" | "expense";
  amount?: number;
  categoryId?: string;
  categoryName: string;
  memberId?: string;
  note?: string;
  occurredAt?: string;
  tagIds: string[];
  items: Array<{ name: string; amount: number; categoryId?: string; note?: string }>;
};

const actionKeywords = {
  food: ["午饭", "晚饭", "早饭", "早餐", "午餐", "晚餐", "吃饭", "餐", "咖啡", "奶茶"],
  transport: ["打车", "地铁", "公交", "出租", "交通", "停车", "加油"],
  shopping: ["购物", "超市", "买", "衣服", "日用品"],
  housing: ["房租", "水电", "物业"],
  salary: ["工资", "薪水", "奖金"],
};

const ingestionCandidateSchema = z
  .object({
    type: z.enum(["income", "expense"]).optional(),
    amount: z.coerce.number().positive().finite().multipleOf(0.01).optional(),
    categoryId: z.string().trim().min(1).max(64).optional(),
    categoryName: z.string().trim().min(1).max(30).optional(),
    memberId: z.string().trim().min(1).max(64).optional(),
    note: z.string().trim().max(500).optional(),
    occurredAt: z.string().trim().min(1).optional(),
    date: z.string().trim().min(1).optional(),
    tagIds: z.array(z.string().trim().min(1).max(64)).optional(),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(120),
          amount: z.coerce.number().positive().finite().multipleOf(0.01),
          categoryId: z.string().trim().min(1).max(64).optional(),
          note: z.string().trim().max(500).optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

export async function ingestAiTransaction(context: AiTransactionIngestionContext) {
  const normalized = await normalizeTransactionCandidate(context);
  if ("error" in normalized) {
    return {
      status: 200,
      body: {
        status: "needs_input",
        missingFields: normalized.missingFields,
        parts: [{ type: "text" as const, text: normalized.message }],
      },
    };
  }

  const idempotencyKey =
    context.idempotencyKey ??
    makeIngestionIdempotencyKey({
      userId: context.user.id,
      bookId: context.bookId,
      conversationId: context.conversationId,
      text: context.text,
      candidate: normalized.value,
    });
  const existing = await getAudit(context.repository, idempotencyKey);
  if (existing?.status === "success" && existing.result?.transaction) {
    const transaction = existing.result.transaction as Transaction & { categoryName?: string };
    const parts = recordParts(transaction, transaction.categoryName);
    return {
      status: 200,
      body: {
        status: "created",
        idempotent: true,
        transaction,
        parts,
      },
    };
  }

  const member = await findMember(context.repository, context.bookId, context.user.id);
  const preliminaryTransactionInput = createTransactionSchema.parse({
    type: normalized.value.type,
    amount: normalized.value.amount,
    categoryId: normalized.value.categoryId,
    memberId: normalized.value.memberId ?? member?.id,
    note: normalized.value.note,
    occurredAt: normalized.value.occurredAt,
    tagIds: normalized.value.tagIds,
    items: normalized.value.items,
  });
  const category = normalized.value.categoryId
    ? undefined
    : await findOrCreateCategory(
        context.repository,
        context.bookId,
        normalized.value.categoryName,
        normalized.value.type,
      );
  const transactionInput = {
    ...preliminaryTransactionInput,
    categoryId: preliminaryTransactionInput.categoryId ?? category?.id,
  };
  const transaction = await context.repository.createTransaction(context.bookId, context.user.id, {
    ...transactionInput,
    items: transactionInput.items.map((item) => ({ ...item, id: `item_${crypto.randomUUID()}` })),
  });
  const result = {
    transaction: {
      ...transaction,
      categoryName: category?.name ?? normalized.value.categoryName,
    },
  };
  await audit(context.repository, {
    userId: context.user.id,
    bookId: context.bookId,
    action: "create-record",
    targetType: "transaction",
    targetId: transaction.id,
    idempotencyKey,
    status: "success",
    payload: {
      text: context.text,
      candidate: normalized.value,
    },
    result,
  });
  const parts = recordParts(transaction, result.transaction.categoryName);
  return {
    status: 201,
    body: {
      status: "created",
      idempotent: false,
      transaction: result.transaction,
      parts,
    },
  };
}

export function isTransactionIngestionPrompt(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) return false;
  if (parseAmount(trimmed) !== undefined) return true;
  return /记账|记一笔|花了|消费|支出|收入|报销|付款|收款|昨天|今天|前天/.test(trimmed);
}

export function recordParts(transaction: Transaction, categoryName?: string): AiChatPart[] {
  const recordCard: AiRecordCardPart = {
    type: "record-card",
    title: "已记录",
    transactionId: transaction.id,
    transactionType: transaction.type,
    amount: transaction.amount,
    ...(transaction.categoryId ? { categoryId: transaction.categoryId } : {}),
    ...(categoryName ? { categoryName } : {}),
    ...(transaction.note ? { note: transaction.note } : {}),
    occurredAt: transaction.occurredAt,
    pageName: "记录详情",
    href: `/records/${transaction.id}`,
  };
  const status: AiToolStatusPart = {
    type: "tool-status",
    tool: "create-record",
    status: "success",
    label: "记录已保存",
    message: `已记录${transaction.type === "expense" ? "支出" : "收入"} ${formatMoney(transaction.amount)}`,
  };
  const nav: AiNavigationCardPart = {
    type: "navigation-card",
    pageName: "记录详情",
    description: "查看刚刚保存的记录",
    href: `/records/${transaction.id}`,
  };
  return [status, recordCard, nav];
}

async function normalizeTransactionCandidate(context: AiTransactionIngestionContext): Promise<
  | { value: NormalizedCandidate }
  | { error: true; missingFields: Array<"amount" | "occurredAt">; message: string }
> {
  const categories = await listCategories(context.repository, context.bookId);
  const shared = normalizeSharedTransactionCandidate(context.candidate ?? candidateFromText(context.text), {
    query: context.text ?? "",
    today: context.today ?? new Date().toISOString().slice(0, 10),
    categories,
  });
  if (!shared.ok) {
    return {
      error: true,
      missingFields: shared.missingFields.filter(
        (field): field is "amount" | "occurredAt" => field === "amount" || field === "occurredAt",
      ),
      message: shared.message,
    };
  }
  return {
    value: {
      type: shared.value.type,
      amount: shared.value.amount,
      categoryName: shared.value.categoryName,
      note: shared.value.note,
      occurredAt: shared.value.occurredAt,
      tagIds: [],
      items: [],
    },
  };
}

function legacyNormalizeTransactionCandidate(context: AiTransactionIngestionContext):
  | { value: NormalizedCandidate }
  | { error: true; missingFields: Array<"amount" | "occurredAt">; message: string } {
  const parsed = ingestionCandidateSchema.safeParse({
    ...candidateFromText(context.text),
    ...(context.candidate ?? {}),
  });
  if (!parsed.success) {
    return {
      error: true,
      missingFields: [],
      message: "这笔记录的数据不完整，请补充金额和日期后再试。",
    };
  }
  const value = parsed.data;
  const type = value.type ?? inferType(context.text ?? "", value.note);
  const categoryName = value.categoryName ?? inferCategoryName([context.text, value.note].filter(Boolean).join(" "), type);
  const occurredAt = normalizeOccurredAt(value.occurredAt ?? value.date);
  const normalized: NormalizedCandidate = {
    type,
    amount: value.amount,
    categoryId: value.categoryId,
    categoryName,
    memberId: value.memberId,
    note: value.note,
    occurredAt,
    tagIds: value.tagIds ?? [],
    items: value.items ?? [],
  };
  const missingFields: Array<"amount" | "occurredAt"> = [];
  if (normalized.amount === undefined) missingFields.push("amount");
  if (!normalized.occurredAt) missingFields.push("occurredAt");
  if (missingFields.length) {
    return {
      error: true,
      missingFields,
      message: missingMessage(missingFields),
    };
  }
  return { value: normalized };
}

void legacyNormalizeTransactionCandidate;

function candidateFromText(text?: string) {
  if (!text) return {};
  const type = inferType(text);
  const categoryName = inferCategoryName(text, type);
  const occurredAt = inferExplicitDate(text);
  const amount = parseAmount(text);
  const note = inferNote(text, categoryName);
  return {
    type,
    amount,
    categoryName,
    occurredAt,
    note,
  };
}

function parseAmount(prompt: string) {
  const match = prompt.match(/(?:¥|￥)?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:元|块|rmb|RMB)?/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function inferType(text: string, note?: string): "income" | "expense" {
  return /收入|工资|奖金|报销|入账|收到|收款/.test(`${text} ${note ?? ""}`) ? "income" : "expense";
}

function inferCategoryName(text: string, type: "income" | "expense") {
  if (type === "income") return actionKeywords.salary.some((word) => text.includes(word)) ? "工资" : "收入";
  if (actionKeywords.food.some((word) => text.includes(word))) return "餐饮";
  if (actionKeywords.transport.some((word) => text.includes(word))) return "交通";
  if (actionKeywords.housing.some((word) => text.includes(word))) return "居住";
  if (actionKeywords.shopping.some((word) => text.includes(word))) return "购物";
  return "其他";
}

function inferExplicitDate(text: string) {
  const relative = relativeDate(text);
  if (relative) return relative;
  const isoDate = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/)?.slice(1, 4);
  if (isoDate) return localNoon(Number(isoDate[0]), Number(isoDate[1]), Number(isoDate[2]));
  const monthDay = text.match(/(?:^|[^\d])(\d{1,2})月(\d{1,2})日?/);
  if (monthDay) return localNoon(new Date().getFullYear(), Number(monthDay[1]), Number(monthDay[2]));
  return undefined;
}

function relativeDate(text: string) {
  if (text.includes("今天")) return localNoonWithOffset(0);
  if (text.includes("昨天")) return localNoonWithOffset(-1);
  if (text.includes("前天")) return localNoonWithOffset(-2);
  return undefined;
}

function normalizeOccurredAt(value?: string) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T12:00:00.000Z`;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
}

function localNoonWithOffset(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function localNoon(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return date.toISOString();
}

function inferNote(text: string, categoryName: string) {
  const note =
    text
      .replace(/(?:¥|￥)?\s*[0-9]+(?:\.[0-9]{1,2})?\s*(?:元|块|rmb|RMB)?/g, "")
      .replace(/20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/g, "")
      .replace(/\d{1,2}月\d{1,2}日?/g, "")
      .replace(/昨天|今天|前天|支出|收入|花了|消费|记一笔|记账|人民币/g, "")
      .trim()
      .slice(0, 80) || categoryName;
  return note;
}

function missingMessage(missingFields: Array<"amount" | "occurredAt">) {
  if (missingFields.includes("amount") && missingFields.includes("occurredAt")) {
    return "请补充这笔记录的金额和日期。";
  }
  if (missingFields.includes("amount")) return "请补充这笔记录的金额。";
  return "请补充这笔记录的日期，比如“今天”或“2026-06-26”。";
}

function makeIngestionIdempotencyKey(input: {
  userId: string;
  bookId: string;
  conversationId?: string;
  text?: string;
  candidate: NormalizedCandidate;
}) {
  const normalizedText = input.text?.trim().replaceAll(/\s+/g, " ");
  if (input.conversationId && normalizedText) return `ai:${input.conversationId}:create-record:${normalizedText}`;
  return `ai-ingest:${input.userId}:${input.bookId}:${JSON.stringify(input.candidate)}`;
}

async function findOrCreateCategory(
  repository: AiIngestionRepository,
  bookId: string,
  name: string,
  type: "income" | "expense",
) {
  if (repository instanceof D1LedgerRepository) return repository.findOrCreateCategory(bookId, name, type);
  return (
    repository.findCategoryByName(bookId, name) ??
    repository.createSimple("categories", bookId, { name, type, icon: type === "income" ? "wallet" : "tag", sortOrder: 0 })
  );
}

async function listCategories(repository: AiIngestionRepository, bookId: string) {
  return repository instanceof D1LedgerRepository
    ? repository.listSimple("categories", bookId)
    : repository.categories.filter((category) => category.bookId === bookId);
}

async function findMember(repository: AiIngestionRepository, bookId: string, userId: string) {
  return repository.findMember(bookId, userId);
}

async function getAudit(repository: AiIngestionRepository, idempotencyKey: string) {
  if (repository instanceof D1LedgerRepository) return repository.getAiActionAuditLog(idempotencyKey);
  return repository.aiActionAuditLogs.find((log) => log.idempotencyKey === idempotencyKey) ?? null;
}

async function audit(
  repository: AiIngestionRepository,
  input: Omit<AiActionAuditLog, "id" | "createdAt">,
) {
  if (repository instanceof D1LedgerRepository) return repository.createAiActionAuditLog(input);
  const existing = await getAudit(repository, input.idempotencyKey);
  if (existing) return existing;
  const log: AiActionAuditLog = {
    id: `ai_audit_${crypto.randomUUID()}`,
    ...input,
    createdAt: new Date().toISOString(),
  };
  repository.aiActionAuditLogs.push(log);
  return log;
}

function formatMoney(value: number) {
  return `¥${value.toFixed(2)}`;
}
