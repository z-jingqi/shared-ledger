import type {
  AiChatPart,
  AiConfirmationCardPart,
} from "@shared-ledger/shared";
import { canInvite } from "@shared-ledger/shared";
import { D1LedgerRepository } from "../repository";
import type { AiActionAuditLog, AiConfirmation, ImportJob, Invitation, MemoryLedgerStore } from "../store";
import type { LedgerUser } from "../types";
import { ingestAiTransaction, isTransactionIngestionPrompt } from "./ai-ingestion";
import { parseHeuristicIntent, type AiActionIntent, type TransactionSearchFilters } from "./ai-normalizer";
import { TransactionSearchService } from "./ai-search";

export type AiActionRepository = D1LedgerRepository | MemoryLedgerStore;
type EngineContext = {
  user: LedgerUser;
  repository: AiActionRepository;
  bookId?: string;
  prompt: string;
  conversationId: string;
  idempotencyKey?: string;
  intent?: AiActionIntent;
  today?: string;
  timeZone?: string;
  page?: string;
};
type ConfirmationContext = {
  user: LedgerUser;
  repository: AiActionRepository;
  confirmationId: string;
};

export async function executeAiActionChat(context: EngineContext) {
  const bookId = await resolveBookId(context.repository, context.user.id, context.bookId);
  if (!bookId) {
    return responseParts([
      { type: "text", text: "请先选择一个账本，我才能记账、搜索或邀请成员。" },
    ]);
  }
  const prompt = context.prompt.trim();
  const intent = context.intent ?? parseHeuristicIntent(prompt);
  if (intent.followUpQuestion && intent.confidence < 0.5) return responseParts([{ type: "text", text: intent.followUpQuestion }]);
  if (intent.action === "invite-member") return inviteMember(context, bookId, intent);
  if (intent.action === "search-records") return searchRecords(context, bookId, intent);
  if (intent.action === "analyze-records") return analyzeRecords(context, bookId, intent);
  if (intent.action === "save-attachments") {
    if (intent.ingestion?.status === "not_requested" && intent.ingestion.message) {
      return responseParts([{ type: "text", text: intent.ingestion.message }]);
    }
    return responseParts([
      {
        type: "confirmation-card",
        confirmation: {
          id: `local_attachment_${crypto.randomUUID()}`,
          action: "save-attachments",
          status: "pending",
          expiresAt: new Date(Date.now() + 10_000).toISOString(),
          summary: "保存这些附件？",
          confirmLabel: "保存",
          cancelLabel: "取消",
        },
      },
    ]);
  }
  if (intent.action === "create-record" || isTransactionIngestionPrompt(prompt)) {
    const result = await ingestAiTransaction({
      user: context.user,
      repository: context.repository,
      bookId,
      text: prompt,
      candidate: intent.action === "create-record" ? intent.transaction : undefined,
      conversationId: context.conversationId,
      idempotencyKey: context.idempotencyKey,
      today: context.today,
      timeZone: context.timeZone,
    });
    return result.body.parts;
  }
  return responseParts([
    {
      type: "text",
      text: "我可以帮你记账、搜索账本、分析收支，或邀请成员。比如：昨天午饭 38。",
    },
  ]);
}

export async function confirmAiConfirmation(context: ConfirmationContext) {
  const confirmation = await getConfirmation(context.repository, context.user.id, context.confirmationId);
  if (!confirmation) return { status: 404, body: { error: "确认项不存在" } };
  if (confirmation.status !== "pending") return { status: 409, body: { confirmation } };
  if (new Date(confirmation.expiresAt).getTime() <= Date.now()) {
    const cancelled = await updateConfirmation(context.repository, confirmation, {
      status: "cancelled",
      result: { reason: "expired" },
      cancelledAt: new Date().toISOString(),
    });
    await audit(context.repository, {
      userId: context.user.id,
      bookId: confirmation.bookId,
      action: "cancel-confirmation",
      targetType: "ai_confirmation",
      targetId: confirmation.id,
      idempotencyKey: `ai-confirmation-expired:${confirmation.id}`,
      status: "success",
      payload: { confirmationId: confirmation.id },
      result: { reason: "expired" },
    });
    return { status: 409, body: { confirmation: cancelled, expired: true } };
  }
  const action = String(confirmation.action);
  if (action !== "invite-member") return unsupportedConfirmationAction(action);
  const payload = confirmation.payload as { bookId?: string; email?: string; phone?: string; role?: "admin" | "member" };
  const bookId = payload.bookId ?? confirmation.bookId;
  if (!bookId) return { status: 400, body: { error: "确认项缺少账本信息" } };
  if (!(await userCanInvite(context.repository, bookId, context.user.id))) {
    return { status: 403, body: { error: "没有邀请成员的权限" } };
  }
  const duplicate = await findPendingInvitation(context.repository, bookId, payload.email, payload.phone);
  const invitation =
    duplicate ??
    (await createInvitation(context.repository, {
      bookId,
      inviterUserId: context.user.id,
      inviteeEmail: payload.email,
      inviteePhone: payload.phone,
      role: payload.role ?? "member",
    }));
  const result = { invitation, duplicate: Boolean(duplicate) };
  await audit(context.repository, {
    userId: context.user.id,
    bookId,
    action: "invite-member",
    targetType: "invitation",
    targetId: invitation.id,
    idempotencyKey: `ai-confirm:${confirmation.id}:invite-member`,
    status: "success",
    payload,
    result,
  });
  const updated = await updateConfirmation(context.repository, confirmation, {
    status: "confirmed",
    result,
    confirmedAt: new Date().toISOString(),
  });
  return { status: 200, body: { confirmation: updated, invitation, duplicate: Boolean(duplicate) } };
}

