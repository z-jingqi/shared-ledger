import type { AiIntent, AiTransactionCandidate, TransactionType } from "@shared-ledger/shared";
import type { SimpleEntity } from "../store";

export type AiActionIntent = AiIntent;

export type AiActionSearchFilters = {
  type: "all" | TransactionType;
  minAmount?: number;
  maxAmount?: number;
  minAmountInclusive?: boolean;
  maxAmountInclusive?: boolean;
  start?: string;
  end?: string;
  categoryId?: string;
  categoryName?: string;
  q?: string;
  sort: "latest" | "occurredAt_desc" | "occurredAt_asc" | "amount_desc" | "amount_asc";
};

export type NormalizedSearch = {
  filters: AiActionSearchFilters;
  chips: string[];
};

export type TransactionSearchFilters = {
  type?: TransactionType;
  minAmount?: number;
  maxAmount?: number;
  from?: string;
  to?: string;
  categoryId?: string;
  categoryName?: string;
  q?: string;
  sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
};

export type TransactionSearchChip = { key: string; label: string; value: string };

export type NormalizedTransactionSearch = {
  filters: TransactionSearchFilters;
  chips: TransactionSearchChip[];
  understood: boolean;
};

export type NormalizedTransactionCandidate =
  | {
      ok: true;
      value: {
        type: TransactionType;
        amount: number;
        occurredAt: string;
        categoryName: string;
        note?: string;
      };
    }
  | { ok: false; missingFields: string[]; message: string };

const zhDigits: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

export function parseHeuristicIntent(text: string, hasAttachments = false): AiActionIntent {
  const normalized = text.trim();
  if (hasAttachments) {
    if (/忽略|不用|不要|取消|不保存|别存/.test(normalized)) {
      return {
        action: "save-attachments",
        confidence: 0.8,
        ingestion: {
          status: "not_requested",
          source: "attachment",
          attachmentIds: [],
          importJobIds: [],
          candidates: [],
          missingFields: [],
          message: "好的，我不会保存这些附件。",
          warnings: [],
        },
        missingFields: [],
        requiresConfirmation: false,
      };
    }
    return {
      action: "save-attachments",
      confidence: /保存|记账|入账|导入|记录|存到|添加到|这个入账|这张票/.test(normalized) ? 0.8 : 0.5,
      missingFields: [],
      requiresConfirmation: true,
    };
  }
  if (/邀请|加入|成员|拉.*进来/.test(normalized)) {
    const contact = extractContact(normalized);
    return {
      action: "invite-member",
      confidence: 0.75,
      invite: {
        ...contact,
        role: /管理员|admin|管理/.test(normalized) ? "admin" : "member",
      },
      missingFields: contact.email || contact.phone ? [] : ["contact"],
      followUpQuestion: contact.email || contact.phone ? undefined : "请提供要邀请成员的邮箱或手机号。",
      requiresConfirmation: true,
    };
  }
  if (/分析|统计|总结|报表|趋势|异常|建议|为什么/.test(normalized)) {
    return {
      action: "analyze-records",
      confidence: 0.7,
      search: transactionSearchFromArgs(searchArgumentsFromText(normalized)),
      missingFields: [],
      requiresConfirmation: false,
    };
  }
  const amount = parseMoneyText(normalized);
  if (amount !== undefined && !/查|搜索|找|筛选|大于|小于|超过|低于|高于|少于|多少/.test(normalized)) {
    return {
      action: "create-record",
      confidence: 0.72,
      transaction: transactionArgumentsFromText(normalized, amount),
      missingFields: [],
      requiresConfirmation: false,
    };
  }
  if (/查|搜索|找|筛选|大于|小于|超过|低于|最近|今天|昨天|前天|本周|上周|本月|上个月|今年|去年|多少/.test(normalized)) {
    return {
      action: "search-records",
      confidence: 0.75,
      search: transactionSearchFromArgs(searchArgumentsFromText(normalized)),
      missingFields: [],
      requiresConfirmation: false,
    };
  }
  if (amount !== undefined) {
    return {
      action: "create-record",
      confidence: 0.72,
      transaction: transactionArgumentsFromText(normalized, amount),
      missingFields: [],
      requiresConfirmation: false,
    };
  }
  return {
    action: "search-records",
    confidence: 0.3,
    missingFields: [],
    followUpQuestion: "我可以帮你记账、搜索、分析或邀请成员。请告诉我你想做什么。",
    requiresConfirmation: false,
  };
}

