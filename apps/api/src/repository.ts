import type { AiProviderName } from "@shared-ledger/shared";
import type { Book, Member, Transaction } from "./types";
import type { ImportedRecord, ImportJob, Invitation, SimpleEntity } from "./store";

type Row = Record<string, any>;
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

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
});

const importJobColumns =
  "id,book_id AS bookId,user_id AS userId,file_name AS fileName,file_type AS fileType,r2_key AS r2Key,status,auto_confirm AS autoConfirm,error_message AS errorMessage,error_code AS errorCode,error_stage AS errorStage,error_request_id AS errorRequestId,error_retryable AS errorRetryable,error_terminal AS errorTerminal,failed_external_job_id AS failedExternalJobId,cancelable,retryable,retry_count AS retryCount,convert_job_id AS convertJobId,convert_event_sequence AS convertEventSequence,converted_r2_key AS convertedR2Key,converted_file_type AS convertedFileType,ocr_job_id AS ocrJobId,ocr_submitted_at AS ocrSubmittedAt,ocr_progress AS ocrProgress,ocr_stage AS ocrStage,ocr_current_page AS ocrCurrentPage,ocr_total_pages AS ocrTotalPages,ocr_completed_at AS ocrCompletedAt,ocr_event_sequence AS ocrEventSequence,created_at AS createdAt,updated_at AS updatedAt";

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
        "SELECT provider,model,api_key_ref AS apiKeyRef,base_url AS baseUrl FROM ai_provider_configs WHERE user_id = ?",
      )
      .bind(userId)
      .first<{ provider: AiProviderName; model: string; apiKeyRef: string | null; baseUrl: string | null }>();
    return row ? { ...row, apiKeyRef: row.apiKeyRef ?? undefined, baseUrl: row.baseUrl ?? undefined } : null;
  }

  async ensureAiProviderConfig(userId: string) {
    const timestamp = now();
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO ai_provider_configs (user_id,provider,model,created_at,updated_at) VALUES (?,?,?,?,?)",
      )
      .bind(userId, "workers-ai", "@cf/meta/llama-3.1-8b-instruct", timestamp, timestamp)
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
        `INSERT INTO ai_provider_configs (user_id,provider,model,api_key_ref,base_url,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,api_key_ref=excluded.api_key_ref,base_url=excluded.base_url,updated_at=excluded.updated_at`,
      )
      .bind(
        userId,
        config.provider,
        config.model,
        config.apiKeyRef ?? null,
        config.baseUrl ?? null,
        timestamp,
        timestamp,
      )
      .run();
    return this.getAiProviderConfig(userId);
  }

  async role(bookId: string, userId: string) {
    const result = await this.db
      .prepare("SELECT role FROM book_members WHERE book_id = ? AND user_id = ?")
      .bind(bookId, userId)
      .first<{ role: Member["role"] }>();
    return result?.role;
  }

  async listBooks(userId: string) {
    const result = await this.db
      .prepare(
        `SELECT b.id,b.name,b.currency,b.created_by_user_id AS createdByUserId,b.created_at AS createdAt,b.updated_at AS updatedAt
         FROM books b JOIN book_members bm ON bm.book_id = b.id
         WHERE bm.user_id = ? AND b.deleted_at IS NULL ORDER BY b.updated_at DESC`,
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
          "INSERT INTO books (id,name,currency,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(book.id, book.name, book.currency, userId, timestamp, timestamp),
      this.db
        .prepare(
          "INSERT INTO book_members (id,book_id,user_id,role,joined_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(id("member"), book.id, userId, "creator", timestamp, timestamp, timestamp),
    ]);
    return book;
  }

  async updateBook(bookId: string, input: Partial<Pick<Book, "name" | "currency">>) {
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
      .prepare("UPDATE books SET name = ?, currency = ?, updated_at = ? WHERE id = ?")
      .bind(updated.name, updated.currency, timestamp, bookId)
      .run();
    return updated;
  }

  async deleteBook(bookId: string) {
    await this.db
      .prepare("UPDATE books SET deleted_at = ?, updated_at = ? WHERE id = ?")
      .bind(now(), now(), bookId)
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
         FROM book_members bm JOIN users u ON u.id = bm.user_id WHERE bm.book_id = ? ORDER BY bm.joined_at`,
      )
      .bind(bookId)
      .all<Row>();
    return result.results.map(mapMember);
  }

  async updateMemberRole(bookId: string, memberId: string, role: "admin" | "member") {
    const row = await this.db
      .prepare(
        `SELECT bm.id,bm.book_id AS bookId,bm.user_id AS userId,u.name,bm.role,bm.joined_at AS joinedAt
         FROM book_members bm JOIN users u ON u.id = bm.user_id WHERE bm.id = ? AND bm.book_id = ?`,
      )
      .bind(memberId, bookId)
      .first<Row>();
    if (!row || row.role === "creator") return null;
    await this.db
      .prepare("UPDATE book_members SET role = ?, updated_at = ? WHERE id = ?")
      .bind(role, now(), memberId)
      .run();
    return mapMember({ ...row, role });
  }

  private async mapTransaction(row: Row): Promise<Transaction> {
    const [tags, items] = await this.db.batch([
      this.db.prepare("SELECT tag_id AS id FROM transaction_tags WHERE transaction_id = ?").bind(row.id),
      this.db
        .prepare(
          "SELECT id,name,amount_cents / 100.0 AS amount,category_id AS categoryId,note FROM transaction_items WHERE transaction_id = ? ORDER BY created_at",
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
          "INSERT INTO transactions (id,book_id,type,amount_cents,category_id,account_id,member_id,created_by_user_id,note,occurred_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
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
          transaction.note ?? null,
          transaction.occurredAt,
          timestamp,
          timestamp,
        ),
    ];
    for (const tagId of transaction.tagIds)
      statements.push(
        this.db
          .prepare("INSERT INTO transaction_tags (transaction_id,tag_id) VALUES (?,?)")
          .bind(transaction.id, tagId),
      );
    for (const item of transaction.items)
      statements.push(
        this.db
          .prepare(
            "INSERT INTO transaction_items (id,transaction_id,name,amount_cents,category_id,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
          )
          .bind(
            item.id,
            transaction.id,
            item.name,
            Math.round(item.amount * 100),
            item.categoryId ?? null,
            item.note ?? null,
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
      items: input.items.map((item) => ({ ...item, id: item.id || id("item") })),
    };
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          "UPDATE transactions SET type=?,amount_cents=?,category_id=?,account_id=?,member_id=?,note=?,occurred_at=?,updated_at=? WHERE id=?",
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
          transactionId,
        ),
      this.db.prepare("DELETE FROM transaction_tags WHERE transaction_id = ?").bind(transactionId),
      this.db.prepare("DELETE FROM transaction_items WHERE transaction_id = ?").bind(transactionId),
    ];
    for (const tagId of transaction.tagIds)
      statements.push(
        this.db
          .prepare("INSERT INTO transaction_tags (transaction_id,tag_id) VALUES (?,?)")
          .bind(transactionId, tagId),
      );
    for (const item of transaction.items)
      statements.push(
        this.db
          .prepare(
            "INSERT INTO transaction_items (id,transaction_id,name,amount_cents,category_id,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
          )
          .bind(
            item.id,
            transactionId,
            item.name,
            Math.round(item.amount * 100),
            item.categoryId ?? null,
            item.note ?? null,
            timestamp,
            timestamp,
          ),
      );
    await this.db.batch(statements);
    return transaction;
  }

  async deleteTransaction(transactionId: string) {
    await this.db
      .prepare("UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ?")
      .bind(now(), now(), transactionId)
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
      .prepare(`SELECT ${columns} FROM ${this.tableFor(kind)} WHERE book_id = ? ORDER BY created_at`)
      .bind(bookId)
      .all<Row>();
    return result.results.map(mapSimple);
  }

  async findCategoryByName(bookId: string, name?: string) {
    if (!name) return null;
    const row = await this.db
      .prepare(
        "SELECT id,book_id AS bookId,name,type,icon,sort_order AS sortOrder FROM categories WHERE book_id = ? AND name = ? LIMIT 1",
      )
      .bind(bookId, name)
      .first<Row>();
    return row ? mapSimple(row) : null;
  }

  async findMember(bookId: string, userId: string) {
    const row = await this.db
      .prepare(
        "SELECT id,book_id AS bookId,user_id AS userId FROM book_members WHERE book_id = ? AND user_id = ?",
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
      .prepare(`SELECT ${columns} FROM ${this.tableFor(kind)} WHERE id = ?`)
      .bind(entityId)
      .first<Row>();
    return result ? mapSimple(result) : null;
  }

  async createSimple(kind: "categories" | "tags", bookId: string, data: Omit<SimpleEntity, "id" | "bookId">) {
    const timestamp = now();
    const entity: SimpleEntity = { ...data, id: id(kind.slice(0, -1)), bookId };
    if (kind === "categories")
      await this.db
        .prepare(
          "INSERT INTO categories (id,book_id,name,type,icon,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(
          entity.id,
          bookId,
          entity.name,
          entity.type,
          entity.icon,
          entity.sortOrder ?? 0,
          timestamp,
          timestamp,
        )
        .run();
    else if (kind === "tags")
      await this.db
        .prepare("INSERT INTO tags (id,book_id,name,color,created_at,updated_at) VALUES (?,?,?,?,?,?)")
        .bind(entity.id, bookId, entity.name, entity.color, timestamp, timestamp)
        .run();
    return entity;
  }

  async updateSimple(
    kind: "categories" | "tags",
    entityId: string,
    data: Omit<SimpleEntity, "id" | "bookId">,
  ) {
    const current = await this.getSimple(kind, entityId);
    if (!current) return null;
    const entity = { ...current, ...data };
    if (kind === "categories")
      await this.db
        .prepare("UPDATE categories SET name=?,type=?,icon=?,sort_order=?,updated_at=? WHERE id=?")
        .bind(entity.name, entity.type, entity.icon, entity.sortOrder ?? 0, now(), entityId)
        .run();
    else if (kind === "tags")
      await this.db
        .prepare("UPDATE tags SET name=?,color=?,updated_at=? WHERE id=?")
        .bind(entity.name, entity.color, now(), entityId)
        .run();
    return entity;
  }

  async deleteSimple(kind: "categories" | "tags", entityId: string) {
    await this.db
      .prepare(`DELETE FROM ${this.tableFor(kind)} WHERE id = ?`)
      .bind(entityId)
      .run();
  }

  async listInvitations(bookId: string) {
    const result = await this.db
      .prepare(
        "SELECT id,book_id AS bookId,inviter_user_id AS inviterUserId,invitee_email AS inviteeEmail,invitee_phone AS inviteePhone,invitee_user_id AS inviteeUserId,role,status,expires_at AS expiresAt,last_reminded_at AS lastRemindedAt FROM invitations WHERE book_id=? ORDER BY created_at DESC",
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
        "SELECT id,book_id AS bookId,inviter_user_id AS inviterUserId,invitee_email AS inviteeEmail,invitee_phone AS inviteePhone,invitee_user_id AS inviteeUserId,role,status,expires_at AS expiresAt,last_reminded_at AS lastRemindedAt FROM invitations WHERE invitee_user_id=? OR (invitee_email IS NOT NULL AND invitee_email=?) OR (invitee_phone IS NOT NULL AND invitee_phone=?) ORDER BY created_at DESC",
      )
      .bind(userId, user?.email ?? "", user?.phone ?? "")
      .all<Row>();
    return result.results.map(mapInvitation);
  }

  async getInvitation(invitationId: string) {
    const row = await this.db
      .prepare(
        "SELECT id,book_id AS bookId,inviter_user_id AS inviterUserId,invitee_email AS inviteeEmail,invitee_phone AS inviteePhone,invitee_user_id AS inviteeUserId,role,status,expires_at AS expiresAt,last_reminded_at AS lastRemindedAt FROM invitations WHERE id=?",
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
        "INSERT INTO invitations (id,book_id,inviter_user_id,invitee_email,invitee_phone,invitee_user_id,role,status,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        invitation.id,
        invitation.bookId,
        invitation.inviterUserId,
        invitation.inviteeEmail ?? null,
        invitation.inviteePhone ?? null,
        null,
        invitation.role,
        invitation.status,
        invitation.expiresAt,
        timestamp,
        timestamp,
      )
      .run();
    return invitation;
  }

  async findPendingInvitation(bookId: string, email?: string, phone?: string) {
    return this.db
      .prepare(
        "SELECT id FROM invitations WHERE book_id=? AND status='pending' AND (invitee_email=? OR invitee_phone=?) LIMIT 1",
      )
      .bind(bookId, email ?? "", phone ?? "")
      .first();
  }
  async updateInvitation(
    invitationId: string,
    fields: Partial<Pick<Invitation, "status" | "inviteeUserId" | "lastRemindedAt">>,
  ) {
    const invitation = await this.getInvitation(invitationId);
    if (!invitation) return null;
    const changed = { ...invitation, ...fields };
    await this.db
      .prepare("UPDATE invitations SET status=?,invitee_user_id=?,last_reminded_at=?,updated_at=? WHERE id=?")
      .bind(
        changed.status,
        changed.inviteeUserId ?? null,
        changed.lastRemindedAt ?? null,
        now(),
        invitationId,
      )
      .run();
    return changed;
  }
  async addMember(bookId: string, userId: string, role: "admin" | "member") {
    const timestamp = now();
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO book_members (id,book_id,user_id,role,joined_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(id("member"), bookId, userId, role, timestamp, timestamp, timestamp)
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
        "INSERT INTO import_jobs (id,book_id,user_id,file_name,file_type,r2_key,status,auto_confirm,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
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
        timestamp,
        timestamp,
      )
      .run();
    return job;
  }
  async listImportJobs(bookId: string) {
    const result = await this.db
      .prepare(`SELECT ${importJobColumns} FROM import_jobs WHERE book_id=? ORDER BY created_at DESC`)
      .bind(bookId)
      .all<Row>();
    return result.results.map(mapImportJob);
  }
  async getImportJob(jobId: string) {
    const row = await this.db
      .prepare(`SELECT ${importJobColumns} FROM import_jobs WHERE id=?`)
      .bind(jobId)
      .first<Row>();
    return row ? mapImportJob(row) : null;
  }
  async updateImportJob(jobId: string, status: string, errorMessage?: string) {
    const terminal = ["completed", "pending_confirmation", "failed", "cancelled"].includes(status) ? 1 : 0;
    await this.db
      .prepare(
        "UPDATE import_jobs SET status=?,error_message=?,cancelable=CASE WHEN ? THEN 0 ELSE cancelable END,retryable=CASE WHEN ? THEN 0 ELSE retryable END,updated_at=? WHERE id=?",
      )
      .bind(status, errorMessage ?? null, terminal, terminal, now(), jobId)
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
            "INSERT INTO imported_records (id,import_job_id,raw_data,suggested_transaction,status,confidence,warnings,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            record.id,
            jobId,
            "{}",
            JSON.stringify(record.suggestedTransaction),
            record.status,
            Math.round(record.confidence * 100),
            JSON.stringify(record.warnings),
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
        "SELECT id,import_job_id AS importJobId,suggested_transaction AS suggestedTransaction,status,confidence,warnings FROM imported_records WHERE import_job_id=? ORDER BY created_at",
      )
      .bind(jobId)
      .all<Row>();
    return result.results.map(mapRecord);
  }
  async getImportedRecord(recordId: string) {
    const row = await this.db
      .prepare(
        "SELECT id,import_job_id AS importJobId,suggested_transaction AS suggestedTransaction,status,confidence,warnings FROM imported_records WHERE id=?",
      )
      .bind(recordId)
      .first<Row>();
    return row ? mapRecord(row) : null;
  }
  async updateImportedRecord(
    recordId: string,
    suggestion: Record<string, unknown>,
    status?: ImportedRecord["status"],
  ) {
    const record = await this.getImportedRecord(recordId);
    if (!record) return null;
    const updated = { ...record, suggestedTransaction: suggestion, status: status ?? record.status };
    await this.db
      .prepare("UPDATE imported_records SET suggested_transaction=?,status=?,updated_at=? WHERE id=?")
      .bind(JSON.stringify(updated.suggestedTransaction), updated.status, now(), recordId)
      .run();
    return updated;
  }

  async createConversation(userId: string, bookId: string | undefined, title: string) {
    const timestamp = now();
    const conversation = {
      id: id("conversation"),
      userId,
      bookId,
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.db
      .prepare(
        "INSERT INTO ai_conversations (id,user_id,book_id,title,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      )
      .bind(conversation.id, userId, bookId ?? null, title, timestamp, timestamp)
      .run();
    return conversation;
  }
  async appendMessage(conversationId: string, role: "user" | "assistant" | "system", content: string) {
    const timestamp = now();
    await this.db.batch([
      this.db
        .prepare("INSERT INTO ai_messages (id,conversation_id,role,content,created_at) VALUES (?,?,?,?,?)")
        .bind(id("ai_message"), conversationId, role, content, timestamp),
      this.db.prepare("UPDATE ai_conversations SET updated_at=? WHERE id=?").bind(timestamp, conversationId),
    ]);
  }
  async listConversations(userId: string) {
    const result = await this.db
      .prepare(
        "SELECT id,user_id AS userId,book_id AS bookId,title,created_at AS createdAt,updated_at AS updatedAt FROM ai_conversations WHERE user_id=? ORDER BY updated_at DESC",
      )
      .bind(userId)
      .all<Row>();
    return result.results;
  }
  async getConversation(userId: string, conversationId: string): Promise<(Row & { messages: Row[] }) | null> {
    const conversation = await this.db
      .prepare(
        "SELECT id,user_id AS userId,book_id AS bookId,title,created_at AS createdAt,updated_at AS updatedAt FROM ai_conversations WHERE id=? AND user_id=?",
      )
      .bind(conversationId, userId)
      .first<Row>();
    if (!conversation) return null;
    const messages = await this.db
      .prepare(
        "SELECT id,role,content,metadata,created_at AS createdAt FROM ai_messages WHERE conversation_id=? ORDER BY created_at",
      )
      .bind(conversationId)
      .all<Row>();
    return { ...conversation, messages: messages.results as Row[] };
  }
}
