import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const systemActorId = "0";
const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};
const actorAudit = {
  createdByUserId: text("created_by_user_id").notNull().default(systemActorId),
  updatedByUserId: text("updated_by_user_id").notNull().default(systemActorId),
  deletedAt: text("deleted_at"),
  deletedByUserId: text("deleted_by_user_id"),
};
const fullAudit = { ...timestamps, ...actorAudit };
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique(),
  phone: text("phone").unique(),
  avatarUrl: text("avatar_url"),
  passwordHash: text("password_hash").notNull(),
  ...fullAudit,
});
export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("CNY"),
  ...fullAudit,
});
export const bookMembers = sqliteTable(
  "book_members",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["creator", "admin", "member"] }).notNull(),
    joinedAt: text("joined_at").notNull(),
    ...fullAudit,
  },
  (t) => [
    uniqueIndex("book_members_book_user").on(t.bookId, t.userId),
    index("book_members_user").on(t.userId),
  ],
);
export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  inviterUserId: text("inviter_user_id").notNull(),
  inviteeEmail: text("invitee_email"),
  inviteePhone: text("invitee_phone"),
  inviteeUserId: text("invitee_user_id"),
  role: text("role").notNull(),
  status: text("status").notNull(),
  expiresAt: text("expires_at").notNull(),
  lastRemindedAt: text("last_reminded_at"),
  ...fullAudit,
});
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  ...fullAudit,
});
export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    icon: text("icon").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...fullAudit,
  },
  (t) => [
    uniqueIndex("categories_user_type_name_active")
      .on(t.userId, t.type, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);
export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id").notNull(),
    type: text("type").notNull(),
    amount: integer("amount_cents").notNull(),
    categoryId: text("category_id"),
    accountId: text("account_id"),
    memberId: text("member_id"),
    note: text("note"),
    occurredAt: text("occurred_at").notNull(),
    ...fullAudit,
  },
  (t) => [index("transactions_book_date").on(t.bookId, t.occurredAt)],
);
export const transactionItems = sqliteTable("transaction_items", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull(),
  name: text("name").notNull(),
  amount: integer("amount_cents").notNull(),
  categoryId: text("category_id"),
  note: text("note"),
  ...fullAudit,
});
export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  transactionId: text("transaction_id"),
  importJobId: text("import_job_id"),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  r2Key: text("r2_key").notNull(),
  size: integer("size").notNull(),
  ...fullAudit,
});
export const importJobs = sqliteTable("import_jobs", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  userId: text("user_id").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  r2Key: text("r2_key").notNull(),
  status: text("status").notNull(),
  autoConfirm: integer("auto_confirm").notNull().default(0),
  errorMessage: text("error_message"),
  errorCode: text("error_code"),
  errorStage: text("error_stage"),
  errorRequestId: text("error_request_id"),
  errorRetryable: integer("error_retryable").notNull().default(0),
  errorTerminal: integer("error_terminal").notNull().default(0),
  failedExternalJobId: text("failed_external_job_id"),
  cancelable: integer("cancelable").notNull().default(0),
  retryable: integer("retryable").notNull().default(0),
  retryCount: integer("retry_count").notNull().default(0),
  ocrJobId: text("ocr_job_id"),
  alephTool: text("aleph_tool"),
  ocrSubmittedAt: text("ocr_submitted_at"),
  ocrProgress: integer("ocr_progress").notNull().default(0),
  ocrStage: text("ocr_stage"),
  ocrCurrentPage: integer("ocr_current_page"),
  ocrTotalPages: integer("ocr_total_pages"),
  ocrCompletedAt: text("ocr_completed_at"),
  ocrEventSequence: integer("ocr_event_sequence").notNull().default(0),
  ...fullAudit,
});
export const importedRecords = sqliteTable("imported_records", {
  id: text("id").primaryKey(),
  importJobId: text("import_job_id").notNull(),
  rawData: text("raw_data").notNull(),
  suggestedTransaction: text("suggested_transaction").notNull(),
  status: text("status").notNull(),
  confidence: integer("confidence").notNull(),
  warnings: text("warnings").notNull(),
  ...fullAudit,
});
export const imageOcrUsage = sqliteTable(
  "image_ocr_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    importJobId: text("import_job_id").notNull(),
    usageDate: text("usage_date").notNull(),
    countedAt: text("counted_at").notNull(),
    ...fullAudit,
  },
  (t) => [
    uniqueIndex("image_ocr_usage_import_job").on(t.importJobId),
    index("image_ocr_usage_user_date").on(t.userId, t.usageDate),
  ],
);
export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  plan: text("plan").notNull(),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  expiresAt: text("expires_at"),
  ...fullAudit,
});
export const aiSessions = sqliteTable(
  "ai_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    bookId: text("book_id"),
    title: text("title").notNull(),
    ...fullAudit,
  },
  (t) => [index("ai_sessions_user_updated").on(t.userId, t.updatedAt)],
);
export const aiMessages = sqliteTable(
  "ai_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    parts: text("parts"),
    attachments: text("attachments"),
    ...fullAudit,
  },
  (t) => [index("ai_messages_session_created").on(t.sessionId, t.createdAt)],
);
export const aiRuns = sqliteTable(
  "ai_runs",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull(),
    bookId: text("book_id"),
    status: text("status").notNull(),
    input: text("input").notNull(),
    selectedSkill: text("selected_skill"),
    finalMessageId: text("final_message_id"),
    errorMessage: text("error_message"),
    ...fullAudit,
  },
  (t) => [
    index("ai_runs_session_created").on(t.sessionId, t.createdAt),
    index("ai_runs_user_status").on(t.userId, t.status),
  ],
);
export const aiSteps = sqliteTable(
  "ai_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    stepIndex: integer("step_index").notNull(),
    kind: text("kind").notNull(),
    skillName: text("skill_name"),
    toolName: text("tool_name"),
    status: text("status").notNull(),
    input: text("input"),
    output: text("output"),
    errorMessage: text("error_message"),
    ...fullAudit,
  },
  (t) => [index("ai_steps_run_index").on(t.runId, t.stepIndex)],
);
export const aiConfirmations = sqliteTable(
  "ai_confirmations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    bookId: text("book_id"),
    toolCallId: text("tool_call_id"),
    action: text("action").notNull(),
    status: text("status").notNull(),
    payload: text("payload").notNull(),
    result: text("result"),
    expiresAt: text("expires_at").notNull(),
    confirmedAt: text("confirmed_at"),
    cancelledAt: text("cancelled_at"),
    ...fullAudit,
  },
  (t) => [index("ai_confirmations_user_status").on(t.userId, t.status)],
);
export const aiToolCalls = sqliteTable(
  "ai_tool_calls",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull(),
    bookId: text("book_id"),
    skillName: text("skill_name").notNull().default("general.chat"),
    toolName: text("tool_name").notNull(),
    status: text("status").notNull(),
    args: text("args").notNull(),
    result: text("result"),
    errorMessage: text("error_message"),
    ...fullAudit,
  },
  (t) => [
    index("ai_tool_calls_session").on(t.sessionId),
    index("ai_tool_calls_user_status").on(t.userId, t.status),
  ],
);
export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    ...fullAudit,
  },
  (t) => [index("refresh_tokens_user").on(t.userId)],
);
