import { api } from "../../lib";
import { normalizeAiPart, type AiStructuredPart } from "./types";

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
  query?: string;
  filters?: Record<string, unknown>;
  filter?: Record<string, unknown>;
  chips?: unknown;
  summary?: string;
  href?: string;
  url?: string;
  transactions?: unknown[];
};

type AiSessionCreateResponse = { session: { id: string } };
type AiMessageResponse = { parts?: unknown[]; message?: { parts?: unknown[] } };

export async function searchTransactionsWithAi(input: AiTransactionSearchInput) {
  const session = await api<AiSessionCreateResponse>("/ai/sessions", {
    method: "POST",
    body: JSON.stringify({ bookId: input.bookId, title: input.query.slice(0, 40) || "AI 搜索" }),
  });
  const response = await api<AiMessageResponse>(`/ai/sessions/${session.session.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      bookId: input.bookId,
      message: input.query,
      page: "records",
      timeZone: input.timeZone,
      baseFilters: input.baseFilters,
    }),
  });
  return aiSearchResponseFromParts(input.query, [...(response.parts ?? []), ...(response.message?.parts ?? [])]);
}

function aiSearchResponseFromParts(query: string, rawParts: unknown[]): AiTransactionSearchResponse {
  const parts = rawParts.flatMap((part) => {
    const normalized = normalizeAiPart(part);
    return normalized ? [normalized] : [];
  });
  const filterResult = parts.find((part): part is AiStructuredPart & { type: "filter-result" } => part.type === "filter-result");
  const searchCard = parts.find((part): part is AiStructuredPart & { type: "search-result-card" } => part.type === "search-result-card");
  return {
    query,
    filters: filterResult?.filters ?? filterResult?.filter,
    filter: filterResult?.filter,
    chips: filterResult?.chips,
    summary: searchCard?.summary,
    href: filterResult?.href ?? searchCard?.href,
    url: filterResult?.url,
    transactions: searchCard?.results,
  };
}
