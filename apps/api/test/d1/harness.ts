import { createApp } from "../../src";
import { D1LedgerRepository } from "../../src/repository";
import type { Env, LedgerUser } from "../../src/types";
import { createHash } from "node:crypto";

type Row = Record<string, any>;
type TableName =
  | "users"
  | "subscriptions"
  | "books"
  | "book_members"
  | "transactions"
  | "transaction_items"
  | "categories"
  | "invitations"
  | "import_jobs"
  | "imported_records"
  | "image_ocr_usage"
  | "ai_sessions"
  | "ai_messages"
  | "ai_runs"
  | "ai_steps"
  | "ai_tool_calls"
  | "ai_confirmations"
  | "auth_sessions"
  | "refresh_tokens"
  | "auth_identities";

const tableNames: TableName[] = [
  "users",
  "subscriptions",
  "books",
  "book_members",
  "transactions",
  "transaction_items",
  "categories",
  "invitations",
  "import_jobs",
  "imported_records",
  "image_ocr_usage",
  "ai_sessions",
  "ai_messages",
  "ai_runs",
  "ai_steps",
  "ai_tool_calls",
  "ai_confirmations",
  "auth_sessions",
  "refresh_tokens",
  "auth_identities",
];

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const normalizeSql = (sql: string) => sql.replace(/\s+/g, " ").trim();
const testSessionToken = (userId: string) => `test_session_${userId}`;
const testSessionHash = (userId: string) =>
  createHash("sha256").update(testSessionToken(userId)).digest("base64");

export class TestD1Database {
  rows: Record<TableName, Row[]> = Object.fromEntries(
    tableNames.map((table) => [table, []]),
  ) as unknown as Record<TableName, Row[]>;

  prepare(query: string): D1PreparedStatement {
    return new TestD1Statement(this, query) as unknown as D1PreparedStatement;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results = [];
    for (const statement of statements) {
      const testStatement = statement as unknown as TestD1Statement;
      results.push(testStatement.isSelect() ? await testStatement.all<T>() : await testStatement.run<T>());
    }
    return results;
  }

  async exec(query: string): Promise<D1ExecResult> {
    for (const statement of query
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)) {
      if (!/^create |^drop |^pragma |^alter |^create unique |^create index/i.test(statement)) {
        this.prepare(statement).run();
      }
    }
    return { count: 0, duration: 0 };
  }

  dump(): Promise<ArrayBuffer> {
    throw new Error("Not implemented in tests");
  }

  withSession() {
    return this;
  }
}

class TestD1Statement {
  private values: unknown[] = [];

  constructor(
    private readonly db: TestD1Database,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  isSelect() {
    return /^\s*select\b/i.test(this.sql);
  }

  async first<T = Row>(): Promise<T | null> {
    return ((await this.all<T>()).results[0] ?? null) as T | null;
  }

  async all<T = Row>(): Promise<D1Result<T>> {
    const results = executeSelect(this.db, this.sql, this.values) as T[];
    return { results, success: true, meta: {} as any };
  }

  async run<T = Row>(): Promise<D1Result<T>> {
    executeMutation(this.db, this.sql, this.values);
    return { results: [], success: true, meta: {} as any };
  }

  raw<T = unknown[]>(): Promise<T[]> {
    throw new Error("Not implemented in tests");
  }
}

function executeMutation(db: TestD1Database, sql: string, values: unknown[]) {
  const normalized = normalizeSql(sql);
  if (/^insert(?: or ignore)? into /i.test(normalized)) return insertRow(db, normalized, values);
  if (/^update /i.test(normalized)) return updateRows(db, normalized, values);
  if (/^delete from auth_sessions/i.test(normalized)) {
    db.rows.auth_sessions = db.rows.auth_sessions.filter((row) => row.token_hash !== values[0]);
    return;
  }
  throw new Error(`Unsupported D1 mutation in test harness: ${normalized}`);
}

function insertRow(db: TestD1Database, sql: string, values: unknown[]) {
  const match = /^insert(?: or ignore)? into ([a-z_]+) \(([^)]+)\)/i.exec(sql);
  if (!match) throw new Error(`Unsupported INSERT: ${sql}`);
  const table = match[1] as TableName;
  const columns = match[2].split(",").map((column) => column.trim());
  const row: Row = {};
  columns.forEach((column, index) => {
    row[column] = values[index] ?? null;
  });
  if (/or ignore/i.test(sql)) {
    if (
      table === "book_members" &&
      db.rows.book_members.some(
        (item) => !item.deleted_at && item.book_id === row.book_id && item.user_id === row.user_id,
      )
    )
      return;
    if (
      table === "image_ocr_usage" &&
      db.rows.image_ocr_usage.some((item) => item.import_job_id === row.import_job_id)
    )
      return;
  }
  db.rows[table].push(row);
}

