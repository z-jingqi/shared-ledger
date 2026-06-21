import type { MemoryLedgerStore } from "./store";

const iso = () => new Date().toISOString();
const quote = (value: unknown) => value === undefined ? null : value;

/**
 * D1-backed repository boundary. MemoryLedgerStore remains the deterministic
 * test/local adapter; this repository hydrates and writes the Worker snapshot
 * using the normalized D1 tables declared in packages/db/migrations.
 */
export class D1LedgerRepository {
  constructor(private readonly db: D1Database) {}

  async hydrate(store: MemoryLedgerStore) {
    const [users, books, members, transactions, categories, tags, accounts, invitations, jobs, records] = await this.db.batch([
      this.db.prepare("SELECT id,name,email FROM users"), this.db.prepare("SELECT id,name,currency,created_by_user_id AS createdByUserId,created_at AS createdAt,updated_at AS updatedAt FROM books WHERE deleted_at IS NULL"),
      this.db.prepare("SELECT bm.id,bm.book_id AS bookId,bm.user_id AS userId,u.name,bm.role,bm.joined_at AS joinedAt FROM book_members bm JOIN users u ON u.id=bm.user_id"),
      this.db.prepare("SELECT id,book_id AS bookId,type,amount_cents / 100.0 AS amount,category_id AS categoryId,account_id AS accountId,member_id AS memberId,created_by_user_id AS createdByUserId,note,occurred_at AS occurredAt FROM transactions WHERE deleted_at IS NULL"),
      this.db.prepare("SELECT id,book_id AS bookId,name,type,icon,sort_order AS sortOrder FROM categories"), this.db.prepare("SELECT id,book_id AS bookId,name,color FROM tags"), this.db.prepare("SELECT id,book_id AS bookId,name,type FROM accounts"),
      this.db.prepare("SELECT id,book_id AS bookId,inviter_user_id AS inviterUserId,invitee_email AS inviteeEmail,invitee_phone AS inviteePhone,invitee_user_id AS inviteeUserId,role,status,expires_at AS expiresAt,last_reminded_at AS lastRemindedAt FROM invitations"),
      this.db.prepare("SELECT id,book_id AS bookId,user_id AS userId,file_name AS fileName,file_type AS fileType,r2_key AS r2Key,status,created_at AS createdAt,updated_at AS updatedAt FROM import_jobs"),
      this.db.prepare("SELECT id,import_job_id AS importJobId,suggested_transaction AS suggestedTransaction,status,confidence,warnings FROM imported_records")
    ]);
    if (!users.results.length) return;
    const subscriptions = await this.db.prepare("SELECT user_id AS userId,plan FROM subscriptions WHERE status='active'").all<{ userId: string; plan: "free" | "pro" }>();
    const plans = new Map(subscriptions.results.map((row) => [row.userId, row.plan]));
    store.users = users.results.map((row: any) => ({ id: row.id, name: row.name, email: row.email ?? "", plan: plans.get(row.id) ?? "free" }));
    store.books = books.results as any;
    store.members = members.results as any;
    store.transactions = transactions.results.map((row: any) => ({ ...row, tagIds: [], items: [] }));
    store.categories = categories.results as any; store.tags = tags.results as any; store.accounts = accounts.results as any;
    store.invitations = invitations.results as any; store.imports = jobs.results as any;
    store.records = records.results.map((row: any) => ({ ...row, suggestedTransaction: JSON.parse(row.suggestedTransaction), warnings: JSON.parse(row.warnings) }));
  }

