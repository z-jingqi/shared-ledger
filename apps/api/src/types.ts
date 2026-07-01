import type { AlephAIClient } from "@shared-ledger/ai";

export type WorkerServiceBinding = {
  fetch(request: Request): Promise<Response>;
};

export type Env = {
  DB?: D1Database;
  FILES?: R2Bucket;
  AI_ORCHESTRATOR?: WorkerServiceBinding;
  ALEPH_AI_ENV?: string;
  ALEPH_AI_SERVICE_TOKEN?: string;
  ALEPH_AI_TEST_CLIENT?: AlephAIClient;
  ALEPH_TOOLS?: WorkerServiceBinding;
  ALEPH_TOOLS_API_KEY?: string;
  ALEPH_TOOLS_WEBHOOK_SECRET?: string;
  API_PUBLIC_ORIGIN?: string;
  APP_ENV?: string;
  WEB_ORIGIN?: string;
  AUTH_COOKIE_SECRET?: string;
};
export type LedgerUser = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  plan: "free" | "pro";
  avatarUrl?: string;
};
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
  categoryName?: string;
  memberId?: string;
  createdByUserId: string;
  note?: string;
  occurredAt: string;
  items: Array<{ id: string; name: string; amount: number; categoryId?: string; note?: string }>;
};