function updateRows(db: TestD1Database, sql: string, values: unknown[]) {
  const table = /^update ([a-z_]+)/i.exec(sql)?.[1] as TableName | undefined;
  if (!table) throw new Error(`Unsupported UPDATE: ${sql}`);
  const rows = db.rows[table];
  const set = (row: Row, patch: Row) => Object.assign(row, patch);

  if (table === "books" && sql.includes("SET name = ?")) {
    rows
      .filter((row) => row.id === values[4])
      .forEach((row) =>
        set(row, {
          name: values[0],
          currency: values[1],
          updated_at: values[2],
          updated_by_user_id: values[3],
        }),
      );
    return;
  }
  if (table === "books" && sql.includes("SET deleted_at")) {
    rows
      .filter((row) => row.id === values[4])
      .forEach((row) =>
        set(row, {
          deleted_at: values[0],
          deleted_by_user_id: values[1],
          updated_at: values[2],
          updated_by_user_id: values[3],
        }),
      );
    return;
  }
  if (table === "book_members" && sql.includes("SET role = ?")) {
    rows
      .filter((row) => row.id === values[3])
      .forEach((row) => set(row, { role: values[0], updated_at: values[1], updated_by_user_id: values[2] }));
    return;
  }
  if (table === "book_members" && sql.includes("WHERE id = ? AND book_id = ?")) {
    rows
      .filter((row) => row.id === values[4] && row.book_id === values[5])
      .forEach((row) =>
        set(row, {
          deleted_at: values[0],
          deleted_by_user_id: values[1],
          updated_at: values[2],
          updated_by_user_id: values[3],
        }),
      );
    return;
  }
  if (table === "book_members" && sql.includes("WHERE user_id = ? AND book_id = ?")) {
    rows
      .filter((row) => row.user_id === values[4] && row.book_id === values[5])
      .forEach((row) =>
        set(row, {
          deleted_at: values[0],
          deleted_by_user_id: values[1],
          updated_at: values[2],
          updated_by_user_id: values[3],
        }),
      );
    return;
  }
  if (table === "transactions" && sql.includes("SET type=?")) {
    rows
      .filter((row) => row.id === values[9])
      .forEach((row) =>
        set(row, {
          type: values[0],
          amount_cents: values[1],
          category_id: values[2],
          account_id: values[3],
          member_id: values[4],
          note: values[5],
          occurred_at: values[6],
          updated_at: values[7],
          updated_by_user_id: values[8],
        }),
      );
    return;
  }
  if (table === "transactions" && sql.includes("SET deleted_at")) {
    rows
      .filter((row) => row.id === values[4])
      .forEach((row) =>
        set(row, {
          deleted_at: values[0],
          deleted_by_user_id: values[1],
          updated_at: values[2],
          updated_by_user_id: values[3],
        }),
      );
    return;
  }
  if (table === "transaction_items" && sql.includes("WHERE transaction_id")) {
    rows
      .filter((row) => row.transaction_id === values[4] && !row.deleted_at)
      .forEach((row) =>
        set(row, {
          deleted_at: values[0],
          deleted_by_user_id: values[1],
          updated_at: values[2],
          updated_by_user_id: values[3],
        }),
      );
    return;
  }
  if (table === "transactions" && sql.includes("category_id=NULL")) {
    rows
      .filter((row) => row.category_id === values[2])
      .forEach((row) =>
        set(row, { category_id: null, updated_at: values[0], updated_by_user_id: values[1] }),
      );
    return;
  }
  if (table === "transaction_items" && sql.includes("category_id=NULL")) {
    rows
      .filter((row) => row.category_id === values[2])
      .forEach((row) =>
        set(row, { category_id: null, updated_at: values[0], updated_by_user_id: values[1] }),
      );
    return;
  }
  if (table === "categories" && sql.includes("SET name=?")) {
    rows
      .filter((row) => row.id === values[6])
      .forEach((row) =>
        set(row, {
          name: values[0],
          type: values[1],
          icon: values[2],
          sort_order: values[3],
          updated_at: values[4],
          updated_by_user_id: values[5],
        }),
      );
    return;
  }
  if (table === "categories") {
    rows
      .filter((row) => row.id === values[4])
      .forEach((row) =>
        set(row, {
          deleted_at: values[0],
          deleted_by_user_id: values[1],
          updated_at: values[2],
          updated_by_user_id: values[3],
        }),
      );
    return;
  }
  if (table === "invitations") {
    rows
      .filter((row) => row.id === values[5])
      .forEach((row) =>
        set(row, {
          status: values[0],
          invitee_user_id: values[1],
          last_reminded_at: values[2],
          updated_at: values[3],
          updated_by_user_id: values[4],
        }),
      );
    return;
  }
  if (table === "import_jobs") return updateImportJobRows(rows, sql, values);
  if (table === "imported_records") {
    rows
      .filter((row) => row.id === values[4])
      .forEach((row) =>
        set(row, {
          suggested_transaction: values[0],
          status: values[1],
          updated_at: values[2],
          updated_by_user_id: values[3],
        }),
      );
    return;
  }
  if (table === "ai_confirmations" && sql.includes("SET status=?")) {
    rows
      .filter((row) => row.id === values[6])
      .forEach((row) =>
        set(row, {
          status: values[0],
          result: values[1],
          confirmed_at: values[2],
          cancelled_at: values[3],
          updated_at: values[4],
          updated_by_user_id: values[5],
        }),
      );
    return;
  }
  if (table === "ai_sessions" && sql.includes("SET title=?")) {
    rows
      .filter((row) => row.id === values[4] && row.user_id === values[5])
      .forEach((row) =>
        set(row, {
          title: values[0],
          book_id: values[1],
          updated_at: values[2],
          updated_by_user_id: values[3],
        }),
      );
    return;
  }
  if (table === "ai_sessions" && sql.includes("SET updated_at")) {
    rows
      .filter((row) => row.id === values[2])
      .forEach((row) => set(row, { updated_at: values[0], updated_by_user_id: values[1] }));
    return;
  }
  if (table === "ai_runs") {
    rows
      .filter((row) => row.id === values[6])
      .forEach((row) =>
        set(row, {
          status: values[0],
          selected_skill: values[1] ?? row.selected_skill,
          final_message_id: values[2] ?? row.final_message_id,
          error_message: values[3],
          updated_at: values[4],
          updated_by_user_id: values[5],
        }),
      );
    return;
  }
  if (table === "ai_tool_calls") {
    rows
      .filter((row) => row.id === values[5])
      .forEach((row) =>
        set(row, {
          status: values[0],
          result: values[1],
          error_message: values[2],
          updated_at: values[3],
          updated_by_user_id: values[4],
        }),
      );
    return;
  }
  if (table === "refresh_tokens") {
    rows
      .filter((row) => row.token_hash === values[1] && !row.revoked_at)
      .forEach((row) => set(row, { revoked_at: values[0] }));
    return;
  }
  if (table === "users" && sql.includes("avatar_url")) {
    rows
      .filter((row) => row.id === values[2])
      .forEach((row) => set(row, { avatar_url: values[0], updated_at: values[1] }));
    return;
  }
  if (table === "users" && sql.includes("SET name = ?")) {
    rows
      .filter((row) => row.id === values[4])
      .forEach((row) =>
        set(row, { name: values[0], email: values[1], updated_at: values[2], updated_by_user_id: values[3] }),
      );
    return;
  }
  if (table === "users" && sql.includes("SET password_hash")) {
    rows
      .filter((row) => row.id === values[3])
      .forEach((row) =>
        set(row, { password_hash: values[0], updated_at: values[1], updated_by_user_id: values[2] }),
      );
    return;
  }
  if (table === "auth_identities") {
    rows
      .filter((row) => row.id === values[3])
      .forEach((row) =>
        set(row, { password_hash: values[0], updated_at: values[1], updated_by_user_id: values[2] }),
      );
    return;
  }
  throw new Error(`Unsupported D1 update in test harness: ${sql}`);
}

