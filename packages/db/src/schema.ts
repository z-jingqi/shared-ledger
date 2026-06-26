import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = { createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull() };
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").unique(),
  phone: text("phone").unique(),
  avatarUrl: text("avatar_url"),
  passwordHash: text("password_hash").notNull(),
  ...timestamps,
});
export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("CNY"),
  createdByUserId: text("created_by_user_id").notNull(),
  deletedAt: text("deleted_at"),
  ...timestamps,
});
export const bookMembers = sqliteTable(
  "book_members",
  {
    id: text("id").primaryKey(),
    bookId: text("book_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["creator", "admin", "member"] }).notNull(),
    joinedAt: text("joined_at").notNull(),
    ...timestamps,
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
  ...timestamps,
});
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  ...timestamps,
});
export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  icon: text("icon").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});
export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  ...timestamps,
});
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
    createdByUserId: text("created_by_user_id").notNull(),
    note: text("note"),
    occurredAt: text("occurred_at").notNull(),
    deletedAt: text("deleted_at"),
    ...timestamps,
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
  ...timestamps,
});
export const transactionTags = sqliteTable(
  "transaction_tags",
  { transactionId: text("transaction_id").notNull(), tagId: text("tag_id").notNull() },
  (t) => [uniqueIndex("transaction_tags_unique").on(t.transactionId, t.tagId)],
);
export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  transactionId: text("transaction_id"),
  importJobId: text("import_job_id"),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  r2Key: text("r2_key").notNull(),
  size: integer("size").notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  createdAt: text("created_at").notNull(),
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
  convertJobId: text("convert_job_id"),
  convertEventSequence: integer("convert_event_sequence").notNull().default(0),
  convertedR2Key: text("converted_r2_key"),
  convertedFileType: text("converted_file_type"),
  ocrJobId: text("ocr_job_id"),
  ocrSubmittedAt: text("ocr_submitted_at"),
  ocrProgress: integer("ocr_progress").notNull().default(0),
  ocrStage: text("ocr_stage"),
  ocrCurrentPage: integer("ocr_current_page"),
  ocrTotalPages: integer("ocr_total_pages"),
  ocrCompletedAt: text("ocr_completed_at"),
  ocrEventSequence: integer("ocr_event_sequence").notNull().default(0),
  ...timestamps,
});
export const importedRecords = sqliteTable("imported_records", {
  id: text("id").primaryKey(),
  importJobId: text("import_job_id").notNull(),
  rawData: text("raw_data").notNull(),
  suggestedTransaction: text("suggested_transaction").notNull(),
  status: text("status").notNull(),
  confidence: integer("confidence").notNull(),
  warnings: text("warnings").notNull(),
  ...timestamps,
});
export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  plan: text("plan").notNull(),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  expiresAt: text("expires_at"),
  ...timestamps,
});
export const aiConversations = sqliteTable("ai_conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  bookId: text("book_id"),
  title: text("title").notNull(),
  ...timestamps,
});
export const aiMessages = sqliteTable("ai_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  metadata: text("metadata"),
  createdAt: text("created_at").notNull(),
});
export const aiProviderConfigs = sqliteTable("ai_provider_configs", {
  userId: text("user_id").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  apiKeyRef: text("api_key_ref"),
  baseUrl: text("base_url"),
  ...timestamps,
});
export const aiConfirmations = sqliteTable(
  "ai_confirmations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    bookId: text("book_id"),
    action: text("action").notNull(),
    status: text("status").notNull(),
    payload: text("payload").notNull(),
    result: text("result"),
    expiresAt: text("expires_at").notNull(),
    confirmedAt: text("confirmed_at"),
    cancelledAt: text("cancelled_at"),
    ...timestamps,
  },
  (t) => [index("ai_confirmations_user_status").on(t.userId, t.status)],
);
export const aiActionAuditLogs = sqliteTable(
  "ai_action_audit_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    bookId: text("book_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    payload: text("payload").notNull(),
    result: text("result"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("ai_action_audit_idempotency").on(t.idempotencyKey),
    index("ai_action_audit_book").on(t.bookId),
  ],
);
export const aiTasks = sqliteTable(
  "ai_tasks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    bookId: text("book_id"),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    payload: text("payload"),
    result: text("result"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("ai_tasks_user_status").on(t.userId, t.status), index("ai_tasks_source").on(t.sourceType, t.sourceId)],
);
export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("refresh_tokens_user").on(t.userId)],
);
