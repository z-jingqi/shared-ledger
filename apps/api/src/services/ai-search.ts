import type { AiAnalysisCardPart, AiChatPart, AiNavigationCardPart, AiSearchResultCardPart } from "@shared-ledger/shared";
import { D1LedgerRepository } from "../repository";
import type { MemoryLedgerStore, SimpleEntity } from "../store";
import type { Transaction } from "../types";
import {
  normalizeTransactionQuery,
  type NormalizedTransactionSearch,
  type TransactionSearchChip,
  type TransactionSearchFilters,
} from "./ai-normalizer";

type TransactionSearchRepository = D1LedgerRepository | MemoryLedgerStore;

export type TransactionSearchIntent = Partial<TransactionSearchFilters> & {
  chips?: TransactionSearchChip[];
};

export type TransactionSearchIntentProvider = {
  inferTransactionSearchIntent(input: {
    query: string;
    baseFilters?: TransactionSearchFilters;
    categories: SimpleEntity[];
    timeZone?: string;
  }): Promise<TransactionSearchIntent | null>;
};

export type TransactionSearchInput = {
  bookId: string;
  query: string;
  baseFilters?: TransactionSearchFilters;
  timeZone?: string;
  allowUnfiltered?: boolean;
  limit?: number;
};

export type TransactionSearchResult = {
  id: string;
  type: "income" | "expense";
  amount: number;
  occurredAt: string;
  title: string;
  description?: string;
  categoryId?: string;
  categoryName?: string;
  note?: string;
};

export type TransactionSearchResponse = {
  filters: TransactionSearchFilters;
  chips: TransactionSearchChip[];
  results: TransactionSearchResult[];
  summary: string;
  href: string;
  needsClarification: boolean;
  clarification?: string;
};

export type TransactionAnalysisResponse = {
  filters: TransactionSearchFilters;
  chips: TransactionSearchChip[];
  results: TransactionSearchResult[];
  summary: string;
  metrics: Array<{ label: string; value: string | number; hint?: string }>;
  href: string;
};

export class TransactionSearchService {
  constructor(
    private readonly repository: TransactionSearchRepository,
    private readonly intentProvider?: TransactionSearchIntentProvider,
  ) {}

  async search(input: TransactionSearchInput): Promise<TransactionSearchResponse> {
    const categories = await this.listCategories(input.bookId);
    const normalized = await this.normalize(input, categories);
    const href = buildRecordsHref(input.bookId, normalized.filters);
    if (!input.allowUnfiltered && !hasSearchConstraint(normalized.filters) && !normalized.understood) {
      return {
        filters: normalized.filters,
        chips: normalized.chips,
        results: [],
        summary: "请补充时间、金额、类型、分类或关键词后再搜索。",
        href,
        needsClarification: true,
        clarification: "请补充时间、金额、类型、分类或关键词后再搜索。",
      };
    }

    const records = await this.searchTransactions(input.bookId, normalized.filters);
    const categoryNames = categoryMap(categories);
    const results = records
      .map((transaction) => transactionResult(transaction, categoryNames))
      .slice(0, input.limit ?? 20);
    return {
      filters: normalized.filters,
      chips: normalized.chips,
      results,
      summary: summarizeResults(records),
      href,
      needsClarification: false,
    };
  }

  async analyze(input: TransactionSearchInput): Promise<TransactionAnalysisResponse> {
    const search = await this.search({ ...input, allowUnfiltered: true, limit: input.limit ?? 100 });
    const income = sum(search.results.filter((record) => record.type === "income"));
    const expense = sum(search.results.filter((record) => record.type === "expense"));
    const largest = [...search.results].sort((a, b) => b.amount - a.amount)[0];
    const metrics: TransactionAnalysisResponse["metrics"] = [
      { label: "收入", value: formatMoney(income) },
      { label: "支出", value: formatMoney(expense) },
      { label: "结余", value: formatMoney(income - expense) },
      { label: "记录数", value: search.results.length },
    ];
    if (largest) metrics.push({ label: "最大单笔", value: formatMoney(largest.amount), hint: largest.title });
    return {
      filters: search.filters,
      chips: search.chips,
      results: search.results,
      summary: `共 ${search.results.length} 条记录，支出 ${formatMoney(expense)}，收入 ${formatMoney(income)}`,
      metrics,
      href: search.href,
    };
  }