function updateImportJobRows(rows: Row[], sql: string, values: unknown[]) {
  const patch = (jobId: unknown, rowPatch: Row) =>
    rows.filter((row) => row.id === jobId).forEach((row) => Object.assign(row, rowPatch));
  if (sql.includes("created_at < ?")) {
    rows
      .filter((row) => !row.deleted_at && String(row.created_at) < String(values[4]))
      .forEach((row) =>
        Object.assign(row, {
          deleted_at: values[0],
          deleted_by_user_id: values[1],
          updated_at: values[2],
          updated_by_user_id: values[3],
        }),
      );
    return;
  }
  if (sql.includes("SET status=?,error_message=?")) {
    patch(values[6], {
      status: values[0],
      error_message: values[1],
      updated_at: values[4],
      updated_by_user_id: values[5],
      cancelable: values[2] ? 0 : undefined,
      retryable: values[3] ? 0 : undefined,
    });
    return;
  }
  if (sql.includes("ocr_job_id=?")) {
    patch(values[6], {
      status: values[0],
      ocr_job_id: values[1],
      aleph_tool: values[2],
      ocr_submitted_at: values[3],
      ocr_progress: 0,
      ocr_stage: values[4],
      ocr_event_sequence: 0,
      error_message: null,
      error_code: null,
      error_stage: null,
      error_request_id: null,
      error_retryable: 0,
      error_terminal: 0,
      failed_external_job_id: null,
      cancelable: 1,
      retryable: 1,
      updated_at: values[5],
    });
    return;
  }
  if (sql.includes("status='failed'")) {
    patch(values[9], {
      status: "failed",
      error_message: values[0],
      error_code: values[1],
      error_stage: values[2],
      error_request_id: values[3],
      error_retryable: values[4],
      error_terminal: values[5],
      failed_external_job_id: values[6],
      cancelable: 0,
      retryable: values[7],
      updated_at: values[8],
    });
    return;
  }
  if (sql.includes("retry_count=retry_count+1")) {
    rows
      .filter((row) => row.id === values[1])
      .forEach((row) =>
        Object.assign(row, {
          retry_count: Number(row.retry_count ?? 0) + 1,
          status: sql.includes("status='ai_processing'") ? "ai_processing" : "uploaded",
          ocr_job_id: sql.includes("ocr_job_id=NULL") ? null : row.ocr_job_id,
          updated_at: values[0],
        }),
      );
    return;
  }
  const jobId = values[values.length - 1];
  const rowPatch: Row = { updated_at: values[sql.includes("updated_at=?") ? values.length - 2 : 0] };
  const assignments =
    sql
      .match(/set (.+) where/i)?.[1]
      .split(",")
      .map((part) => part.trim()) ?? [];
  let index = 0;
  for (const assignment of assignments) {
    if (assignment === "updated_at=?") {
      rowPatch.updated_at = values[index++];
    } else if (assignment === "ocr_progress=?") {
      rowPatch.ocr_progress = values[index++];
    } else if (assignment === "ocr_stage=?") {
      rowPatch.ocr_stage = values[index++];
    } else if (assignment === "ocr_current_page=?") {
      rowPatch.ocr_current_page = values[index++];
    } else if (assignment === "ocr_total_pages=?") {
      rowPatch.ocr_total_pages = values[index++];
    } else if (assignment === "ocr_completed_at=?") {
      rowPatch.ocr_completed_at = values[index++];
    } else if (assignment === "cancelable=?") {
      rowPatch.cancelable = values[index++];
    } else if (assignment === "retryable=?") {
      rowPatch.retryable = values[index++];
    } else if (assignment.startsWith("ocr_event_sequence=MAX")) {
      rowPatch.ocr_event_sequence = Math.max(
        Number(rowPatch.ocr_event_sequence ?? 0),
        Number(values[index++]),
      );
    }
  }
  patch(jobId, rowPatch);
}