export async function cancelAiConfirmation(context: ConfirmationContext) {
  const confirmation = await getConfirmation(context.repository, context.user.id, context.confirmationId);
  if (!confirmation) return { status: 404, body: { error: "确认项不存在" } };
  if (confirmation.status !== "pending") return { status: 409, body: { confirmation } };
  const updated = await updateConfirmation(context.repository, confirmation, {
    status: "cancelled",
    result: { reason: "user_cancelled" },
    cancelledAt: new Date().toISOString(),
  });
  await audit(context.repository, {
    userId: context.user.id,
    bookId: confirmation.bookId,
    action: "cancel-confirmation",
    targetType: "ai_confirmation",
    targetId: confirmation.id,
    idempotencyKey: `ai-confirmation-cancel:${confirmation.id}`,
    status: "success",
    payload: { confirmationId: confirmation.id },
    result: { reason: "user_cancelled" },
  });
  return { status: 200, body: { confirmation: updated } };
}

export async function listAiTasks(repository: AiActionRepository, userId: string) {
  const aiTasks =
    repository instanceof D1LedgerRepository
      ? await repository.listAiTasks(userId)
      : repository.aiTasks.filter((task) => task.userId === userId);
  const importJobs =
    repository instanceof D1LedgerRepository
      ? await repository.listImportJobsForUser(userId)
      : repository.imports.filter((job) => job.userId === userId);
  return [
    ...aiTasks,
    ...importJobs.map(importJobToTask),
  ].filter((task) => task.status !== "cancelled");
}

