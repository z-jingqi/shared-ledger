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
  errorMessage: text("error_message"),
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