function executeSelect(db: TestD1Database, sql: string, values: unknown[]) {
  const normalized = normalizeSql(sql);
  const lower = normalized.toLowerCase();
  if (lower.includes("from subscriptions")) return selectSubscriptions(db, lower, values);
  if (lower.includes("from books b join book_members")) return selectBooksForUser(db, values[0]);
  if (lower.includes("from books where id"))
    return db.rows.books.filter((row) => row.id === values[0] && !row.deleted_at).map(bookRow);
  if (lower.includes("from book_members") && lower.includes("select role"))
    return db.rows.book_members
      .filter((row) => row.book_id === values[0] && row.user_id === values[1] && !row.deleted_at)
      .map((row) => ({ role: row.role }));
  if (lower.includes("from book_members bm join users")) return selectMembers(db, lower, values);
  if (lower.includes("from transactions")) return selectTransactions(db, lower, values);
  if (lower.includes("from transaction_items"))
    return db.rows.transaction_items
      .filter((row) => row.transaction_id === values[0] && !row.deleted_at)
      .map((row) => ({
        id: row.id,
        name: row.name,
        amount: row.amount_cents / 100,
        categoryId: row.category_id,
        note: row.note,
      }));
  if (lower.includes("from categories")) return selectSimple(db.rows.categories, lower, values, true);
  if (lower.includes("from invitations")) return selectInvitations(db, lower, values);
  if (lower === "select email,phone from users where id = ?")
    return db.rows.users
      .filter((row) => row.id === values[0])
      .map((row) => ({ email: row.email, phone: row.phone }));
  if (lower.includes("from users u")) return selectUsersWithPlan(db, lower, values);
  if (lower.includes("from users where id"))
    return db.rows.users
      .filter((row) => row.id === values[0])
      .map((row) => ({ email: row.email, phone: row.phone }));
  if (lower.includes("from auth_identities")) return selectAuthIdentities(db, lower, values);
  if (lower.includes("from auth_sessions session")) return selectSessionUsers(db, values);
  if (lower.includes("from refresh_tokens")) return selectRefreshTokens(db, values);
  if (lower.includes("from import_jobs")) return selectImportJobs(db, lower, values);
  if (lower.includes("from imported_records")) return selectImportedRecords(db, lower, values);
  if (lower.includes("from image_ocr_usage"))
    return [
      {
        count: db.rows.image_ocr_usage.filter(
          (row) => row.user_id === values[0] && row.usage_date === values[1] && !row.deleted_at,
        ).length,
      },
    ];
  if (lower.includes("from ai_confirmations")) return selectAiConfirmations(db, lower, values);
  if (lower.includes("from ai_sessions")) return selectAiSessions(db, lower, values);
  if (lower.includes("from ai_messages"))
    return db.rows.ai_messages
      .filter((row) => row.session_id === values[0] && !row.deleted_at)
      .map(aiMessageRow);
  if (lower.includes("from ai_tool_calls")) return selectAiToolCalls(db, lower, values);
  return [];
}