export function importJobToTask(job: ImportJob) {
  return {
    id: job.id,
    userId: job.userId,
    bookId: job.bookId,
    kind: "import",
    status: mapImportStatus(job.status),
    sourceType: "import_job",
    sourceId: job.id,
    cancelable: Boolean(job.cancelable),
    retryable: Boolean(job.retryable || job.errorRetryable),
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export async function searchAiTransactions(input: {
  repository: AiActionRepository;
  bookId: string;
  query: string;
  intent?: AiActionIntent;
  today?: string;
  timeZone?: string;
  baseFilters?: TransactionSearchFilters;
}) {
  const service = new TransactionSearchService(input.repository);
  return service.search({
    bookId: input.bookId,
    query: input.query,
    baseFilters: { ...filtersFromIntent(input.intent), ...(input.baseFilters ?? {}) },
    timeZone: input.timeZone,
  });
}

async function searchRecords(context: EngineContext, bookId: string, intent: AiActionIntent) {
  const service = new TransactionSearchService(context.repository);
  const result = await service.search({
    bookId,
    query: context.prompt,
    baseFilters: filtersFromIntent(intent),
    timeZone: context.timeZone,
  });
  return responseParts(service.searchParts(result));
}

async function analyzeRecords(context: EngineContext, bookId: string, intent: AiActionIntent) {
  const service = new TransactionSearchService(context.repository);
  const result = await service.analyze({
    bookId,
    query: context.prompt,
    baseFilters: filtersFromIntent(intent),
    timeZone: context.timeZone,
  });
  return responseParts(service.analysisParts(result));
}

async function inviteMember(context: EngineContext, bookId: string, intent: AiActionIntent) {
  const parsedContact = parseInviteContact(context.prompt);
  const contact = {
    email: intent.invite?.email ?? parsedContact.email,
    phone: intent.invite?.phone ?? parsedContact.phone,
  };
  if (!contact.email && !contact.phone) {
    return responseParts([{ type: "text", text: "请提供要邀请成员的邮箱或手机号。" }]);
  }
  if (!(await userCanInvite(context.repository, bookId, context.user.id))) {
    return responseParts([
      {
        type: "tool-status",
        tool: "invite-member",
        status: "error",
        label: "邀请失败",
        message: "没有邀请成员的权限",
      },
      { type: "text", text: "你需要是账本创建者或管理员，才能邀请成员。" },
    ]);
  }
  const role = intent.invite?.role === "admin" || context.prompt.includes("管理员") || context.prompt.includes("admin") ? "admin" : "member";
  const pendingInvitation = await findPendingInvitation(context.repository, bookId, contact.email, contact.phone);
  if (pendingInvitation) {
    return responseParts([
      {
        type: "tool-status",
        tool: "invite-member",
        status: "success",
        message: "该成员已有待处理邀请，没有重复创建。",
      },
    ]);
  }
  const pendingConfirmation = await findPendingInviteConfirmation(context.repository, bookId, contact.email, contact.phone);
  const confirmation =
    pendingConfirmation ??
    (await createConfirmation(context.repository, {
      userId: context.user.id,
      bookId,
      action: "invite-member",
      payload: { bookId, ...contact, role },
    }));
  if (!pendingConfirmation) {
    await audit(context.repository, {
      userId: context.user.id,
      bookId,
      action: "create-confirmation",
      targetType: "ai_confirmation",
      targetId: confirmation.id,
      idempotencyKey: context.idempotencyKey ?? actionKey(context.conversationId, "invite-member", context.prompt),
      status: "success",
      payload: { ...contact, role },
      result: { confirmationId: confirmation.id },
    });
  }
  const summary = `邀请 ${contact.email ?? contact.phone} 加入账本`;
  const card: AiConfirmationCardPart = {
    type: "confirmation-card",
    confirmation: {
      id: confirmation.id,
      action: "invite-member",
      status: confirmation.status,
      expiresAt: confirmation.expiresAt,
      summary,
      confirmLabel: "发送邀请",
      cancelLabel: "取消",
    },
  };
  return responseParts([
    { type: "tool-status", tool: "invite-member", status: "pending_confirmation", label: "等待确认", message: "请确认后发送邀请" },
    card,
  ]);
}

function responseParts(parts: AiChatPart[]) {
  return parts;
}

function filtersFromIntent(intent?: AiActionIntent): TransactionSearchFilters {
  const source = (intent?.normalizedSearchFilters ?? intent?.search) as Record<string, unknown> | undefined;
  if (!source) return {};
  const filters: TransactionSearchFilters = {};
  if (source.type === "income" || source.type === "expense") filters.type = source.type;
  if (typeof source.minAmount === "number") filters.minAmount = source.minAmount;
  if (typeof source.maxAmount === "number") filters.maxAmount = source.maxAmount;
  const from = typeof source.from === "string" ? source.from : typeof source.start === "string" ? source.start : undefined;
  const to = typeof source.to === "string" ? source.to : typeof source.end === "string" ? source.end : undefined;
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (typeof source.categoryId === "string") filters.categoryId = source.categoryId;
  if (typeof source.categoryName === "string") filters.categoryName = source.categoryName;
  if (Array.isArray(source.categoryIds) && typeof source.categoryIds[0] === "string") filters.categoryId = source.categoryIds[0];
  if (Array.isArray(source.categoryNames) && typeof source.categoryNames[0] === "string") filters.categoryName = source.categoryNames[0];
  const keyword = typeof source.q === "string" ? source.q : typeof source.query === "string" ? source.query : undefined;
  if (keyword) filters.q = keyword;
  if (source.sort === "amount_desc") filters.sort = "amount_desc";
  else if (source.sort === "amount_asc") filters.sort = "amount_asc";
  else if (source.sort === "occurredAt_asc") filters.sort = "date_asc";
  else if (source.sort === "occurredAt_desc") filters.sort = "date_desc";
  return filters;
}

function parseInviteContact(prompt: string) {
  const email = prompt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0].toLowerCase();
  const phone = prompt.match(/(?:\+?\d[\d -]{5,}\d)/)?.[0].replaceAll(/[^\d+]/g, "");
  return { email, phone };
}

async function resolveBookId(repository: AiActionRepository, userId: string, bookId?: string) {
  if (bookId) return bookId;
  if (repository instanceof D1LedgerRepository) return (await repository.listBooks(userId))[0]?.id;
  return repository.books.find((book) => repository.role(book.id, userId))?.id;
}

async function findPendingInvitation(
  repository: AiActionRepository,
  bookId: string,
  email?: string,
  phone?: string,
) {
  if (repository instanceof D1LedgerRepository) return repository.findPendingInvitation(bookId, email, phone);
  return (
    repository.invitations.find(
      (item) =>
        item.bookId === bookId &&
        item.status === "pending" &&
        Boolean((email && item.inviteeEmail === email) || (phone && item.inviteePhone === phone)),
    ) ?? null
  );
}

async function userCanInvite(repository: AiActionRepository, bookId: string, userId: string) {
  const role = repository instanceof D1LedgerRepository ? await repository.role(bookId, userId) : repository.role(bookId, userId);
  return canInvite(role ?? "member");
}

function unsupportedConfirmationAction(action: string) {
  const knownUnsupported = new Set([
    "save-attachments",
    "confirm-import-batch",
    "cancel-task",
    "retry-task",
  ]);
  const message = knownUnsupported.has(action) ? "该确认动作暂不支持" : "不支持的确认动作";
  return { status: 400, body: { error: message, action } };
}

async function createInvitation(
  repository: AiActionRepository,
  input: { bookId: string; inviterUserId: string; inviteeEmail?: string; inviteePhone?: string; role: "admin" | "member" },
) {
  if (repository instanceof D1LedgerRepository) return repository.createInvitation(input);
  const invitation: Invitation = {
    id: `invitation_${crypto.randomUUID()}`,
    bookId: input.bookId,
    inviterUserId: input.inviterUserId,
    ...(input.inviteeEmail ? { inviteeEmail: input.inviteeEmail } : {}),
    ...(input.inviteePhone ? { inviteePhone: input.inviteePhone } : {}),
    role: input.role,
    status: "pending",
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  };
  repository.invitations.push(invitation);
  return invitation;
}

async function findPendingInviteConfirmation(
  repository: AiActionRepository,
  bookId: string,
  email?: string,
  phone?: string,
) {
  if (repository instanceof D1LedgerRepository) return repository.findPendingAiInviteConfirmation(bookId, email, phone);
  return (
    repository.aiConfirmations.find((confirmation) => {
      const payload = confirmation.payload as { email?: string; phone?: string };
      return (
        confirmation.bookId === bookId &&
        confirmation.action === "invite-member" &&
        confirmation.status === "pending" &&
        Boolean((email && payload.email === email) || (phone && payload.phone === phone))
      );
    }) ?? null
  );
}

async function createConfirmation(
  repository: AiActionRepository,
  input: { userId: string; bookId: string; action: AiConfirmation["action"]; payload: Record<string, unknown> },
) {
  if (repository instanceof D1LedgerRepository) return repository.createAiConfirmation(input);
  const timestamp = new Date().toISOString();
  const confirmation: AiConfirmation = {
    id: `ai_confirmation_${crypto.randomUUID()}`,
    userId: input.userId,
    bookId: input.bookId,
    action: input.action,
    status: "pending",
    payload: input.payload,
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  repository.aiConfirmations.push(confirmation);
  return confirmation;
}

async function getConfirmation(repository: AiActionRepository, userId: string, confirmationId: string) {
  if (repository instanceof D1LedgerRepository) return repository.getAiConfirmation(userId, confirmationId);
  return repository.aiConfirmations.find((confirmation) => confirmation.id === confirmationId && confirmation.userId === userId) ?? null;
}

async function updateConfirmation(
  repository: AiActionRepository,
  confirmation: AiConfirmation,
  fields: { status: "pending" | "confirmed" | "cancelled"; result?: Record<string, unknown>; confirmedAt?: string; cancelledAt?: string },
) {
  if (repository instanceof D1LedgerRepository) {
    await repository.updateAiConfirmation(confirmation.id, fields);
    return (await repository.getAiConfirmation(confirmation.userId, confirmation.id)) ?? { ...confirmation, ...fields };
  }
  Object.assign(confirmation, { ...fields, updatedAt: new Date().toISOString() });
  return confirmation;
}

async function getAudit(repository: AiActionRepository, idempotencyKey: string) {
  if (repository instanceof D1LedgerRepository) return repository.getAiActionAuditLog(idempotencyKey);
  return repository.aiActionAuditLogs.find((log) => log.idempotencyKey === idempotencyKey) ?? null;
}

async function audit(
  repository: AiActionRepository,
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

function actionKey(conversationId: string, action: string, prompt: string) {
  return `ai:${conversationId}:${action}:${prompt.trim().replaceAll(/\s+/g, " ")}`;
}

function mapImportStatus(status: string) {
  if (status === "uploaded" || status === "parsing" || status === "converting" || status === "ocr_processing" || status === "ai_processing")
    return "running";
  return status;
}

