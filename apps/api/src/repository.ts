import type { AiProviderName } from "@shared-ledger/shared";
import type { Book, Member, Transaction } from "./types";
import type { AiConfirmation, ImportedRecord, ImportJob, Invitation, SimpleEntity } from "./store";

type Row = Record<string, any>;
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export const systemActorId = "0";
export const importJobRetentionDays = 7;
const importJobRetentionMs = importJobRetentionDays * 24 * 60 * 60 * 1000;
const importJobCutoff = () => new Date(Date.now() - importJobRetentionMs).toISOString();
export type ImportJobStatusFilter = "all" | "processing" | "success" | "failed";

const mapBook = (row: Row): Book => ({
  id: row.id,
  name: row.name,
  currency: row.currency,
  createdByUserId: row.createdByUserId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapMember = (row: Row): Member => ({
  id: row.id,
  bookId: row.bookId,
  userId: row.userId,
  name: row.name,
  role: row.role,
  joinedAt: row.joinedAt,
});

const mapSimple = (row: Row): SimpleEntity => ({
  id: row.id,
  bookId: row.bookId,
  name: row.name,
  ...(row.type ? { type: row.type } : {}),
  ...(row.icon ? { icon: row.icon } : {}),
  ...(row.color ? { color: row.color } : {}),
  ...(row.sortOrder !== undefined ? { sortOrder: row.sortOrder } : {}),
});

const mapInvitation = (row: Row): Invitation => ({
  id: row.id,
  bookId: row.bookId,
  inviterUserId: row.inviterUserId,
  ...(row.inviteeEmail ? { inviteeEmail: row.inviteeEmail } : {}),
  ...(row.inviteePhone ? { inviteePhone: row.inviteePhone } : {}),
  ...(row.inviteeUserId ? { inviteeUserId: row.inviteeUserId } : {}),
  role: row.role,
  status: row.status,
  expiresAt: row.expiresAt,
  ...(row.lastRemindedAt ? { lastRemindedAt: row.lastRemindedAt } : {}),
});

const parseJson = (value: unknown) => {
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const escapeLike = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

const mapAiConfirmation = (row: Row): AiConfirmation => ({
  id: row.id,
  userId: row.userId,
  ...(row.bookId ? { bookId: row.bookId } : {}),
  action: row.action,
  status: row.status,
  payload: parseJson(row.payload) ?? {},
  ...(row.result ? { result: parseJson(row.result) ?? {} } : {}),
  expiresAt: row.expiresAt,
  ...(row.confirmedAt ? { confirmedAt: row.confirmedAt } : {}),
  ...(row.cancelledAt ? { cancelledAt: row.cancelledAt } : {}),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapImportJob = (row: Row): ImportJob => ({
  id: row.id,
  bookId: row.bookId,
  userId: row.userId,
  fileName: row.fileName,
  fileType: row.fileType,
  r2Key: row.r2Key,
  status: row.status,
  autoConfirm: Boolean(row.autoConfirm),
  ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
  ...(row.errorCode ? { errorCode: row.errorCode } : {}),
  ...(row.errorStage ? { errorStage: row.errorStage } : {}),
  ...(row.errorRequestId ? { errorRequestId: row.errorRequestId } : {}),
  errorRetryable: Boolean(row.errorRetryable),
  errorTerminal: Boolean(row.errorTerminal),
  ...(row.failedExternalJobId ? { failedExternalJobId: row.failedExternalJobId } : {}),
  cancelable: Boolean(row.cancelable),
  retryable: Boolean(row.retryable),
  retryCount: row.retryCount ?? 0,
  ...(row.convertJobId ? { convertJobId: row.convertJobId } : {}),
  convertEventSequence: row.convertEventSequence ?? 0,
  ...(row.convertedR2Key ? { convertedR2Key: row.convertedR2Key } : {}),
  ...(row.convertedFileType ? { convertedFileType: row.convertedFileType } : {}),
  ...(row.ocrJobId ? { ocrJobId: row.ocrJobId } : {}),
  ...(row.ocrSubmittedAt ? { ocrSubmittedAt: row.ocrSubmittedAt } : {}),
  ocrProgress: row.ocrProgress ?? 0,
  ...(row.ocrStage ? { ocrStage: row.ocrStage } : {}),
  ...(row.ocrCurrentPage !== null && row.ocrCurrentPage !== undefined
    ? { ocrCurrentPage: row.ocrCurrentPage }
    : {}),
  ...(row.ocrTotalPages !== null && row.ocrTotalPages !== undefined ? { ocrTotalPages: row.ocrTotalPages } : {}),
  ...(row.ocrCompletedAt ? { ocrCompletedAt: row.ocrCompletedAt } : {}),
  ocrEventSequence: row.ocrEventSequence ?? 0,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  ...(row.deletedAt ? { deletedAt: row.deletedAt } : {}),
  ...(row.deletedByUserId ? { deletedByUserId: row.deletedByUserId } : {}),
});

const importJobColumns =
  "id,book_id AS bookId,user_id AS userId,file_name AS fileName,file_type AS fileType,r2_key AS r2Key,status,auto_confirm AS autoConfirm,error_message AS errorMessage,error_code AS errorCode,error_stage AS errorStage,error_request_id AS errorRequestId,error_retryable AS errorRetryable,error_terminal AS errorTerminal,failed_external_job_id AS failedExternalJobId,cancelable,retryable,retry_count AS retryCount,convert_job_id AS convertJobId,convert_event_sequence AS convertEventSequence,converted_r2_key AS convertedR2Key,converted_file_type AS convertedFileType,ocr_job_id AS ocrJobId,ocr_submitted_at AS ocrSubmittedAt,ocr_progress AS ocrProgress,ocr_stage AS ocrStage,ocr_current_page AS ocrCurrentPage,ocr_total_pages AS ocrTotalPages,ocr_completed_at AS ocrCompletedAt,ocr_event_sequence AS ocrEventSequence,created_at AS createdAt,updated_at AS updatedAt,deleted_at AS deletedAt,deleted_by_user_id AS deletedByUserId";
const aiConfirmationColumns =
  "id,user_id AS userId,book_id AS bookId,action,status,payload,result,expires_at AS expiresAt,confirmed_at AS confirmedAt,cancelled_at AS cancelledAt,created_at AS createdAt,updated_at AS updatedAt";
const aiSessionColumns =
  "id,user_id AS userId,book_id AS bookId,title,created_at AS createdAt,updated_at AS updatedAt";
const aiMessageColumns =
  "id,session_id AS sessionId,role,content,parts,attachments,created_at AS createdAt";
const aiToolCallColumns =
  "id,session_id AS sessionId,user_id AS userId,book_id AS bookId,tool_name AS toolName,status,args,result,error_message AS errorMessage,created_at AS createdAt,updated_at AS updatedAt";

const mapRecord = (row: Row): ImportedRecord => ({
  id: row.id,
  importJobId: row.importJobId,
  suggestedTransaction: JSON.parse(row.suggestedTransaction),
  status: row.status,
  confidence: row.confidence / 100,
  warnings: JSON.parse(row.warnings),
});

/**
 * The production repository talks to D1 directly. It deliberately does not
 * cache a request snapshot: that pattern loses concurrent writes and lets
 * test fixtures escape into production data.
 */
export class D1LedgerRepository {
  constructor(private readonly db: D1Database) {}

  async getAiProviderConfig(userId: string) {
    const row = await this.db
      .prepare(
        "SELECT provider,model,api_key_ref AS apiKeyRef,base_url AS baseUrl FROM ai_provider_configs WHERE user_id = ? AND deleted_at IS NULL",
      )
      .bind(userId)
      .first<{ provider: AiProviderName; model: string; apiKeyRef: string | null; baseUrl: string | null }>();
    return row ? { ...row, apiKeyRef: row.apiKeyRef ?? undefined, baseUrl: row.baseUrl ?? undefined } : null;
  }

  async ensureAiProviderConfig(userId: string) {
    const timestamp = now();
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO ai_provider_configs (user_id,provider,model,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(userId, "workers-ai", "@cf/meta/llama-3.1-8b-instruct", userId, userId, timestamp, timestamp)
      .run();
    return this.getAiProviderConfig(userId);
  }

  async setAiProviderConfig(
    userId: string,
    config: { provider: AiProviderName; model: string; apiKeyRef?: string; baseUrl?: string },
  ) {
    const timestamp = now();
    await this.db
      .prepare(
        `INSERT INTO ai_provider_configs (user_id,provider,model,api_key_ref,base_url,created_by_user_id,updated_by_user_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,api_key_ref=excluded.api_key_ref,base_url=excluded.base_url,updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at,deleted_at=NULL,deleted_by_user_id=NULL`,
      )
      .bind(
        userId,
        config.provider,
        config.model,
        config.apiKeyRef ?? null,
        config.baseUrl ?? null,
        userId,
        userId,
        timestamp,
        timestamp,
      )
      .run();
    return this.getAiProviderConfig(userId);
  }

  async role(bookId: string, userId: string) {
    const result = await this.db
      .prepare("SELECT role FROM book_members WHERE book_id = ? AND user_id = ? AND deleted_at IS NULL")
      .bind(bookId, userId)
      .first<{ role: Member["role"] }>();
    return result?.role;
  }

  async listBooks(userId: string) {
    const result = await this.db
      .prepare(
        `SELECT b.id,b.name,b.currency,b.created_by_user_id AS createdByUserId,b.created_at AS createdAt,b.updated_at AS updatedAt
         FROM books b JOIN book_members bm ON bm.book_id = b.id
         WHERE bm.user_id = ? AND bm.deleted_at IS NULL AND b.deleted_at IS NULL ORDER BY b.updated_at DESC`,
      )
      .bind(userId)
      .all<Row>();
    return result.results.map(mapBook);
  }

  async getBook(bookId: string) {
    const result = await this.db
      .prepare(
        "SELECT id,name,currency,created_by_user_id AS createdByUserId,created_at AS createdAt,updated_at AS updatedAt FROM books WHERE id = ? AND deleted_at IS NULL",
      )
      .bind(bookId)
      .first<Row>();
    return result ? mapBook(result) : null;
  }

  async createBook(userId: string, name: string, currency: string) {
    const timestamp = now();
    const book: Book = {
      id: id("book"),
      name,
      currency,
      createdByUserId: userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db.batch([
      this.db
        .prepare(
          "INSERT INTO books (id,name,currency,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(book.id, book.name, book.currency, userId, userId, timestamp, timestamp),
      this.db
        .prepare(
          "INSERT INTO book_members (id,book_id,user_id,role,joined_at,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(id("member"), book.id, userId, "creator", timestamp, userId, userId, timestamp, timestamp),
    ]);
    return book;
  }

  async updateBook(bookId: string, input: Partial<Pick<Book, "name" | "currency">>, actorId = systemActorId) {
    const book = await this.getBook(bookId);
    if (!book) return null;
    const timestamp = now();
    const updated = {
      ...book,
      name: input.name ?? book.name,
      currency: input.currency ?? book.currency,
      updatedAt: timestamp,
    };
    await this.db
      .prepare("UPDATE books SET name = ?, currency = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ?")
      .bind(updated.name, updated.currency, timestamp, actorId, bookId)
      .run();
    return updated;
  }

  async deleteBook(bookId: string, actorId = systemActorId) {
    const timestamp = now();
    await this.db
      .prepare("UPDATE books SET deleted_at = ?, deleted_by_user_id = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ?")
      .bind(timestamp, actorId, timestamp, actorId, bookId)
      .run();
  }

  async exportBook(bookId: string) {
    const book = await this.getBook(bookId);
    if (!book) return null;
    const [members, transactions, categories, tags, invitations] = await Promise.all([
      this.listMembers(bookId),
      this.listTransactions(bookId),
      this.listSimple("categories", bookId),
      this.listSimple("tags", bookId),
      this.listInvitations(bookId),
    ]);
    return { exportedAt: now(), book, members, transactions, categories, tags, invitations };
  }

  async listMembers(bookId: string) {
    const result = await this.db
      .prepare(
        `SELECT bm.id,bm.book_id AS bookId,bm.user_id AS userId,u.name,bm.role,bm.joined_at AS joinedAt
         FROM book_members bm JOIN users u ON u.id = bm.user_id WHERE bm.book_id = ? AND bm.deleted_at IS NULL ORDER BY bm.joined_at`,
      )
      .bind(bookId)
      .all<Row>();
    return result.results.map(mapMember);
  }

  async updateMemberRole(bookId: string, memberId: string, role: "admin" | "member", actorId = systemActorId) {
    const row = await this.db
      .prepare(
        `SELECT bm.id,bm.book_id AS bookId,bm.user_id AS userId,u.name,bm.role,bm.joined_at AS joinedAt
         FROM book_members bm JOIN users u ON u.id = bm.user_id WHERE bm.id = ? AND bm.book_id = ? AND bm.deleted_at IS NULL`,
      )
      .bind(memberId, bookId)
      .first<Row>();
    if (!row || row.role === "creator") return null;
    await this.db
      .prepare("UPDATE book_members SET role = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ?")
      .bind(role, now(), actorId, memberId)
      .run();
    return mapMember({ ...row, role });
  }

  async removeMember(bookId: string, memberId: string, actorId = systemActorId) {
    const row = await this.db
      .prepare(
        `SELECT bm.id,bm.book_id AS bookId,bm.user_id AS userId,u.name,bm.role,bm.joined_at AS joinedAt
         FROM book_members bm JOIN users u ON u.id = bm.user_id WHERE bm.id = ? AND bm.book_id = ? AND bm.deleted_at IS NULL`,
      )
      .bind(memberId, bookId)
      .first<Row>();
    if (!row || row.role === "creator") return null;
    const timestamp = now();
    await this.db
      .prepare("UPDATE book_members SET deleted_at=?,deleted_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE id = ? AND book_id = ?")
      .bind(timestamp, actorId, timestamp, actorId, memberId, bookId)
      .run();
    return mapMember(row);
  }

  async removeMemberByUser(bookId: string, userId: string) {
    const row = await this.db
      .prepare(
        `SELECT bm.id,bm.book_id AS bookId,bm.user_id AS userId,u.name,bm.role,bm.joined_at AS joinedAt
         FROM book_members bm JOIN users u ON u.id = bm.user_id WHERE bm.user_id = ? AND bm.book_id = ? AND bm.deleted_at IS NULL`,
      )
      .bind(userId, bookId)
      .first<Row>();
    if (!row || row.role === "creator") return null;
    const timestamp = now();
    await this.db
      .prepare("UPDATE book_members SET deleted_at=?,deleted_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE user_id = ? AND book_id = ?")
      .bind(timestamp, userId, timestamp, userId, userId, bookId)
      .run();
    return mapMember(row);
  }

  private async mapTransaction(row: Row): Promise<Transaction> {
    const [tags, items] = await this.db.batch([
      this.db.prepare("SELECT tag_id AS id FROM transaction_tags WHERE transaction_id = ? AND deleted_at IS NULL").bind(row.id),
      this.db
        .prepare(
          "SELECT id,name,amount_cents / 100.0 AS amount,category_id AS categoryId,note FROM transaction_items WHERE transaction_id = ? AND deleted_at IS NULL ORDER BY created_at",
        )
        .bind(row.id),
    ]);
    return {
      id: row.id,
      bookId: row.bookId,
      type: row.type,
      amount: row.amount,
      ...(row.categoryId ? { categoryId: row.categoryId } : {}),
      ...(row.memberId ? { memberId: row.memberId } : {}),
      createdByUserId: row.createdByUserId,
      ...(row.note ? { note: row.note } : {}),
      occurredAt: row.occurredAt,
      tagIds: (tags.results as Row[]).map((tag) => tag.id),
      items: items.results as Transaction["items"],
    };
  }

  private transactionSelect = `SELECT id,book_id AS bookId,type,amount_cents / 100.0 AS amount,category_id AS categoryId,member_id AS memberId,created_by_user_id AS createdByUserId,note,occurred_at AS occurredAt FROM transactions`;

  async listTransactions(bookId: string) {
    const result = await this.db
      .prepare(
        `${this.transactionSelect} WHERE book_id = ? AND deleted_at IS NULL ORDER BY occurred_at DESC, created_at DESC`,
      )
      .bind(bookId)
      .all<Row>();
    return Promise.all(result.results.map((row) => this.mapTransaction(row)));
  }

  async getTransaction(transactionId: string) {
    const row = await this.db
      .prepare(`${this.transactionSelect} WHERE id = ? AND deleted_at IS NULL`)
      .bind(transactionId)
      .first<Row>();
    return row ? this.mapTransaction(row) : null;
  }

  async createTransaction(
    bookId: string,
    userId: string,
    input: Omit<Transaction, "id" | "bookId" | "createdByUserId">,
  ) {
    const timestamp = now();
    const transaction: Transaction = {
      ...input,
      id: id("transaction"),
      bookId,
      createdByUserId: userId,
      items: input.items.map((item) => ({ ...item, id: id("item") })),
    };
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          "INSERT INTO transactions (id,book_id,type,amount_cents,category_id,account_id,member_id,created_by_user_id,updated_by_user_id,note,occurred_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          transaction.id,
          bookId,
          transaction.type,
          Math.round(transaction.amount * 100),
          transaction.categoryId ?? null,
          null,
          transaction.memberId ?? null,
          userId,
          userId,
          transaction.note ?? null,
          transaction.occurredAt,
          timestamp,
          timestamp,
        ),
    ];
    for (const tagId of transaction.tagIds)
      statements.push(
        this.db
          .prepare("INSERT INTO transaction_tags (transaction_id,tag_id,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?)")
          .bind(transaction.id, tagId, userId, userId, timestamp, timestamp),
      );
    for (const item of transaction.items)
      statements.push(
        this.db
          .prepare(
            "INSERT INTO transaction_items (id,transaction_id,name,amount_cents,category_id,note,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            item.id,
            transaction.id,
            item.name,
            Math.round(item.amount * 100),
            item.categoryId ?? null,
            item.note ?? null,
            userId,
            userId,
            timestamp,
            timestamp,
          ),
      );
    await this.db.batch(statements);
    return transaction;
  }

  async updateTransaction(
    transactionId: string,
    input: Omit<Transaction, "id" | "bookId" | "createdByUserId">,
    actorId = systemActorId,
  ) {
    const current = await this.getTransaction(transactionId);
    if (!current) return null;
    const timestamp = now();
    const transaction: Transaction = {
      ...current,
      ...input,
      id: current.id,
      bookId: current.bookId,
      createdByUserId: current.createdByUserId,
      items: input.items.map((item) => ({ ...item, id: id("item") })),
    };
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          "UPDATE transactions SET type=?,amount_cents=?,category_id=?,account_id=?,member_id=?,note=?,occurred_at=?,updated_at=?,updated_by_user_id=? WHERE id=?",
        )
        .bind(
          transaction.type,
          Math.round(transaction.amount * 100),
          transaction.categoryId ?? null,
          null,
          transaction.memberId ?? null,
          transaction.note ?? null,
          transaction.occurredAt,
          timestamp,
          actorId,
          transactionId,
        ),
      this.db
        .prepare("UPDATE transaction_tags SET deleted_at=?,deleted_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE transaction_id = ? AND deleted_at IS NULL")
        .bind(timestamp, actorId, timestamp, actorId, transactionId),
      this.db
        .prepare("UPDATE transaction_items SET deleted_at=?,deleted_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE transaction_id = ? AND deleted_at IS NULL")
        .bind(timestamp, actorId, timestamp, actorId, transactionId),
    ];
    for (const tagId of transaction.tagIds)
      statements.push(
        this.db
          .prepare("INSERT INTO transaction_tags (transaction_id,tag_id,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?)")
          .bind(transactionId, tagId, actorId, actorId, timestamp, timestamp),
      );
    for (const item of transaction.items)
      statements.push(
        this.db
          .prepare(
            "INSERT INTO transaction_items (id,transaction_id,name,amount_cents,category_id,note,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            item.id,
            transactionId,
            item.name,
            Math.round(item.amount * 100),
            item.categoryId ?? null,
            item.note ?? null,
            actorId,
            actorId,
            timestamp,
            timestamp,
          ),
      );
    await this.db.batch(statements);
    return transaction;
  }

  async deleteTransaction(transactionId: string, actorId = systemActorId) {
    const timestamp = now();
    await this.db
      .prepare("UPDATE transactions SET deleted_at = ?, deleted_by_user_id = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ?")
      .bind(timestamp, actorId, timestamp, actorId, transactionId)
      .run();
  }

  private tableFor(kind: "categories" | "tags") {
    return kind;
  }

  async listSimple(kind: "categories" | "tags", bookId: string) {
    const columns =
      kind === "categories"
        ? "id,book_id AS bookId,name,type,icon,sort_order AS sortOrder"
        : "id,book_id AS bookId,name,color";
    const result = await this.db
      .prepare(`SELECT ${columns} FROM ${this.tableFor(kind)} WHERE book_id = ? AND deleted_at IS NULL ORDER BY created_at`)
      .bind(bookId)
      .all<Row>();
    return result.results.map(mapSimple);
  }

  async findCategoryByName(bookId: string, name?: string) {
    if (!name) return null;
    const row = await this.db
      .prepare(
        "SELECT id,book_id AS bookId,name,type,icon,sort_order AS sortOrder FROM categories WHERE book_id = ? AND name = ? AND deleted_at IS NULL LIMIT 1",
      )
      .bind(bookId, name)
      .first<Row>();
    return row ? mapSimple(row) : null;
  }

  async findOrCreateCategory(bookId: string, name: string, type: "income" | "expense") {
    const existing = await this.findCategoryByName(bookId, name);
    if (existing) return existing;
    return this.createSimple("categories", bookId, {
      name,
      type,
      icon: type === "income" ? "wallet" : "tag",
      sortOrder: 0,
    });
  }

  async searchTransactions(
    bookId: string,
    filters: {
      type?: "income" | "expense";
      minAmount?: number;
      maxAmount?: number;
      from?: string;
      to?: string;
      categoryId?: string;
      categoryName?: string;
      q?: string;
      sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
    },
  ) {
    const clauses = ["book_id = ?", "deleted_at IS NULL"];
    const values: unknown[] = [bookId];
    if (filters.type) {
      clauses.push("type = ?");
      values.push(filters.type);
    }
    if (filters.minAmount !== undefined) {
      clauses.push("amount_cents > ?");
      values.push(Math.round(filters.minAmount * 100));
    }
    if (filters.maxAmount !== undefined) {
      clauses.push("amount_cents < ?");
      values.push(Math.round(filters.maxAmount * 100));
    }
    if (filters.from) {
      clauses.push("occurred_at >= ?");
      values.push(filters.from);
    }
    if (filters.to) {
      clauses.push("occurred_at <= ?");
      values.push(filters.to);
    }
    if (filters.categoryId) {
      clauses.push("category_id = ?");
      values.push(filters.categoryId);
    }
    if (filters.categoryName) {
      clauses.push("category_id IN (SELECT id FROM categories WHERE book_id = ? AND name = ? AND deleted_at IS NULL)");
      values.push(bookId, filters.categoryName);
    }
    if (filters.q) {
      const keyword = `%${escapeLike(filters.q)}%`;
      clauses.push(
        `(note LIKE ? ESCAPE '\\' OR EXISTS (
          SELECT 1 FROM transaction_items
          WHERE transaction_items.transaction_id = transactions.id
            AND transaction_items.deleted_at IS NULL
            AND (name LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\')
        ))`,
      );
      values.push(keyword, keyword, keyword);
    }
    const orderBy = {
      date_desc: "occurred_at DESC, created_at DESC",
      date_asc: "occurred_at ASC, created_at ASC",
      amount_desc: "amount_cents DESC, occurred_at DESC",
      amount_asc: "amount_cents ASC, occurred_at DESC",
    }[filters.sort ?? "date_desc"];
    const result = await this.db
      .prepare(`${this.transactionSelect} WHERE ${clauses.join(" AND ")} ORDER BY ${orderBy}`)
      .bind(...values)
      .all<Row>();
    return Promise.all(result.results.map((row) => this.mapTransaction(row)));
  }

  async findMember(bookId: string, userId: string) {
    const row = await this.db
      .prepare(
        "SELECT id,book_id AS bookId,user_id AS userId FROM book_members WHERE book_id = ? AND user_id = ? AND deleted_at IS NULL",
      )
      .bind(bookId, userId)
      .first<Row>();
    return row;
  }

  async getSimple(kind: "categories" | "tags", entityId: string) {
    const columns =
      kind === "categories"
        ? "id,book_id AS bookId,name,type,icon,sort_order AS sortOrder"
        : "id,book_id AS bookId,name,color";
    const result = await this.db
      .prepare(`SELECT ${columns} FROM ${this.tableFor(kind)} WHERE id = ? AND deleted_at IS NULL`)
      .bind(entityId)
      .first<Row>();
    return result ? mapSimple(result) : null;
  }

  async createSimple(kind: "categories" | "tags", bookId: string, data: Omit<SimpleEntity, "id" | "bookId">, actorId = systemActorId) {
    const timestamp = now();
    const entity: SimpleEntity = { ...data, id: id(kind.slice(0, -1)), bookId };
    if (kind === "categories")
      await this.db
        .prepare(
          "INSERT INTO categories (id,book_id,name,type,icon,sort_order,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          entity.id,
          bookId,
          entity.name,
          entity.type,
          entity.icon,
          entity.sortOrder ?? 0,
          actorId,
          actorId,
          timestamp,
          timestamp,
        )
        .run();
    else if (kind === "tags")
      await this.db
        .prepare("INSERT INTO tags (id,book_id,name,color,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(entity.id, bookId, entity.name, entity.color, actorId, actorId, timestamp, timestamp)
        .run();
    return entity;
  }

  async updateSimple(
    kind: "categories" | "tags",
    entityId: string,
    data: Omit<SimpleEntity, "id" | "bookId">,
    actorId = systemActorId,
  ) {
    const current = await this.getSimple(kind, entityId);
    if (!current) return null;
    const entity = { ...current, ...data };
    if (kind === "categories")
      await this.db
        .prepare("UPDATE categories SET name=?,type=?,icon=?,sort_order=?,updated_at=?,updated_by_user_id=? WHERE id=?")
        .bind(entity.name, entity.type, entity.icon, entity.sortOrder ?? 0, now(), actorId, entityId)
        .run();
    else if (kind === "tags")
      await this.db
        .prepare("UPDATE tags SET name=?,color=?,updated_at=?,updated_by_user_id=? WHERE id=?")
        .bind(entity.name, entity.color, now(), actorId, entityId)
        .run();
    return entity;
  }

  async deleteSimple(kind: "categories" | "tags", entityId: string, actorId = systemActorId) {
    const timestamp = now();
    if (kind === "categories") {
      await this.db.batch([
        this.db.prepare("UPDATE transactions SET category_id=NULL, updated_at=?, updated_by_user_id=? WHERE category_id=?").bind(timestamp, actorId, entityId),
        this.db.prepare("UPDATE transaction_items SET category_id=NULL, updated_at=?, updated_by_user_id=? WHERE category_id=?").bind(timestamp, actorId, entityId),
        this.db.prepare("UPDATE categories SET deleted_at=?,deleted_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE id=?").bind(timestamp, actorId, timestamp, actorId, entityId),
      ]);
      return;
    }
    await this.db.batch([
      this.db.prepare("UPDATE transaction_tags SET deleted_at=?,deleted_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE tag_id=? AND deleted_at IS NULL").bind(timestamp, actorId, timestamp, actorId, entityId),
      this.db.prepare("UPDATE tags SET deleted_at=?,deleted_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE id=?").bind(timestamp, actorId, timestamp, actorId, entityId),
    ]);
  }

  async listInvitations(bookId: string) {
    const result = await this.db
      .prepare(
        "SELECT id,book_id AS bookId,inviter_user_id AS inviterUserId,invitee_email AS inviteeEmail,invitee_phone AS inviteePhone,invitee_user_id AS inviteeUserId,role,status,expires_at AS expiresAt,last_reminded_at AS lastRemindedAt FROM invitations WHERE book_id=? AND deleted_at IS NULL ORDER BY created_at DESC",
      )
      .bind(bookId)
      .all<Row>();
    return result.results.map(mapInvitation);
  }

  async listReceivedInvitations(userId: string) {
    const user = await this.db
      .prepare("SELECT email,phone FROM users WHERE id = ?")
      .bind(userId)
      .first<{ email: string | null; phone: string | null }>();
    const result = await this.db
      .prepare(
        "SELECT id,book_id AS bookId,inviter_user_id AS inviterUserId,invitee_email AS inviteeEmail,invitee_phone AS inviteePhone,invitee_user_id AS inviteeUserId,role,status,expires_at AS expiresAt,last_reminded_at AS lastRemindedAt FROM invitations WHERE deleted_at IS NULL AND (invitee_user_id=? OR (invitee_email IS NOT NULL AND invitee_email=?) OR (invitee_phone IS NOT NULL AND invitee_phone=?)) ORDER BY created_at DESC",
      )
      .bind(userId, user?.email ?? "", user?.phone ?? "")
      .all<Row>();
    return result.results.map(mapInvitation);
  }

  async getInvitation(invitationId: string) {
    const row = await this.db
      .prepare(
        "SELECT id,book_id AS bookId,inviter_user_id AS inviterUserId,invitee_email AS inviteeEmail,invitee_phone AS inviteePhone,invitee_user_id AS inviteeUserId,role,status,expires_at AS expiresAt,last_reminded_at AS lastRemindedAt FROM invitations WHERE id=? AND deleted_at IS NULL",
      )
      .bind(invitationId)
      .first<Row>();
    return row ? mapInvitation(row) : null;
  }

  async createInvitation(input: Omit<Invitation, "id" | "status" | "expiresAt">) {
    const timestamp = now();
    const invitation: Invitation = {
      ...input,
      id: id("invitation"),
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    };
    await this.db
      .prepare(
        "INSERT INTO invitations (id,book_id,inviter_user_id,invitee_email,invitee_phone,invitee_user_id,role,status,expires_at,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        invitation.id,
        invitation.bookId,
        invitation.inviterUserId,
        invitation.inviteeEmail ?? null,
        invitation.inviteePhone ?? null,
        invitation.inviteeUserId ?? null,
        invitation.role,
        invitation.status,
        invitation.expiresAt,
        invitation.inviterUserId,
        invitation.inviterUserId,
        timestamp,
        timestamp,
      )
      .run();
    return invitation;
  }

  async findPendingInvitation(bookId: string, email?: string, phone?: string, userId?: string) {
    return this.db
      .prepare(
        "SELECT id,book_id AS bookId,inviter_user_id AS inviterUserId,invitee_email AS inviteeEmail,invitee_phone AS inviteePhone,invitee_user_id AS inviteeUserId,role,status,expires_at AS expiresAt,last_reminded_at AS lastRemindedAt FROM invitations WHERE book_id=? AND status='pending' AND deleted_at IS NULL AND ((? != '' AND invitee_email=?) OR (? != '' AND invitee_phone=?) OR (? != '' AND invitee_user_id=?)) LIMIT 1",
      )
      .bind(bookId, email ?? "", email ?? "", phone ?? "", phone ?? "", userId ?? "", userId ?? "")
      .first<Row>()
      .then((row) => (row ? mapInvitation(row) : null));
  }
  async updateInvitation(
    invitationId: string,
    fields: Partial<Pick<Invitation, "status" | "inviteeUserId" | "lastRemindedAt">>,
    actorId = systemActorId,
  ) {
    const invitation = await this.getInvitation(invitationId);
    if (!invitation) return null;
    const changed = { ...invitation, ...fields };
    await this.db
      .prepare("UPDATE invitations SET status=?,invitee_user_id=?,last_reminded_at=?,updated_at=?,updated_by_user_id=? WHERE id=?")
      .bind(
        changed.status,
        changed.inviteeUserId ?? null,
        changed.lastRemindedAt ?? null,
        now(),
        actorId,
        invitationId,
      )
      .run();
    return changed;
  }
  async addMember(bookId: string, userId: string, role: "admin" | "member", actorId = systemActorId) {
    const timestamp = now();
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO book_members (id,book_id,user_id,role,joined_at,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .bind(id("member"), bookId, userId, role, timestamp, actorId, actorId, timestamp, timestamp)
      .run();
  }

  async createImportJob(input: Omit<ImportJob, "id" | "status" | "createdAt" | "updatedAt">) {
    const timestamp = now();
    const job: ImportJob = {
      ...input,
      id: id("import"),
      status: "uploaded",
      cancelable: false,
      retryable: false,
      retryCount: 0,
      convertEventSequence: 0,
      ocrProgress: 0,
      ocrEventSequence: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db
      .prepare(
        "INSERT INTO import_jobs (id,book_id,user_id,file_name,file_type,r2_key,status,auto_confirm,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        job.id,
        job.bookId,
        job.userId,
        job.fileName,
        job.fileType,
        job.r2Key,
        job.status,
        job.autoConfirm ? 1 : 0,
        job.userId,
        job.userId,
        timestamp,
        timestamp,
      )
      .run();
    return job;
  }
  async cleanupExpiredImportJobs() {
    const timestamp = now();
    await this.db
      .prepare("UPDATE import_jobs SET deleted_at=?,deleted_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE deleted_at IS NULL AND created_at < ?")
      .bind(timestamp, systemActorId, timestamp, systemActorId, importJobCutoff())
      .run();
  }
  async listImportJobs(bookId: string, input: { status?: ImportJobStatusFilter } = {}) {
    await this.cleanupExpiredImportJobs();
    const clauses = ["book_id=?", "deleted_at IS NULL", "created_at >= ?"];
    const values: unknown[] = [bookId, importJobCutoff()];
    const status = input.status ?? "all";
    if (status === "processing") clauses.push("status NOT IN ('completed','pending_confirmation','failed','cancelled')");
    if (status === "success") clauses.push("status IN ('completed','pending_confirmation')");
    if (status === "failed") clauses.push("status = 'failed'");
    const result = await this.db
      .prepare(`SELECT ${importJobColumns} FROM import_jobs WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`)
      .bind(...values)
      .all<Row>();
    return result.results.map(mapImportJob);
  }
  async listImportJobsForUser(userId: string) {
    await this.cleanupExpiredImportJobs();
    const result = await this.db
      .prepare(`SELECT ${importJobColumns} FROM import_jobs WHERE user_id=? AND deleted_at IS NULL AND created_at >= ? ORDER BY created_at DESC`)
      .bind(userId, importJobCutoff())
      .all<Row>();
    return result.results.map(mapImportJob);
  }
  async getImportJob(jobId: string) {
    const row = await this.db
      .prepare(`SELECT ${importJobColumns} FROM import_jobs WHERE id=? AND deleted_at IS NULL`)
      .bind(jobId)
      .first<Row>();
    return row ? mapImportJob(row) : null;
  }
  async updateImportJob(jobId: string, status: string, errorMessage?: string) {
    const terminal = ["completed", "pending_confirmation", "failed", "cancelled"].includes(status) ? 1 : 0;
    const timestamp = now();
    await this.db
      .prepare(
        "UPDATE import_jobs SET status=?,error_message=?,cancelable=CASE WHEN ? THEN 0 ELSE cancelable END,retryable=CASE WHEN ? THEN 0 ELSE retryable END,updated_at=?,updated_by_user_id=? WHERE id=?",
      )
      .bind(status, errorMessage ?? null, terminal, terminal, timestamp, systemActorId, jobId)
      .run();
    return this.getImportJob(jobId);
  }
  async attachOcrJob(jobId: string, ocrJobId: string) {
    await this.db
      .prepare(
        "UPDATE import_jobs SET status=?,ocr_job_id=?,ocr_submitted_at=?,ocr_progress=0,ocr_stage=?,ocr_event_sequence=0,error_message=NULL,error_code=NULL,error_stage=NULL,error_request_id=NULL,error_retryable=0,error_terminal=0,failed_external_job_id=NULL,cancelable=1,retryable=1,updated_at=? WHERE id=?",
      )
      .bind("ocr_processing", ocrJobId, now(), "queued", now(), jobId)
      .run();
    return this.getImportJob(jobId);
  }
  async attachConvertJob(jobId: string, convertJobId: string) {
    await this.db
      .prepare(
        "UPDATE import_jobs SET status=?,convert_job_id=?,convert_event_sequence=0,ocr_progress=0,ocr_stage=?,error_message=NULL,error_code=NULL,error_stage=NULL,error_request_id=NULL,error_retryable=0,error_terminal=0,failed_external_job_id=NULL,cancelable=1,retryable=1,updated_at=? WHERE id=?",
      )
      .bind("converting", convertJobId, "queued", now(), jobId)
      .run();
    return this.getImportJob(jobId);
  }
  async attachConvertedFile(jobId: string, input: { r2Key: string; fileType: string }) {
    await this.db
      .prepare("UPDATE import_jobs SET converted_r2_key=?,converted_file_type=?,updated_at=? WHERE id=?")
      .bind(input.r2Key, input.fileType, now(), jobId)
      .run();
    return this.getImportJob(jobId);
  }
  async updateOcrProgress(
    jobId: string,
    input: {
      progress?: number;
      stage?: string;
      currentPage?: number | null;
      totalPages?: number | null;
      completedAt?: string | null;
      eventSequence?: number;
    },
  ) {
    const timestamp = now();
    const updates = ["updated_at=?"];
    const values: unknown[] = [timestamp];
    if (input.progress !== undefined) {
      updates.unshift("ocr_progress=?");
      values.unshift(input.progress);
    }
    if (input.stage !== undefined) {
      updates.unshift("ocr_stage=?");
      values.unshift(input.stage);
    }
    if (input.currentPage !== undefined) {
      updates.unshift("ocr_current_page=?");
      values.unshift(input.currentPage);
    }
    if (input.totalPages !== undefined) {
      updates.unshift("ocr_total_pages=?");
      values.unshift(input.totalPages);
    }
    if (input.completedAt !== undefined) {
      updates.unshift("ocr_completed_at=?");
      values.unshift(input.completedAt);
    }
    if (input.eventSequence !== undefined) {
      updates.unshift("ocr_event_sequence=MAX(ocr_event_sequence, ?)");
      values.unshift(input.eventSequence);
    }
    await this.db
      .prepare(`UPDATE import_jobs SET ${updates.join(",")} WHERE id=?`)
      .bind(...values, jobId)
      .run();
    return this.getImportJob(jobId);
  }
  async updateAlephState(
    jobId: string,
    input: {
      phase: "convert" | "ocr";
      progress?: number;
      stage?: string;
      currentPage?: number | null;
      totalPages?: number | null;
      completedAt?: string | null;
      eventSequence?: number;
      cancelable?: boolean;
      retryable?: boolean;
    },
  ) {
    const timestamp = now();
    const updates = ["updated_at=?"];
    const values: unknown[] = [timestamp];
    if (input.progress !== undefined) {
      updates.unshift("ocr_progress=?");
      values.unshift(input.progress);
    }
    if (input.stage !== undefined) {
      updates.unshift("ocr_stage=?");
      values.unshift(input.stage);
    }
    if (input.currentPage !== undefined) {
      updates.unshift("ocr_current_page=?");
      values.unshift(input.currentPage);
    }
    if (input.totalPages !== undefined) {
      updates.unshift("ocr_total_pages=?");
      values.unshift(input.totalPages);
    }
    if (input.completedAt !== undefined) {
      updates.unshift("ocr_completed_at=?");
      values.unshift(input.completedAt);
    }
    if (input.cancelable !== undefined) {
      updates.unshift("cancelable=?");
      values.unshift(input.cancelable ? 1 : 0);
    }
    if (input.retryable !== undefined) {
      updates.unshift("retryable=?");
      values.unshift(input.retryable ? 1 : 0);
    }
    if (input.eventSequence !== undefined) {
      updates.unshift(
        input.phase === "convert"
          ? "convert_event_sequence=MAX(convert_event_sequence, ?)"
          : "ocr_event_sequence=MAX(ocr_event_sequence, ?)",
      );
      values.unshift(input.eventSequence);
    }
    await this.db
      .prepare(`UPDATE import_jobs SET ${updates.join(",")} WHERE id=?`)
      .bind(...values, jobId)
      .run();
    return this.getImportJob(jobId);
  }
  async markImportJobFailed(
    jobId: string,
    input: {
      message: string;
      code?: string;
      stage?: string;
      requestId?: string;
      retryable?: boolean;
      terminal?: boolean;
      externalJobId?: string;
    },
  ) {
    await this.db
      .prepare(
        "UPDATE import_jobs SET status='failed',error_message=?,error_code=?,error_stage=?,error_request_id=?,error_retryable=?,error_terminal=?,failed_external_job_id=?,cancelable=0,retryable=?,updated_at=? WHERE id=?",
      )
      .bind(
        input.message,
        input.code ?? null,
        input.stage ?? null,
        input.requestId ?? null,
        input.retryable ? 1 : 0,
        input.terminal ? 1 : 0,
        input.externalJobId ?? null,
        input.retryable ? 1 : 0,
        now(),
        jobId,
      )
      .run();
    return this.getImportJob(jobId);
  }
  async prepareImportJobRetry(jobId: string) {
    await this.db
      .prepare(
        "UPDATE import_jobs SET retry_count=retry_count+1,status='uploaded',convert_job_id=NULL,convert_event_sequence=0,ocr_job_id=NULL,ocr_submitted_at=NULL,ocr_progress=0,ocr_stage=NULL,ocr_current_page=NULL,ocr_total_pages=NULL,ocr_completed_at=NULL,ocr_event_sequence=0,error_message=NULL,error_code=NULL,error_stage=NULL,error_request_id=NULL,error_retryable=0,error_terminal=0,failed_external_job_id=NULL,cancelable=0,retryable=0,updated_at=? WHERE id=?",
      )
      .bind(now(), jobId)
      .run();
    return this.getImportJob(jobId);
  }
  async prepareImportJobAiRetry(jobId: string) {
    await this.db
      .prepare(
        "UPDATE import_jobs SET retry_count=retry_count+1,status='ai_processing',error_message=NULL,error_code=NULL,error_stage=NULL,error_request_id=NULL,error_retryable=0,error_terminal=0,failed_external_job_id=NULL,cancelable=0,retryable=0,updated_at=? WHERE id=?",
      )
      .bind(now(), jobId)
      .run();
    return this.getImportJob(jobId);
  }
  async createImportedRecords(
    jobId: string,
    suggestions: Array<{
      type: string;
      amount: number;
      occurredAt: string;
      note?: string;
      categoryName?: string;
      confidence: number;
      warnings: string[];
    }>,
  ) {
    const job = await this.getImportJob(jobId);
    const actorId = job?.userId ?? systemActorId;
    const timestamp = now();
    const records: ImportedRecord[] = suggestions.map((suggestedTransaction) => ({
      id: id("import_record"),
      importJobId: jobId,
      suggestedTransaction,
      status: "pending",
      confidence: suggestedTransaction.confidence,
      warnings: suggestedTransaction.warnings,
    }));
    await this.db.batch(
      records.map((record) =>
        this.db
          .prepare(
            "INSERT INTO imported_records (id,import_job_id,raw_data,suggested_transaction,status,confidence,warnings,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            record.id,
            jobId,
            "{}",
            JSON.stringify(record.suggestedTransaction),
            record.status,
            Math.round(record.confidence * 100),
            JSON.stringify(record.warnings),
            actorId,
            actorId,
            timestamp,
            timestamp,
          ),
      ),
    );
    return records;
  }
  async listImportedRecords(jobId: string) {
    const result = await this.db
      .prepare(
        "SELECT id,import_job_id AS importJobId,suggested_transaction AS suggestedTransaction,status,confidence,warnings FROM imported_records WHERE import_job_id=? AND deleted_at IS NULL ORDER BY created_at",
      )
      .bind(jobId)
      .all<Row>();
    return result.results.map(mapRecord);
  }
  async getImportedRecord(recordId: string) {
    const row = await this.db
      .prepare(
        "SELECT id,import_job_id AS importJobId,suggested_transaction AS suggestedTransaction,status,confidence,warnings FROM imported_records WHERE id=? AND deleted_at IS NULL",
      )
      .bind(recordId)
      .first<Row>();
    return row ? mapRecord(row) : null;
  }
  async updateImportedRecord(
    recordId: string,
    suggestion: Record<string, unknown>,
    status?: ImportedRecord["status"],
    actorId = systemActorId,
  ) {
    const record = await this.getImportedRecord(recordId);
    if (!record) return null;
    const updated = { ...record, suggestedTransaction: suggestion, status: status ?? record.status };
    await this.db
      .prepare("UPDATE imported_records SET suggested_transaction=?,status=?,updated_at=?,updated_by_user_id=? WHERE id=?")
      .bind(JSON.stringify(updated.suggestedTransaction), updated.status, now(), actorId, recordId)
      .run();
    return updated;
  }

  async createAiConfirmation(input: {
    userId: string;
    bookId?: string;
    action: AiConfirmation["action"];
    payload: Record<string, unknown>;
    expiresAt?: string;
  }) {
    const timestamp = now();
    const confirmation: AiConfirmation = {
      id: id("ai_confirmation"),
      userId: input.userId,
      ...(input.bookId ? { bookId: input.bookId } : {}),
      action: input.action,
      status: "pending",
      payload: input.payload,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 10 * 60_000).toISOString(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db
      .prepare(
        "INSERT INTO ai_confirmations (id,user_id,book_id,action,status,payload,expires_at,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        confirmation.id,
        confirmation.userId,
        confirmation.bookId ?? null,
        confirmation.action,
        confirmation.status,
        JSON.stringify(confirmation.payload),
        confirmation.expiresAt,
        confirmation.userId,
        confirmation.userId,
        timestamp,
        timestamp,
      )
      .run();
    return confirmation;
  }

  async getAiConfirmation(userId: string, confirmationId: string) {
    const row = await this.db
      .prepare(`SELECT ${aiConfirmationColumns} FROM ai_confirmations WHERE id=? AND user_id=? AND deleted_at IS NULL`)
      .bind(confirmationId, userId)
      .first<Row>();
    return row ? mapAiConfirmation(row) : null;
  }

  async findPendingAiInviteConfirmation(bookId: string, email?: string, phone?: string) {
    const rows = await this.db
      .prepare(
        `SELECT ${aiConfirmationColumns} FROM ai_confirmations WHERE book_id=? AND action='invite-member' AND status='pending' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`,
      )
      .bind(bookId)
      .all<Row>();
    const matched = rows.results
      .map(mapAiConfirmation)
      .find((confirmation) => {
        const payload = confirmation.payload as { email?: string; phone?: string };
        return Boolean((email && payload.email === email) || (phone && payload.phone === phone));
      });
    return matched ?? null;
  }

  async updateAiConfirmation(
    confirmationId: string,
    fields: {
      status: "pending" | "confirmed" | "cancelled";
      result?: Record<string, unknown>;
      confirmedAt?: string | null;
      cancelledAt?: string | null;
    },
    actorId = systemActorId,
  ) {
    const timestamp = now();
    await this.db
      .prepare(
        "UPDATE ai_confirmations SET status=?,result=?,confirmed_at=?,cancelled_at=?,updated_at=?,updated_by_user_id=? WHERE id=?",
      )
      .bind(
        fields.status,
        fields.result ? JSON.stringify(fields.result) : null,
        fields.confirmedAt ?? null,
        fields.cancelledAt ?? null,
        timestamp,
        actorId,
        confirmationId,
      )
      .run();
  }

  async createAiSession(userId: string, bookId: string | undefined, title: string) {
    const timestamp = now();
    const session = {
      id: id("ai_session"),
      userId,
      bookId,
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db
      .prepare(
        "INSERT INTO ai_sessions (id,user_id,book_id,title,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .bind(session.id, userId, bookId ?? null, title, userId, userId, timestamp, timestamp)
      .run();
    return session;
  }
  async updateAiSession(userId: string, sessionId: string, input: { title?: string; bookId?: string | null }) {
    const session = await this.getAiSession(userId, sessionId);
    if (!session) return null;
    const timestamp = now();
    const title = input.title ?? session.title;
    const bookId = input.bookId === undefined ? session.bookId : input.bookId;
    await this.db
      .prepare("UPDATE ai_sessions SET title=?,book_id=?,updated_at=?,updated_by_user_id=? WHERE id=? AND user_id=?")
      .bind(title, bookId ?? null, timestamp, userId, sessionId, userId)
      .run();
    return this.getAiSession(userId, sessionId);
  }
  async deleteAiSession(userId: string, sessionId: string) {
    const timestamp = now();
    await this.db.batch([
      this.db.prepare("UPDATE ai_confirmations SET deleted_at=?,deleted_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE user_id=? AND tool_call_id IN (SELECT id FROM ai_tool_calls WHERE session_id=?) AND deleted_at IS NULL").bind(timestamp, userId, timestamp, userId, userId, sessionId),
      this.db.prepare("UPDATE ai_tool_calls SET deleted_at=?,deleted_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE session_id=? AND user_id=? AND deleted_at IS NULL").bind(timestamp, userId, timestamp, userId, sessionId, userId),
      this.db.prepare("UPDATE ai_messages SET deleted_at=?,deleted_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE session_id=? AND deleted_at IS NULL").bind(timestamp, userId, timestamp, userId, sessionId),
      this.db.prepare("UPDATE ai_sessions SET deleted_at=?,deleted_by_user_id=?,updated_at=?,updated_by_user_id=? WHERE id=? AND user_id=?").bind(timestamp, userId, timestamp, userId, sessionId, userId),
    ]);
  }
  async appendAiMessage(
    sessionId: string,
    actorId: string,
    role: "user" | "assistant" | "system" | "tool",
    content: string,
    input?: { parts?: unknown[]; attachments?: unknown[] },
  ) {
    const timestamp = now();
    await this.db.batch([
      this.db
        .prepare("INSERT INTO ai_messages (id,session_id,role,content,parts,attachments,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(
          id("ai_message"),
          sessionId,
          role,
          content,
          input?.parts ? JSON.stringify(input.parts) : null,
          input?.attachments ? JSON.stringify(input.attachments) : null,
          actorId,
          actorId,
          timestamp,
          timestamp,
        ),
      this.db.prepare("UPDATE ai_sessions SET updated_at=?,updated_by_user_id=? WHERE id=?").bind(timestamp, actorId, sessionId),
    ]);
  }
  async listAiSessions(userId: string) {
    const result = await this.db
      .prepare(
        `SELECT ${aiSessionColumns} FROM ai_sessions WHERE user_id=? AND deleted_at IS NULL ORDER BY updated_at DESC`,
      )
      .bind(userId)
      .all<Row>();
    return result.results;
  }
  async getAiSession(userId: string, sessionId: string): Promise<(Row & { messages: Row[] }) | null> {
    const session = await this.db
      .prepare(
        `SELECT ${aiSessionColumns} FROM ai_sessions WHERE id=? AND user_id=? AND deleted_at IS NULL`,
      )
      .bind(sessionId, userId)
      .first<Row>();
    if (!session) return null;
    const messages = await this.db
      .prepare(
        `SELECT ${aiMessageColumns} FROM ai_messages WHERE session_id=? AND deleted_at IS NULL ORDER BY created_at`,
      )
      .bind(sessionId)
      .all<Row>();
    return { ...session, messages: messages.results as Row[] };
  }
  async createAiToolCall(input: {
    sessionId: string;
    userId: string;
    bookId?: string;
    toolName: string;
    status: string;
    args: Record<string, unknown>;
  }) {
    const timestamp = now();
    const toolCall = {
      id: id("ai_tool_call"),
      sessionId: input.sessionId,
      userId: input.userId,
      bookId: input.bookId,
      toolName: input.toolName,
      status: input.status,
      args: input.args,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db
      .prepare(
        "INSERT INTO ai_tool_calls (id,session_id,user_id,book_id,tool_name,status,args,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        toolCall.id,
        input.sessionId,
        input.userId,
        input.bookId ?? null,
        input.toolName,
        input.status,
        JSON.stringify(input.args),
        input.userId,
        input.userId,
        timestamp,
        timestamp,
      )
      .run();
    return toolCall;
  }
  async updateAiToolCall(
    toolCallId: string,
    input: { status: string; result?: Record<string, unknown>; errorMessage?: string },
    actorId = systemActorId,
  ) {
    await this.db
      .prepare("UPDATE ai_tool_calls SET status=?,result=?,error_message=?,updated_at=?,updated_by_user_id=? WHERE id=?")
      .bind(input.status, input.result ? JSON.stringify(input.result) : null, input.errorMessage ?? null, now(), actorId, toolCallId)
      .run();
  }
  async listRecentAiToolCalls(userId: string, sessionId: string, toolName?: string) {
    const clauses = ["user_id=?", "session_id=?", "deleted_at IS NULL"];
    const values: unknown[] = [userId, sessionId];
    if (toolName) {
      clauses.push("tool_name=?");
      values.push(toolName);
    }
    const result = await this.db
      .prepare(`SELECT ${aiToolCallColumns} FROM ai_tool_calls WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT 20`)
      .bind(...values)
      .all<Row>();
    return result.results.map((row) => ({
      ...row,
      args: parseJson(row.args) ?? {},
      result: parseJson(row.result) ?? undefined,
    }));
  }
}