function selectAuthIdentities(db: TestD1Database, lower: string, values: unknown[]) {
  if (lower.includes("provider_account_id")) {
    return db.rows.auth_identities
      .filter((row) => row.provider === "password" && row.provider_account_id === values[0])
      .map((row) => ({ id: row.id }));
  }
  return db.rows.auth_identities
    .filter((row) => row.user_id === values[0] && row.provider === "password")
    .map((row) => ({ id: row.id, password_hash: row.password_hash, passwordHash: row.password_hash }));
}

function selectSessionUsers(db: TestD1Database, values: unknown[]) {
  const session = db.rows.auth_sessions.find(
    (row) => row.token_hash === values[0] && String(row.expires_at) > String(values[1]),
  );
  if (!session) return [];
  const user = db.rows.users.find((row) => row.id === session.user_id && !row.deleted_at);
  if (!user) return [];
  const subscription = db.rows.subscriptions.find(
    (row) => row.user_id === user.id && row.status === "active" && !row.deleted_at,
  );
  return [
    {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
      phone: user.phone,
      plan: subscription?.plan ?? "free",
    },
  ];
}

function selectRefreshTokens(db: TestD1Database, values: unknown[]) {
  return db.rows.refresh_tokens
    .filter(
      (row) => row.token_hash === values[0] && String(row.expires_at) > String(values[1]) && !row.revoked_at,
    )
    .map((row) => ({ userId: row.user_id }));
}

function selectSubscriptions(db: TestD1Database, lower: string, values: unknown[]) {
  if (lower.includes("count")) return [];
  return db.rows.subscriptions
    .filter((row) => row.user_id === values[0] && row.status === "active" && !row.deleted_at)
    .map((row) => ({ plan: row.plan }));
}

function selectBooksForUser(db: TestD1Database, userId: unknown) {
  const memberBookIds = new Set(
    db.rows.book_members.filter((row) => row.user_id === userId && !row.deleted_at).map((row) => row.book_id),
  );
  return db.rows.books
    .filter((row) => memberBookIds.has(row.id) && !row.deleted_at)
    .sort(desc("updated_at"))
    .map(bookRow);
}

function selectMembers(db: TestD1Database, lower: string, values: unknown[]) {
  const rows = db.rows.book_members.filter((row) => !row.deleted_at);
  const filtered = lower.includes("bm.id = ?")
    ? rows.filter((row) => row.id === values[0] && row.book_id === values[1])
    : lower.includes("bm.user_id = ?")
      ? rows.filter((row) => row.user_id === values[0] && row.book_id === values[1])
      : rows.filter((row) => row.book_id === values[0]);
  return filtered.map((member) => {
    const user = db.rows.users.find((row) => row.id === member.user_id);
    return {
      id: member.id,
      bookId: member.book_id,
      userId: member.user_id,
      name: user?.name ?? member.user_id,
      role: member.role,
      joinedAt: member.joined_at,
    };
  });
}

function selectTransactions(db: TestD1Database, lower: string, values: unknown[]) {
  let rows = db.rows.transactions.filter((row) => !row.deleted_at);
  if (lower.includes("where id = ?") || lower.includes("where transactions.id = ?"))
    rows = rows.filter((row) => row.id === values[0]);
  else {
    let index = 0;
    rows = rows.filter((row) => row.book_id === values[index++]);
    if (lower.includes("type = ?")) rows = rows.filter((row) => row.type === values[index++]);
    if (lower.includes("amount_cents > ?"))
      rows = rows.filter((row) => row.amount_cents > Number(values[index++]));
    if (lower.includes("amount_cents >= ?"))
      rows = rows.filter((row) => row.amount_cents >= Number(values[index++]));
    if (lower.includes("amount_cents < ?"))
      rows = rows.filter((row) => row.amount_cents < Number(values[index++]));
    if (lower.includes("amount_cents <= ?"))
      rows = rows.filter((row) => row.amount_cents <= Number(values[index++]));
  }
  return rows.map((row) => {
    const category = db.rows.categories.find((item) => item.id === row.category_id && !item.deleted_at);
    return transactionRow({ ...row, category_name: category?.name });
  });
}