  async persist(store: MemoryLedgerStore) {
    const timestamp = iso();
    const statements: D1PreparedStatement[] = [
      this.db.prepare("DELETE FROM transaction_tags"), this.db.prepare("DELETE FROM transaction_items"), this.db.prepare("DELETE FROM imported_records"), this.db.prepare("DELETE FROM import_jobs"), this.db.prepare("DELETE FROM invitations"), this.db.prepare("DELETE FROM transactions"), this.db.prepare("DELETE FROM categories"), this.db.prepare("DELETE FROM tags"), this.db.prepare("DELETE FROM accounts"), this.db.prepare("DELETE FROM book_members"), this.db.prepare("DELETE FROM subscriptions"), this.db.prepare("DELETE FROM books"), this.db.prepare("DELETE FROM users")
    ];
    for (const user of store.users) statements.push(this.db.prepare("INSERT INTO users (id,name,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(user.id, user.name, user.email || null, "managed-by-auth-adapter", timestamp, timestamp));
    for (const book of store.books) statements.push(this.db.prepare("INSERT INTO books (id,name,currency,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(book.id, book.name, book.currency, book.createdByUserId, book.createdAt, book.updatedAt));
    for (const member of store.members) statements.push(this.db.prepare("INSERT INTO book_members (id,book_id,user_id,role,joined_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(member.id, member.bookId, member.userId, member.role, member.joinedAt, timestamp, timestamp));
    for (const category of store.categories) statements.push(this.db.prepare("INSERT INTO categories (id,book_id,name,type,icon,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(category.id, category.bookId, category.name, category.type, category.icon ?? "tag", category.sortOrder ?? 0, timestamp, timestamp));
    for (const tag of store.tags) statements.push(this.db.prepare("INSERT INTO tags (id,book_id,name,color,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(tag.id, tag.bookId, tag.name, tag.color ?? "#ff681c", timestamp, timestamp));
    for (const account of store.accounts) statements.push(this.db.prepare("INSERT INTO accounts (id,book_id,name,type,created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(account.id, account.bookId, account.name, account.type ?? "other", store.books.find((book) => book.id === account.bookId)?.createdByUserId ?? store.users[0]?.id, timestamp, timestamp));
    for (const transaction of store.transactions) { statements.push(this.db.prepare("INSERT INTO transactions (id,book_id,type,amount_cents,category_id,account_id,member_id,created_by_user_id,note,occurred_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(transaction.id, transaction.bookId, transaction.type, Math.round(transaction.amount * 100), quote(transaction.categoryId), quote(transaction.accountId), quote(transaction.memberId), transaction.createdByUserId, quote(transaction.note), transaction.occurredAt, timestamp, timestamp)); for (const tagId of transaction.tagIds) statements.push(this.db.prepare("INSERT INTO transaction_tags (transaction_id,tag_id) VALUES (?,?)").bind(transaction.id, tagId)); for (const item of transaction.items) statements.push(this.db.prepare("INSERT INTO transaction_items (id,transaction_id,name,amount_cents,category_id,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(item.id, transaction.id, item.name, Math.round(item.amount * 100), quote(item.categoryId), quote(item.note), timestamp, timestamp)); }
    for (const invitation of store.invitations) statements.push(this.db.prepare("INSERT INTO invitations (id,book_id,inviter_user_id,invitee_email,invitee_phone,invitee_user_id,role,status,expires_at,last_reminded_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(invitation.id, invitation.bookId, invitation.inviterUserId, quote(invitation.inviteeEmail), quote(invitation.inviteePhone), quote(invitation.inviteeUserId), invitation.role, invitation.status, invitation.expiresAt, quote(invitation.lastRemindedAt), timestamp, timestamp));
    for (const job of store.imports) statements.push(this.db.prepare("INSERT INTO import_jobs (id,book_id,user_id,file_name,file_type,r2_key,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(job.id, job.bookId, job.userId, job.fileName, job.fileType, job.r2Key, job.status, job.createdAt, job.updatedAt));
    for (const record of store.records) statements.push(this.db.prepare("INSERT INTO imported_records (id,import_job_id,raw_data,suggested_transaction,status,confidence,warnings,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(record.id, record.importJobId, "{}", JSON.stringify(record.suggestedTransaction), record.status, Math.round(record.confidence * 100), JSON.stringify(record.warnings), timestamp, timestamp));
    for (const user of store.users) statements.push(this.db.prepare("INSERT INTO subscriptions (id,user_id,plan,status,started_at,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(`sub_${user.id}`, user.id, user.plan, "active", timestamp, null, timestamp, timestamp));
    await this.db.batch(statements);
  }
}
