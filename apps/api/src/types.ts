import type { PaddleOcrContainer } from "./ocr";

export type Env = {
  DB?: D1Database;
  FILES?: R2Bucket;
  IMPORT_QUEUE?: Queue;
  OCR?: DurableObjectNamespace<PaddleOcrContainer>;
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  AI_PROVIDER_KEYS?: string;
  APP_ENV?: string;
  WEB_ORIGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  WECHAT_APP_ID?: string;
  WECHAT_APP_SECRET?: string;
  AUTH_COOKIE_SECRET?: string;
};
export type LedgerUser = { id: string; name: string; email: string; plan: "free" | "pro" };
export type Book = {
  id: string;
  name: string;
  currency: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};
export type Member = {
  id: string;
  bookId: string;
  userId: string;
  name: string;
  role: "creator" | "admin" | "member";
  joinedAt: string;
};
export type Transaction = {
  id: string;
  bookId: string;
  type: "income" | "expense";
  amount: number;
  categoryId?: string;
  accountId?: string;
  memberId?: string;
  createdByUserId: string;
  note?: string;
  occurredAt: string;
  tagIds: string[];
  items: Array<{ id: string; name: string; amount: number; categoryId?: string; note?: string }>;
};