function selectSimple(rows: Row[], lower: string, values: unknown[], category: boolean) {
  let filtered = rows.filter((row) => !row.deleted_at);
  if (lower.includes("where user_id = ? and name = ?") || lower.includes("where user_id=? and name=?")) {
    filtered = filtered.filter((row) => row.user_id === values[0] && row.name === values[1]);
    if (lower.includes("type = ?")) filtered = filtered.filter((row) => row.type === values[2]);
  } else if (lower.includes("where user_id = ?") || lower.includes("where user_id=?"))
    filtered = filtered.filter((row) => row.user_id === values[0]);
  else if (lower.includes("where id = ?")) filtered = filtered.filter((row) => row.id === values[0]);
  if (lower.includes("id in (")) {
    const categoryIds = new Set(values.slice(1));
    filtered = filtered.filter((row) => categoryIds.has(row.id));
  }
  return filtered.map((row) =>
    category
      ? {
          id: row.id,
          userId: row.user_id,
          name: row.name,
          type: row.type,
          icon: row.icon,
          sortOrder: row.sort_order,
        }
      : { id: row.id, userId: row.user_id, name: row.name },
  );
}

function selectInvitations(db: TestD1Database, lower: string, values: unknown[]) {
  let rows = db.rows.invitations.filter((row) => !row.deleted_at);
  if (lower.includes("where book_id=? and status='pending'")) {
    rows = rows.filter(
      (row) =>
        row.book_id === values[0] &&
        row.status === "pending" &&
        ((values[1] !== "" && row.invitee_email === values[2]) ||
          (values[3] !== "" && row.invitee_phone === values[4]) ||
          (values[5] !== "" && row.invitee_user_id === values[6])),
    );
  } else if (lower.includes("where book_id=?")) rows = rows.filter((row) => row.book_id === values[0]);
  else if (lower.includes("where id=?")) rows = rows.filter((row) => row.id === values[0]);
  else if (lower.includes("invitee_user_id=?"))
    rows = rows.filter(
      (row) =>
        row.invitee_user_id === values[0] ||
        (row.invitee_email && row.invitee_email === values[1]) ||
        (row.invitee_phone && row.invitee_phone === values[2]),
    );
  return rows.map(invitationRow);
}

function selectUsersWithPlan(db: TestD1Database, lower: string, values: unknown[]) {
  const value = values[0];
  const users = db.rows.users.filter((user) => !user.deleted_at);
  const matched =
    lower.includes("u.name = ?") && !lower.includes("provider_account_id")
      ? users.filter((user) => user.name === value)
      : users.filter(
          (user) =>
            user.id === value ||
            user.name === value ||
            user.email === value ||
            user.phone === value ||
            db.rows.auth_identities.some(
              (identity) => identity.user_id === user.id && identity.provider_account_id === value,
            ),
        );
  return matched.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatar_url,
    phone: user.phone,
    plan:
      db.rows.subscriptions.find((row) => row.user_id === user.id && row.status === "active")?.plan ?? "free",
  }));
}

function selectImportJobs(db: TestD1Database, lower: string, values: unknown[]) {
  if (lower.includes("count(*)")) {
    return [
      {
        count: db.rows.import_jobs.filter(
          (row) =>
            row.user_id === values[0] &&
            String(row.file_type).startsWith("image/") &&
            !row.deleted_at &&
            String(row.created_at) >= String(values[1]) &&
            String(row.created_at) < String(values[2]) &&
            !["completed", "pending_confirmation", "failed", "cancelled"].includes(row.status),
        ).length,
      },
    ];
  }
  let rows = db.rows.import_jobs.filter((row) => !row.deleted_at);
  if (lower.includes("where id=?")) rows = rows.filter((row) => row.id === values[0]);
  else if (lower.includes("where user_id=?")) rows = rows.filter((row) => row.user_id === values[0]);
  else if (lower.includes("where book_id=?")) rows = rows.filter((row) => row.book_id === values[0]);
  return rows.map(importJobRow);
}

function selectImportedRecords(db: TestD1Database, lower: string, values: unknown[]) {
  const rows = db.rows.imported_records.filter(
    (row) =>
      !row.deleted_at &&
      (lower.includes("where id=?") ? row.id === values[0] : row.import_job_id === values[0]),
  );
  return rows.map((row) => ({
    id: row.id,
    importJobId: row.import_job_id,
    suggestedTransaction: row.suggested_transaction,
    status: row.status,
    confidence: row.confidence,
    warnings: row.warnings,
  }));
}

function selectAiConfirmations(db: TestD1Database, lower: string, values: unknown[]) {
  let rows = db.rows.ai_confirmations.filter((row) => !row.deleted_at);
  if (lower.includes("where id=?"))
    rows = rows.filter((row) => row.id === values[0] && row.user_id === values[1]);
  else
    rows = rows.filter(
      (row) => row.book_id === values[0] && row.action === "invite-member" && row.status === "pending",
    );
  return rows.map(aiConfirmationRow);
}

