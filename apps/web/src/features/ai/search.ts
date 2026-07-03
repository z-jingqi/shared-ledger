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

type AiSearchResponse = { parts?: unknown[]; noSearch?: boolean };

export async function searchTransactionsWithAi(input: AiTransactionSearchInput) {
  const response = await api<AiSearchResponse>("/ai/records/search", {
    method: "POST",
    body: JSON.stringify({
      bookId: input.bookId,
      query: input.query,
      page: "records",
      timeZone: input.timeZone,
      baseFilters: input.baseFilters,
    }),
  });
  if (response.noSearch) {
    const message =
      response.parts
        ?.map(normalizeAiPart)
        .find((part): part is AiStructuredPart & { type: "text" } => part?.type === "text")?.text ??
      "这看起来不是流水搜索条件";
    throw new Error(message);
  }
  return aiSearchResponseFromParts(input.query, response.parts ?? []);
}

function aiSearchResponseFromParts(query: string, rawParts: unknown[]): AiTransactionSearchResponse {
  const parts = rawParts.flatMap((part) => {
    const normalized = normalizeAiPart(part);
    return normalized ? [normalized] : [];
  });
  const filterResult = parts.find(
    (part): part is AiStructuredPart & { type: "filter-result" } => part.type === "filter-result",
  );
  const searchCard = parts.find(
    (part): part is AiStructuredPart & { type: "search-result-card" } => part.type === "search-result-card",
  );
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
