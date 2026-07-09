import type { LedgerAiTestClient } from "@shared-ledger/ai";

export type ImportPipelineStep = "ocr" | "ai";

export type ImportPipelineMessage = {
  jobId: string;
  step: ImportPipelineStep;
};

export type Env = {
  DB?: D1Database;
  FILES?: R2Bucket;
  IMPORT_PIPELINE_QUEUE?: Queue<ImportPipelineMessage>;
  AI_PROVIDER?: "openrouter" | "openai" | "workers-ai";
  AI_IMPORT_TIMEOUT_MS?: string;
  AI_IMPORT_STALE_MS?: string;
  AI_IMPORT_SUMMARY_MAX_TOKENS?: string;
  AI_IMPORT_ITEMS_MAX_TOKENS?: string;
  AI_TEST_CLIENT?: LedgerAiTestClient;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
  WORKERS_AI_BASE_URL?: string;
  WORKERS_AI_API_TOKEN?: string;
  WORKERS_AI_MODEL?: string;
  GOOGLE_VISION_API_KEY?: string;
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