  searchParts(result: TransactionSearchResponse): AiChatPart[] {
    if (result.needsClarification) return [{ type: "text", text: result.clarification ?? result.summary }];
    const card: AiSearchResultCardPart = {
      type: "search-result-card",
      title: "搜索结果",
      summary: result.summary,
      results: result.results.map((record) => ({
        id: record.id,
        title: record.title,
        ...(record.description ? { description: record.description } : {}),
        amount: record.amount,
      })),
      pageName: "记录页",
      href: result.href,
    };
    const nav: AiNavigationCardPart = {
      type: "navigation-card",
      pageName: "记录页",
      description: "打开筛选后的记录列表",
      href: result.href,
    };
    return [
      {
        type: "tool-status",
        tool: "search-records",
        status: "success",
        label: "搜索完成",
        message: result.summary,
      },
      card,
      nav,
    ];
  }

  analysisParts(result: TransactionAnalysisResponse): AiChatPart[] {
    const card: AiAnalysisCardPart = {
      type: "analysis-card",
      title: "账本分析",
      summary: result.summary,
      metrics: result.metrics,
    };
    return [
      { type: "tool-status", tool: "analyze-records", status: "success", label: "分析完成", message: "已完成账本分析" },
      card,
    ];
  }

  private async normalize(input: TransactionSearchInput, categories: SimpleEntity[]): Promise<NormalizedTransactionSearch> {
    const fallback = normalizeTransactionQuery(input.query, {
      baseFilters: input.baseFilters,
      categories,
      timeZone: input.timeZone,
    });
    if (!this.intentProvider) return fallback;
    try {
      const intent = await this.intentProvider.inferTransactionSearchIntent({
        query: input.query,
        baseFilters: input.baseFilters,
        categories,
        timeZone: input.timeZone,
      });
      if (!intent) return fallback;
      return {
        filters: { ...fallback.filters, ...compactIntent(intent) },
        chips: intent.chips?.length ? mergeChips(fallback.chips, intent.chips) : fallback.chips,
        understood: true,
      };
    } catch {
      return fallback;
    }
  }

  private async listCategories(bookId: string) {
    return this.repository instanceof D1LedgerRepository
      ? this.repository.listSimple("categories", bookId)
      : this.repository.categories.filter((category) => category.bookId === bookId);
  }

  private async searchTransactions(bookId: string, filters: TransactionSearchFilters) {
    if (this.repository instanceof D1LedgerRepository) return this.repository.searchTransactions(bookId, filters);
    const categoryNames = categoryMap(this.repository.categories.filter((category) => category.bookId === bookId));
    const q = filters.q?.toLowerCase();
    const records = this.repository.transactions.filter((transaction) => {
      if (transaction.bookId !== bookId) return false;
      if (filters.type && transaction.type !== filters.type) return false;
      if (filters.minAmount !== undefined && transaction.amount <= filters.minAmount) return false;
      if (filters.maxAmount !== undefined && transaction.amount >= filters.maxAmount) return false;
      if (filters.from && transaction.occurredAt < filters.from) return false;
      if (filters.to && transaction.occurredAt > filters.to) return false;
      if (filters.categoryId && transaction.categoryId !== filters.categoryId) return false;
      if (filters.categoryName && categoryNames.get(transaction.categoryId ?? "") !== filters.categoryName) return false;
      if (q && !matchesKeyword(transaction, categoryNames.get(transaction.categoryId ?? ""), q)) return false;
      return true;
    });
    return sortTransactions(records, filters.sort);
  }
}

