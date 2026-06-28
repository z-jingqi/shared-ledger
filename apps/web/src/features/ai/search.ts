import { api } from "../../lib";

export type AiTransactionSearchBaseFilters = {
  type?: "income" | "expense";
  sort?: "date_desc" | "amount_desc";
};

export type AiTransactionSearchInput = {
  bookId: string;
  query: string;
  baseFilters: AiTransactionSearchBaseFilters;
  timeZone: string;
};

export type AiTransactionSearchResponse = {
  filters?: Record<string, unknown>;
  filter?: Record<string, unknown>;
  chips?: unknown;
  summary?: string;
  href?: string;
  url?: string;
  transactions?: unknown[];
};

export function searchTransactionsWithAi(input: AiTransactionSearchInput) {
  return api<AiTransactionSearchResponse>("/ai/search/transactions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
