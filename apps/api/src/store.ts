import type { Book, LedgerUser, Member, Transaction } from "./types";

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export type Invitation = {
  id: string;
  bookId: string;
  inviterUserId: string;
  inviteeEmail?: string;
  inviteePhone?: string;
  inviteeUserId?: string;
  role: "admin" | "member";
  status: "pending" | "accepted" | "declined" | "expired" | "revoked";
  expiresAt: string;
  lastRemindedAt?: string;
};
export type ImportJob = {
  id: string;
  bookId: string;
  userId: string;
  fileName: string;
  fileType: string;
  r2Key: string;
  status: string;
  autoConfirm?: boolean;
  errorMessage?: string;
  errorCode?: string;
  errorStage?: string;
  errorRequestId?: string;
  errorRetryable?: boolean;
  errorTerminal?: boolean;
  failedExternalJobId?: string;
  cancelable?: boolean;
  retryable?: boolean;
  retryCount?: number;
  convertJobId?: string;
  convertEventSequence?: number;
  convertedR2Key?: string;
  convertedFileType?: string;
  ocrJobId?: string;
  ocrSubmittedAt?: string;
  ocrProgress?: number;
  ocrStage?: string;
  ocrCurrentPage?: number;
  ocrTotalPages?: number;
  ocrCompletedAt?: string;
  ocrEventSequence?: number;
  createdAt: string;
  updatedAt: string;
};
export type ImportedRecord = {
  id: string;
  importJobId: string;
  suggestedTransaction: Record<string, unknown>;
  status: "pending" | "confirmed" | "ignored" | "duplicated";
  confidence: number;
  warnings: string[];
};
export type SimpleEntity = {
  id: string;
  bookId: string;
  name: string;
  type?: string;
  icon?: string;
  color?: string;
  sortOrder?: number;
};

export class MemoryLedgerStore {
  users: LedgerUser[] = [{ id: "user_demo", name: "张三", email: "demo@ledger.local", plan: "free" }];
  books: Book[] = [
    {
      id: "book_home",
      name: "家庭账本",
      currency: "CNY",
      createdByUserId: "user_demo",
      createdAt: now(),
      updatedAt: now(),
    },
  ];
  members: Member[] = [
    {
      id: "member_demo",
      bookId: "book_home",
      userId: "user_demo",
      name: "张三",
      role: "creator",
      joinedAt: now(),
    },
  ];
  transactions: Transaction[] = [
    {
      id: "tx_market",
      bookId: "book_home",
      type: "expense",
      amount: 158.6,
      categoryId: "cat_food",
      createdByUserId: "user_demo",
      memberId: "member_demo",
      note: "超市购物",
      occurredAt: "2026-06-20T10:00:00.000Z",
      tagIds: ["tag_daily"],
      items: [],
    },
    {
      id: "tx_salary",
      bookId: "book_home",
      type: "income",
      amount: 8500,
      categoryId: "cat_salary",
      createdByUserId: "user_demo",
      memberId: "member_demo",
      note: "工资收入",
      occurredAt: "2026-06-18T09:00:00.000Z",
      tagIds: [],
      items: [],
    },
  ];
  invitations: Invitation[] = [];
  imports: ImportJob[] = [];
  records: ImportedRecord[] = [];
  categories: SimpleEntity[] = [
    { id: "cat_food", bookId: "book_home", name: "餐饮", type: "expense", icon: "fork-knife", sortOrder: 1 },
    { id: "cat_salary", bookId: "book_home", name: "工资", type: "income", icon: "wallet", sortOrder: 1 },
  ];
  tags: SimpleEntity[] = [{ id: "tag_daily", bookId: "book_home", name: "日常", color: "#ff6b1a" }];
  createUser(name: string, email: string, plan: LedgerUser["plan"] = "free") {
    const user = { id: id("user"), name, email, plan };
    this.users.push(user);
    return user;
  }
  createBook(user: LedgerUser, name: string, currency: string) {
    const book = {
      id: id("book"),
      name,
      currency,
      createdByUserId: user.id,
      createdAt: now(),
      updatedAt: now(),
    };
    this.books.push(book);
    this.members.push({
      id: id("member"),
      bookId: book.id,
      userId: user.id,
      name: user.name,
      role: "creator",
      joinedAt: now(),
    });
    return book;
  }
  role(bookId: string, userId: string) {
    return this.members.find((member) => member.bookId === bookId && member.userId === userId)?.role;
  }
  createTransaction(
    bookId: string,
    userId: string,
    input: Omit<Transaction, "id" | "bookId" | "createdByUserId">,
  ) {
    const tx = {
      ...input,
      id: id("tx"),
      bookId,
      createdByUserId: userId,
      items: input.items.map((item) => ({ ...item, id: id("item") })),
    };
    this.transactions.unshift(tx);
    return tx;
  }
  createSimple(kind: "categories" | "tags", bookId: string, data: Omit<SimpleEntity, "id" | "bookId">) {
    const value = { ...data, id: id(kind.slice(0, 3)), bookId };
    this[kind].push(value);
    return value;
  }
}