export function normalizeSearchFromIntent(
  intent: AiActionIntent,
  input: {
    query: string;
    today: string;
    categories: SimpleEntity[];
    baseType?: "all" | TransactionType;
    baseSort?: "latest" | "amount_desc";
  },
): NormalizedSearch {
  const normalized = normalizeTransactionQuery(input.query, {
    baseFilters: filtersFromIntent(intent),
    categories: input.categories,
  });
  return {
    filters: {
      type: normalized.filters.type ?? input.baseType ?? "all",
      minAmount: normalized.filters.minAmount,
      maxAmount: normalized.filters.maxAmount,
      start: normalized.filters.from,
      end: normalized.filters.to,
      categoryId: normalized.filters.categoryId,
      categoryName: normalized.filters.categoryName,
      q: normalized.filters.q,
      sort: normalized.filters.sort === "amount_desc" ? "amount_desc" : input.baseSort ?? "latest",
    },
    chips: normalized.chips.map((chip) => chip.value || chip.label),
  };
}

export function normalizeTransactionQuery(
  query: string,
  input: {
    baseFilters?: TransactionSearchFilters;
    categories?: SimpleEntity[];
    timeZone?: string;
    now?: Date;
  },
): NormalizedTransactionSearch {
  const categories = input.categories ?? [];
  const today = localToday(input.now ?? new Date(), input.timeZone);
  const args = searchArgumentsFromText(query);
  const filters: TransactionSearchFilters = { ...(input.baseFilters ?? {}) };
  const type = normalizeTransactionType(args.type);
  if (type) filters.type = type;
  const minAmount = numberFromUnknown(args.minAmount);
  const maxAmount = numberFromUnknown(args.maxAmount);
  if (minAmount !== undefined) filters.minAmount = minAmount;
  if (maxAmount !== undefined) filters.maxAmount = maxAmount;
  const categoryName = stringFromUnknown(args.categoryName);
  if (categoryName) {
    const category = findCategory(categories, categoryName, filters.type);
    if (category?.id) filters.categoryId = category.id;
    filters.categoryName = category?.name ?? categoryName;
  }
  const keyword = stringFromUnknown(args.q);
  if (keyword) filters.q = keyword;
  const range = normalizeDateRange(stringFromUnknown(args.dateExpression) ?? extractDateExpression(query), today);
  if (range?.start) filters.from = range.start;
  if (range?.end) filters.to = range.end;
  if (!filters.sort) filters.sort = "date_desc";
  return {
    filters,
    chips: transactionSearchChips(filters, categories),
    understood: hasTransactionSearchFilter(filters),
  };
}