function selectAiSessions(db: TestD1Database, lower: string, values: unknown[]) {
  let rows = db.rows.ai_sessions.filter((row) => !row.deleted_at);
  if (lower.includes("where id=?"))
    rows = rows.filter((row) => row.id === values[0] && row.user_id === values[1]);
  else rows = rows.filter((row) => row.user_id === values[0]);
  return rows.map(aiSessionRow);
}

function selectAiToolCalls(db: TestD1Database, lower: string, values: unknown[]) {
  let rows = db.rows.ai_tool_calls.filter(
    (row) => !row.deleted_at && row.user_id === values[0] && row.session_id === values[1],
  );
  if (lower.includes("tool_name=?")) rows = rows.filter((row) => row.tool_name === values[2]);
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    bookId: row.book_id,
    skillName: row.skill_name,
    toolName: row.tool_name,
    status: row.status,
    args: row.args,
    result: row.result,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function bookRow(row: Row) {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function transactionRow(row: Row) {
  return {
    id: row.id,
    bookId: row.book_id,
    type: row.type,
    amount: row.amount_cents / 100,
    categoryId: row.category_id,
    categoryName: row.category_name,
    memberId: row.member_id,
    createdByUserId: row.created_by_user_id,
    note: row.note,
    occurredAt: row.occurred_at,
  };
}

function invitationRow(row: Row) {
  return {
    id: row.id,
    bookId: row.book_id,
    inviterUserId: row.inviter_user_id,
    inviteeEmail: row.invitee_email,
    inviteePhone: row.invitee_phone,
    inviteeUserId: row.invitee_user_id,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
    lastRemindedAt: row.last_reminded_at,
  };
}

function importJobRow(row: Row) {
  return {
    id: row.id,
    bookId: row.book_id,
    userId: row.user_id,
    fileName: row.file_name,
    fileType: row.file_type,
    r2Key: row.r2_key,
    status: row.status,
    autoConfirm: row.auto_confirm,
    errorMessage: row.error_message,
    errorCode: row.error_code,
    errorStage: row.error_stage,
    errorRequestId: row.error_request_id,
    errorRetryable: row.error_retryable,
    errorTerminal: row.error_terminal,
    failedExternalJobId: row.failed_external_job_id,
    cancelable: row.cancelable,
    retryable: row.retryable,
    retryCount: row.retry_count,
    ocrJobId: row.ocr_job_id,
    alephTool: row.aleph_tool,
    ocrSubmittedAt: row.ocr_submitted_at,
    ocrProgress: row.ocr_progress,
    ocrStage: row.ocr_stage,
    ocrCurrentPage: row.ocr_current_page,
    ocrTotalPages: row.ocr_total_pages,
    ocrCompletedAt: row.ocr_completed_at,
    ocrEventSequence: row.ocr_event_sequence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedByUserId: row.deleted_by_user_id,
  };
}

function aiConfirmationRow(row: Row) {
  return {
    id: row.id,
    userId: row.user_id,
    bookId: row.book_id,
    action: row.action,
    status: row.status,
    payload: row.payload,
    result: row.result,
    expiresAt: row.expires_at,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function aiSessionRow(row: Row) {
  return {
    id: row.id,
    userId: row.user_id,
    bookId: row.book_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function aiMessageRow(row: Row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    parts: row.parts,
    attachments: row.attachments,
    createdAt: row.created_at,
  };
}

function desc(column: string) {
  return (a: Row, b: Row) => String(b[column] ?? "").localeCompare(String(a[column] ?? ""));
}

export type D1TestContext = ReturnType<typeof createD1TestApp>;

export function createD1TestApp() {
  const db = new TestD1Database();
  const files = new FakeR2Bucket();
  const alephTools = new FakeAlephToolsBinding();
  const app = createApp();
  const env: Env = {
    APP_ENV: "test",
    DB: db as unknown as D1Database,
    FILES: files as unknown as R2Bucket,
    ALEPH_TOOLS: alephTools,
    ALEPH_TOOLS_API_KEY: "test-tools-key",
    ALEPH_TOOLS_WEBHOOK_SECRET: "test-webhook-secret",
    API_PUBLIC_ORIGIN: "https://api.test",
  };
  return { app, db, files, alephTools, env, repository: new D1LedgerRepository(db as unknown as D1Database) };
}

export function authHeaders(
  user: LedgerUser | { id: string; name?: string; plan?: "free" | "pro"; email?: string },
) {
  return {
    Cookie: `ledger_session=${testSessionToken(user.id)}`,
  };
}

export function seedUser(db: TestD1Database, input: Partial<LedgerUser> & { id?: string } = {}) {
  const timestamp = now();
  const user: LedgerUser = {
    id: input.id ?? id("user"),
    name: input.name ?? "User",
    email: input.email ?? `${crypto.randomUUID()}@test.local`,
    plan: input.plan ?? "free",
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
  };
  db.rows.users.push({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    avatar_url: user.avatarUrl ?? null,
    password_hash: "test",
    created_at: timestamp,
    updated_at: timestamp,
    created_by_user_id: user.id,
    updated_by_user_id: user.id,
  });
  db.rows.subscriptions.push({
    id: id("subscription"),
    user_id: user.id,
    plan: user.plan,
    status: "active",
    started_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
    created_by_user_id: user.id,
    updated_by_user_id: user.id,
  });
  db.rows.auth_sessions.push({
    id: id("session"),
    user_id: user.id,
    token_hash: testSessionHash(user.id),
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    created_at: timestamp,
  });
  return user;
}

export function seedBook(
  db: TestD1Database,
  creator: LedgerUser,
  input: { id?: string; name?: string; currency?: string } = {},
) {
  const timestamp = now();
  const book = {
    id: input.id ?? id("book"),
    name: input.name ?? `${creator.name} 的账本`,
    currency: input.currency ?? "CNY",
    createdByUserId: creator.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.rows.books.push({
    id: book.id,
    name: book.name,
    currency: book.currency,
    created_by_user_id: creator.id,
    updated_by_user_id: creator.id,
    created_at: timestamp,
    updated_at: timestamp,
  });
  seedMember(db, book.id, creator, "creator");
  return book;
}

export function seedMember(
  db: TestD1Database,
  bookId: string,
  user: LedgerUser,
  role: "creator" | "admin" | "member" = "member",
) {
  const timestamp = now();
  const member = { id: id("member"), bookId, userId: user.id, name: user.name, role, joinedAt: timestamp };
  db.rows.book_members.push({
    id: member.id,
    book_id: bookId,
    user_id: user.id,
    role,
    joined_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
    created_by_user_id: user.id,
    updated_by_user_id: user.id,
  });
  return member;
}

export async function seedTransaction(
  repository: D1LedgerRepository,
  input: {
    bookId: string;
    userId: string;
    amount?: number;
    type?: "income" | "expense";
    note?: string;
    memberId?: string;
  },
) {
  return repository.createTransaction(input.bookId, input.userId, {
    type: input.type ?? "expense",
    amount: input.amount ?? 10,
    memberId: input.memberId,
    note: input.note ?? "测试记录",
    occurredAt: "2026-06-28T12:00:00.000Z",
    items: [],
  });
}

class FakeR2Bucket {
  objects = new Map<
    string,
    { bytes: ArrayBuffer; httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> }
  >();

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream,
    options?: R2PutOptions,
  ) {
    const bytes =
      typeof value === "string"
        ? arrayBufferFromView(new TextEncoder().encode(value))
        : value instanceof ArrayBuffer
          ? value
          : ArrayBuffer.isView(value)
            ? arrayBufferFromView(value)
            : new ArrayBuffer(0);
    this.objects.set(key, {
      bytes,
      httpMetadata: options?.httpMetadata as R2HTTPMetadata | undefined,
      customMetadata: options?.customMetadata,
    });
    return {} as R2Object;
  }

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      body: new Blob([object.bytes]).stream(),
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
      arrayBuffer: async () => object.bytes,
    };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}

function arrayBufferFromView(view: ArrayBufferView) {
  const copy = new Uint8Array(view.byteLength);
  copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return copy.buffer;
}

class FakeAlephToolsBinding {
  requests: Request[] = [];
  nextJobId = "ocr_test_job";
  jobStatus: Record<string, any> = {};
  result: Record<string, any> = {};

  async fetch(request: Request) {
    this.requests.push(request);
    const url = new URL(request.url);
    if (url.pathname === "/v1/tools/ocr") {
      const jobId = `${this.nextJobId}_${this.requests.length}`;
      this.jobStatus[jobId] = { jobId, status: "queued", progress: 0, resultAvailable: false };
      return Response.json({ success: true, data: this.jobStatus[jobId] });
    }
    const jobId = url.pathname.split("/")[3];
    if (url.pathname.endsWith("/result")) {
      return Response.json({
        success: true,
        data: this.result[jobId] ?? {
          plainText: "早餐 12 元",
          markdown: "早餐 12 元",
          pages: [{ text: "早餐 12 元", confidence: 0.95 }],
        },
      });
    }
    if (url.pathname.endsWith("/cancel")) {
      this.jobStatus[jobId] = { ...(this.jobStatus[jobId] ?? { jobId }), status: "cancel_requested" };
      return Response.json({ success: true, data: this.jobStatus[jobId] });
    }
    return Response.json({
      success: true,
      data: this.jobStatus[jobId] ?? { jobId, status: "ready", resultAvailable: true },
    });
  }
}