function compactIntent(intent: TransactionSearchIntent): TransactionSearchFilters {
  const filters: TransactionSearchFilters = {};
  if (intent.type === "income" || intent.type === "expense") filters.type = intent.type;
  if (typeof intent.minAmount === "number" && Number.isFinite(intent.minAmount)) filters.minAmount = intent.minAmount;
  if (typeof intent.maxAmount === "number" && Number.isFinite(intent.maxAmount)) filters.maxAmount = intent.maxAmount;
  if (intent.from) filters.from = intent.from;
  if (intent.to) filters.to = intent.to;
  if (intent.categoryId) filters.categoryId = intent.categoryId;
  if (intent.categoryName) filters.categoryName = intent.categoryName;
  if (intent.q) filters.q = intent.q;
  if (intent.sort) filters.sort = intent.sort;
  return filters;
}

function mergeChips(base: TransactionSearchChip[], next: TransactionSearchChip[]) {
  const chips = [...base];
  for (const chip of next) {
    const index = chips.findIndex((item) => item.key === chip.key);
    if (index >= 0) chips.splice(index, 1, chip);
    else chips.push(chip);
  }
  return chips;
}

function hasSearchConstraint(filters: TransactionSearchFilters) {
  return Boolean(
    filters.type ||
      filters.minAmount !== undefined ||
      filters.maxAmount !== undefined ||
      filters.from ||
      filters.to ||
      filters.categoryId ||
      filters.categoryName ||
      filters.q ||
      filters.sort,
  );
}

function categoryMap(categories: SimpleEntity[]) {
  return new Map(categories.map((category) => [category.id, category.name]));
}

function transactionResult(transaction: Transaction, categories: Map<string, string>): TransactionSearchResult {
  const categoryName = transaction.categoryId ? categories.get(transaction.categoryId) : undefined;
  const title = transaction.note ?? categoryName ?? (transaction.type === "income" ? "收入" : "支出");
  const description = [categoryName, transaction.type === "income" ? "收入" : "支出", transaction.occurredAt.slice(0, 10)]
    .filter(Boolean)
    .join(" · ");
  return {
    id: transaction.id,
    type: transaction.type,
    amount: transaction.amount,
    occurredAt: transaction.occurredAt,
    title,
    ...(description ? { description } : {}),
    ...(transaction.categoryId ? { categoryId: transaction.categoryId } : {}),
    ...(categoryName ? { categoryName } : {}),
    ...(transaction.note ? { note: transaction.note } : {}),
  };
}

function matchesKeyword(transaction: Transaction, categoryName: string | undefined, q: string) {
  const haystack = [
    transaction.note,
    categoryName,
    ...transaction.items.flatMap((item) => [item.name, item.note]),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return haystack.includes(q);
}

function sortTransactions(records: Transaction[], sort: TransactionSearchFilters["sort"]) {
  const next = [...records];
  switch (sort) {
    case "date_asc":
      return next.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    case "amount_desc":
      return next.sort((a, b) => b.amount - a.amount || b.occurredAt.localeCompare(a.occurredAt));
    case "amount_asc":
      return next.sort((a, b) => a.amount - b.amount || b.occurredAt.localeCompare(a.occurredAt));
    case "date_desc":
    default:
      return next.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
}

function summarizeResults(records: Transaction[]) {
  const income = sum(records.filter((record) => record.type === "income"));
  const expense = sum(records.filter((record) => record.type === "expense"));
  return `找到 ${records.length} 条记录，支出 ${formatMoney(expense)}，收入 ${formatMoney(income)}`;
}

function sum(records: Array<{ amount: number }>) {
  return Number(records.reduce((total, record) => total + record.amount, 0).toFixed(2));
}

function formatMoney(value: number) {
  return `¥${value.toFixed(2)}`;
}

function buildRecordsHref(bookId: string, filters: TransactionSearchFilters) {
  const params = new URLSearchParams();
  params.set("bookId", bookId);
  params.set("source", "ai");
  if (filters.type) params.set("type", filters.type);
  if (filters.minAmount !== undefined) params.set("min", String(filters.minAmount));
  if (filters.maxAmount !== undefined) params.set("max", String(filters.maxAmount));
  if (filters.from) params.set("start", filters.from.slice(0, 10));
  if (filters.to) params.set("end", filters.to.slice(0, 10));
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.categoryName && !filters.categoryId) params.set("category", filters.categoryName);
  if (filters.q) params.set("q", filters.q);
  if (filters.sort) params.set("sort", filters.sort);
  return `/records?${params.toString()}`;
}