export function normalizeTransactionCandidate(
  candidate: AiTransactionCandidate | Record<string, unknown>,
  input: { query: string; today: string; categories: SimpleEntity[] },
): NormalizedTransactionCandidate {
  const type = normalizeTransactionType(candidate.type) ?? (/收入|工资|奖金|报销|入账|收到|收款/.test(input.query) ? "income" : "expense");
  const amount = numberFromUnknown(candidate.amount) ?? parseMoneyText(String(candidate.amountText ?? input.query));
  const dateExpression = stringFromUnknown(candidate.dateExpression) ?? extractDateExpression(input.query);
  const occurredAt = normalizeSingleDate(stringFromUnknown(candidate.occurredAt) ?? dateExpression, input.today);
  const categoryName =
    stringFromUnknown(candidate.categoryName) ??
    inferCategoryName(input.query, type, input.categories) ??
    (type === "income" ? "收入" : "其他");
  const missingFields = [
    amount === undefined ? "amount" : "",
    occurredAt ? "" : "occurredAt",
  ].filter(Boolean);
  if (missingFields.length) {
    return {
      ok: false,
      missingFields,
      message: missingFields.includes("amount") ? "请补充金额。" : "请补充这笔记录的日期。",
    };
  }
  const note =
    stringFromUnknown(candidate.note) ??
    cleanNote(input.query, amount as number, dateExpression, categoryName) ??
    categoryName;
  return {
    ok: true,
    value: {
      type,
      amount: amount as number,
      occurredAt: `${occurredAt}T12:00:00.000Z`,
      categoryName,
      note,
    },
  };
}

function filtersFromIntent(intent: AiActionIntent): TransactionSearchFilters {
  const source = (intent.normalizedSearchFilters ?? intent.search) as Record<string, unknown> | undefined;
  if (!source) return {};
  const filters: TransactionSearchFilters = {};
  if (source.type === "income" || source.type === "expense") filters.type = source.type;
  if (typeof source.minAmount === "number") filters.minAmount = source.minAmount;
  if (typeof source.maxAmount === "number") filters.maxAmount = source.maxAmount;
  const from = typeof source.from === "string" ? source.from : typeof source.start === "string" ? source.start : undefined;
  const to = typeof source.to === "string" ? source.to : typeof source.end === "string" ? source.end : undefined;
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (typeof source.categoryId === "string") filters.categoryId = source.categoryId;
  if (typeof source.categoryName === "string") filters.categoryName = source.categoryName;
  if (Array.isArray(source.categoryIds) && typeof source.categoryIds[0] === "string") filters.categoryId = source.categoryIds[0];
  if (Array.isArray(source.categoryNames) && typeof source.categoryNames[0] === "string") filters.categoryName = source.categoryNames[0];
  const keyword = typeof source.q === "string" ? source.q : typeof source.query === "string" ? source.query : undefined;
  if (keyword) filters.q = keyword;
  if (source.sort === "amount_desc") filters.sort = "amount_desc";
  else if (source.sort === "amount_asc") filters.sort = "amount_asc";
  else if (source.sort === "occurredAt_asc") filters.sort = "date_asc";
  else if (source.sort === "occurredAt_desc") filters.sort = "date_desc";
  return filters;
}

function transactionSearchFromArgs(args: Record<string, unknown>): NonNullable<AiIntent["search"]> {
  return {
    type: normalizeTransactionType(args.type),
    minAmount: numberFromUnknown(args.minAmount),
    maxAmount: numberFromUnknown(args.maxAmount),
    categoryNames: stringFromUnknown(args.categoryName) ? [stringFromUnknown(args.categoryName)!] : [],
    query: stringFromUnknown(args.q),
    categoryIds: [],
    tagIds: [],
    tagNames: [],
    memberIds: [],
    memberNames: [],
    limit: 20,
    sort: "occurredAt_desc",
  };
}

function transactionArgumentsFromText(text: string, amount: number): AiTransactionCandidate {
  const type = /收入|工资|奖金|报销|入账|收到|收款/.test(text) ? "income" : "expense";
  return {
    type,
    amount,
    dateExpression: extractDateExpression(text),
    categoryName: inferCategoryName(text, type, []),
    tagIds: [],
    tagNames: [],
    items: [],
    confidence: 0.72,
    warnings: [],
  };
}

function searchArgumentsFromText(text: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (/支出|花费|消费|花了|付款/.test(text)) args.type = "expense";
  if (/收入|工资|入账|收到|收款|报销/.test(text)) args.type = "income";
  const greater = text.match(/(?:大于|超过|高于|>|多于)\s*([0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百千万点块元半]+)/);
  if (greater) args.minAmount = parseMoneyText(greater[1]);
  const less = text.match(/(?:小于|低于|少于|<|不到)\s*([0-9]+(?:\.[0-9]{1,2})?|[零一二两三四五六七八九十百千万点块元半]+)/);
  if (less) args.maxAmount = parseMoneyText(less[1]);
  const dateExpression = extractDateExpression(text);
  if (dateExpression) args.dateExpression = dateExpression;
  const category = inferCategoryName(text, args.type === "income" ? "income" : "expense", []);
  if (category && !["收入", "其他"].includes(category)) args.categoryName = category;
  const keyword = text
    .replace(/查|搜索|找|筛选|记录|支出|收入|大于|小于|超过|高于|低于|少于|最近|今天|昨天|前天|本周|上周|本月|上个月|今年|去年|多少/g, "")
    .replace(/[0-9]+(?:\.[0-9]+)?/g, "")
    .trim();
  if (keyword && keyword.length <= 30 && !category) args.q = keyword;
  return args;
}

function transactionSearchChips(filters: TransactionSearchFilters, categories: SimpleEntity[]) {
  const categoryName = filters.categoryName ?? categories.find((category) => category.id === filters.categoryId)?.name;
  const chips: TransactionSearchChip[] = [];
  if (filters.from || filters.to) {
    chips.push({
      key: "date",
      label: "时间",
      value: [filters.from?.slice(0, 10), filters.to?.slice(0, 10)].filter(Boolean).join(" 至 "),
    });
  }
  if (filters.type) chips.push({ key: "type", label: "类型", value: filters.type === "income" ? "收入" : "支出" });
  if (categoryName) chips.push({ key: "categoryId", label: "分类", value: categoryName });
  if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
    chips.push({
      key: "amount",
      label: "金额",
      value: [
        filters.minAmount !== undefined ? `大于 ${filters.minAmount}` : "",
        filters.maxAmount !== undefined ? `小于 ${filters.maxAmount}` : "",
      ]
        .filter(Boolean)
        .join(" 且 "),
    });
  }
  if (filters.q) chips.push({ key: "q", label: "关键词", value: filters.q });
  if (filters.sort && filters.sort !== "date_desc") chips.push({ key: "sort", label: "排序", value: filters.sort });
  return chips;
}

function hasTransactionSearchFilter(filters: TransactionSearchFilters) {
  const { sort, ...constraints } = filters;
  void sort;
  return Object.values(constraints).some((value) => value !== undefined && value !== "");
}

function normalizeSingleDate(value: string | undefined, today: string) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const range = normalizeDateRange(value, today);
  return range && range.start === range.end ? range.start : undefined;
}

function normalizeDateRange(expression: string | undefined, today: string) {
  if (!expression) return undefined;
  const base = fromYmd(today);
  const value = expression.trim();
  const isoDate = value.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoDate) return single(ymd(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3])));
  const cnDate = value.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]?/);
  if (cnDate) return single(ymd(Number(cnDate[1] ?? base.getFullYear()), Number(cnDate[2]), Number(cnDate[3])));
  if (value.includes("今天")) return single(today);
  if (value.includes("昨天")) return single(addDays(today, -1));
  if (value.includes("前天")) return single(addDays(today, -2));
  if (value.includes("本月")) return monthRange(base.getFullYear(), base.getMonth() + 1);
  if (value.includes("上个月") || value.includes("上月")) return monthRange(base.getFullYear(), base.getMonth());
  if (value.includes("今年")) return { start: `${base.getFullYear()}-01-01`, end: `${base.getFullYear()}-12-31` };
  if (value.includes("去年")) return { start: `${base.getFullYear() - 1}-01-01`, end: `${base.getFullYear() - 1}-12-31` };
  return undefined;
}

function extractDateExpression(text: string) {
  return (
    text.match(/(?:\d{4}年)?\d{1,2}月\d{1,2}[日号]?/)?.[0] ??
    text.match(/\d{4}-\d{1,2}-\d{1,2}/)?.[0] ??
    text.match(/今天|昨天|前天|本月|上个月|上月|今年|去年/)?.[0]
  );
}

function parseMoneyText(value: string) {
  const numeric = value.match(/([0-9]+(?:\.[0-9]{1,2})?)/)?.[1];
  if (numeric) return Number(numeric);
  const cleaned = value.replace(/[元块钱人民币\s]/g, "");
  if (!cleaned) return undefined;
  const parsed = parseChineseNumber(cleaned);
  return parsed > 0 ? parsed : undefined;
}

function parseChineseNumber(value: string): number {
  if (value.includes("点")) {
    const [left, right = ""] = value.split("点");
    const decimal = right
      .split("")
      .map((char) => zhDigits[char] ?? 0)
      .join("");
    return Number(`${parseChineseNumber(left)}.${decimal}`);
  }
  if (value === "半") return 0.5;
  let result = 0;
  let section = 0;
  let number = 0;
  for (const char of value) {
    if (char in zhDigits) number = zhDigits[char];
    else if (char === "十") {
      section += (number || 1) * 10;
      number = 0;
    } else if (char === "百") {
      section += (number || 1) * 100;
      number = 0;
    } else if (char === "千") {
      section += (number || 1) * 1000;
      number = 0;
    } else if (char === "万") {
      result += (section + number) * 10000;
      section = 0;
      number = 0;
    }
  }
  return result + section + number;
}

function normalizeTransactionType(value: unknown): TransactionType | undefined {
  if (value === "expense" || value === "支出") return "expense";
  if (value === "income" || value === "收入") return "income";
  return undefined;
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") return parseMoneyText(value);
  return undefined;
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function findCategory(categories: SimpleEntity[], name: string, type?: TransactionType) {
  return categories.find((category) => category.name === name && (!type || !category.type || category.type === type));
}

function inferCategoryName(text: string, type: TransactionType, categories: SimpleEntity[]) {
  const matched = categories.find((category) => text.includes(category.name) && (!category.type || category.type === type));
  if (matched) return matched.name;
  if (type === "income") return /工资|薪水|奖金/.test(text) ? "工资" : "收入";
  if (/饭|餐|吃|咖啡|奶茶|超市|水果|牛奶/.test(text)) return "餐饮";
  if (/打车|地铁|公交|出租|交通|停车|加油/.test(text)) return "交通";
  if (/房租|水电|物业|租房/.test(text)) return "居住";
  if (/购物|买|衣服|日用品/.test(text)) return "购物";
  return "其他";
}

function extractContact(text: string) {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0].toLowerCase();
  const phone = text.match(/(?:\+?\d[\d -]{5,}\d)/)?.[0].replaceAll(/[^\d+]/g, "");
  return { email, phone };
}

function cleanNote(text: string, amount: number, dateExpression: string | undefined, categoryName: string) {
  const note = text
    .replace(String(amount), "")
    .replace(/[0-9]+(?:\.[0-9]+)?/g, "")
    .replace(dateExpression ?? "", "")
    .replace(/支出|收入|花了|消费|记一笔|记账|保存|元|块|人民币|帮我|一下/g, "")
    .trim()
    .slice(0, 80);
  return note || categoryName;
}

function single(date: string) {
  return { start: date, end: date };
}

function monthRange(year: number, month: number) {
  const normalized = new Date(year, month - 1, 1);
  const start = ymd(normalized.getFullYear(), normalized.getMonth() + 1, 1);
  const endDate = new Date(normalized.getFullYear(), normalized.getMonth() + 1, 0);
  return { start, end: toYmd(endDate) };
}

function addDays(date: string, days: number) {
  const value = fromYmd(date);
  value.setDate(value.getDate() + days);
  return toYmd(value);
}

function ymd(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function localToday(date: Date, timeZone = "Asia/Shanghai") {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return toYmd(date);
  }
}

function fromYmd(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function toYmd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
