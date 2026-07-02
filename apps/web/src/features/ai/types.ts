import type { ImportBatchJob } from "../imports/upload";

export type AiMessageRole = "user" | "assistant" | "system" | "tool";

export type AiTextPart = {
  type: "text";
  text: string;
};

export type AiToolStatusPart = {
  type: "tool-status";
  tool?: string;
  toolName?: string;
  label?: string;
  status?: "pending" | "running" | "success" | "failed" | "error" | "pending_confirmation";
  message?: string;
};

export type AiRecordCardPart = {
  type: "record-card";
  title?: string;
  amount?: number | string;
  note?: string;
  occurredAt?: string;
  categoryName?: string;
  pageName?: string;
  href?: string;
};

export type AiSearchResultCardPart = {
  type: "search-result-card";
  title?: string;
  summary?: string;
  results?: Array<{
    id?: string;
    title?: string;
    description?: string;
    amount?: number | string;
    pageName?: string;
    href?: string;
  }>;
  pageName?: string;
  href?: string;
};
export type AiFilterResultPart = {
  type: "filter-result";
  filters?: Record<string, unknown>;
  filter?: Record<string, unknown>;
  chips?: unknown;
  href?: string;
  url?: string;
};

export type AiAnalysisCardPart = {
  type: "analysis-card";
  title?: string;
  summary?: string;
  metrics?: Array<{ label: string; value: string | number; hint?: string }>;
};

export type AiImportJobCardPart = {
  type: "import-job-card";
  title?: string;
  message?: string;
  jobs?: ImportBatchJob[];
  pageName?: string;
  href?: string;
};

export type AiInviteCardPart = {
  type: "invite-card";
  title?: string;
  email?: string;
  role?: string;
  status?: string;
  pageName?: string;
  href?: string;
};

export type AiProfileCardPart = {
  type: "profile-card";
  title?: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
};

export type AiMemberCardPart = {
  type: "member-card";
  title?: string;
  name?: string;
  role?: string;
  status?: string;
};

export type AiNavigationCardPart = {
  type: "navigation-card";
  pageName: string;
  href?: string;
  to?: string;
  url?: string;
  path?: string;
  description?: string;
};

export type AiConfirmationPart = {
  type: "confirmation";
  confirmationId?: string;
  action?: string;
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  expiresAt?: string;
};

export type AiStructuredPart =
  | AiTextPart
  | AiToolStatusPart
  | AiRecordCardPart
  | AiFilterResultPart
  | AiSearchResultCardPart
  | AiAnalysisCardPart
  | AiImportJobCardPart
  | AiInviteCardPart
  | AiProfileCardPart
  | AiMemberCardPart
  | AiNavigationCardPart
  | AiConfirmationPart;

export type AiRenderableMessage = {
  id: string;
  role: AiMessageRole;
  parts?: unknown[];
};

const structuredPartTypes = new Set([
  "tool-status",
  "record-card",
  "filter-result",
  "search-result-card",
  "analysis-card",
  "import-job-card",
  "invite-card",
  "profile-card",
  "member-card",
  "navigation-card",
  "confirmation",
  "confirmation-card",
]);

export function normalizeAiPart(part: unknown): AiStructuredPart | undefined {
  if (!part || typeof part !== "object") return undefined;
  const candidate = part as Record<string, unknown>;
  const rawType = typeof candidate.type === "string" ? candidate.type : "";
  const type = rawType.startsWith("data-") ? rawType.slice(5) : rawType;
  const data =
    candidate.data && typeof candidate.data === "object"
      ? (candidate.data as Record<string, unknown>)
      : undefined;
  const payload = data ?? candidate;
  if (type === "text" && typeof payload.text === "string") return { type, text: payload.text };
  if (!structuredPartTypes.has(type)) return undefined;
  if (type === "tool-status") return normalizeToolStatus(payload);
  if (type === "record-card") return normalizeRecordCard(payload);
  if (type === "search-result-card") return normalizeSearchResultCard(payload);
  if (type === "analysis-card") return normalizeAnalysisCard(payload);
  if (type === "navigation-card") return normalizeNavigationCard(payload);
  if (type === "confirmation" || type === "confirmation-card") return normalizeConfirmation(payload);
  return { ...payload, type } as AiStructuredPart;
}

function normalizeToolStatus(payload: Record<string, unknown>): AiToolStatusPart {
  const rawStatus = stringValue(payload.status);
  const status =
    rawStatus === "error"
      ? "failed"
      : rawStatus === "pending_confirmation"
        ? "pending"
        : rawStatus === "failed" ||
            rawStatus === "success" ||
            rawStatus === "running" ||
            rawStatus === "pending"
          ? rawStatus
          : undefined;
  return {
    type: "tool-status",
    ...(stringValue(payload.tool) ? { tool: stringValue(payload.tool) } : {}),
    ...(stringValue(payload.toolName) ? { toolName: stringValue(payload.toolName) } : {}),
    ...(stringValue(payload.label) ? { label: stringValue(payload.label) } : {}),
    ...(status ? { status } : {}),
    ...(stringValue(payload.message) ? { message: stringValue(payload.message) } : {}),
  };
}

function normalizeRecordCard(payload: Record<string, unknown>): AiRecordCardPart {
  const transaction = objectValue(payload.transaction);
  const source = transaction ?? payload;
  const amount = numberOrString(source.amount);
  return {
    type: "record-card",
    ...(stringValue(payload.title) ? { title: stringValue(payload.title) } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(stringValue(source.note) ? { note: stringValue(source.note) } : {}),
    ...(stringValue(source.occurredAt) ? { occurredAt: stringValue(source.occurredAt) } : {}),
    ...(stringValue(source.categoryName) ? { categoryName: stringValue(source.categoryName) } : {}),
    pageName: stringValue(payload.pageName) ?? "记录详情",
    ...(stringValue(payload.href) ? { href: stringValue(payload.href) } : {}),
  };
}

function normalizeSearchResultCard(payload: Record<string, unknown>): AiSearchResultCardPart {
  const rawResults = Array.isArray(payload.results)
    ? payload.results
    : Array.isArray(payload.records)
      ? payload.records
      : [];
  return {
    type: "search-result-card",
    ...(stringValue(payload.title) ? { title: stringValue(payload.title) } : {}),
    ...(stringValue(payload.summary) ? { summary: stringValue(payload.summary) } : {}),
    results: rawResults.map((item, index) => normalizeSearchResult(item, index)),
    pageName: stringValue(payload.pageName) ?? "记录页",
    ...(stringValue(payload.href) ? { href: stringValue(payload.href) } : {}),
  };
}

function normalizeSearchResult(item: unknown, index: number) {
  const record = objectValue(item) ?? {};
  const amount = numberOrString(record.amount);
  return {
    id: stringValue(record.id) ?? `ai_result_${index}`,
    title:
      stringValue(record.title) ?? stringValue(record.note) ?? stringValue(record.categoryName) ?? "记录",
    ...(stringValue(record.description)
      ? { description: stringValue(record.description) }
      : {
          description: [stringValue(record.categoryName), stringValue(record.occurredAt)]
            .filter(Boolean)
            .join(" · "),
        }),
    ...(amount !== undefined ? { amount } : {}),
    ...(stringValue(record.pageName) ? { pageName: stringValue(record.pageName) } : {}),
    ...(stringValue(record.href) ? { href: stringValue(record.href) } : {}),
  };
}

function normalizeAnalysisCard(payload: Record<string, unknown>): AiAnalysisCardPart {
  const rawMetrics = payload.metrics;
  const insights = Array.isArray(payload.insights) ? payload.insights.map((item) => String(item)) : [];
  return {
    type: "analysis-card",
    title: stringValue(payload.title) ?? "分析",
    ...(stringValue(payload.summary)
      ? { summary: stringValue(payload.summary) }
      : insights.length
        ? { summary: insights.join("；") }
        : {}),
    metrics: normalizeMetrics(rawMetrics),
  };
}

function normalizeMetrics(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((metric) => objectValue(metric))
      .filter((metric): metric is Record<string, unknown> => Boolean(metric))
      .map((metric) => ({
        label: stringValue(metric.label) ?? "指标",
        value: numberOrString(metric.value) ?? "",
        ...(stringValue(metric.hint) ? { hint: stringValue(metric.hint) } : {}),
      }));
  }
  const record = objectValue(value);
  if (!record) return [];
  const labels: Record<string, string> = {
    income: "收入",
    expense: "支出",
    balance: "结余",
    count: "记录数",
  };
  return Object.entries(record).map(([key, item]) => ({
    label: labels[key] ?? key,
    value: numberOrString(item) ?? String(item),
  }));
}

function normalizeNavigationCard(payload: Record<string, unknown>): AiNavigationCardPart {
  return {
    type: "navigation-card",
    pageName: stringValue(payload.pageName) ?? stringValue(payload.title) ?? "目标页面",
    ...(stringValue(payload.href) ? { href: stringValue(payload.href) } : {}),
    ...(stringValue(payload.to) ? { to: stringValue(payload.to) } : {}),
    ...(stringValue(payload.url) ? { url: stringValue(payload.url) } : {}),
    ...(stringValue(payload.path) ? { path: stringValue(payload.path) } : {}),
    ...(stringValue(payload.description) ? { description: stringValue(payload.description) } : {}),
  };
}

function normalizeConfirmation(payload: Record<string, unknown>): AiConfirmationPart {
  const confirmation = objectValue(payload.confirmation);
  const source = confirmation ?? payload;
  return {
    type: "confirmation",
    ...((stringValue(source.id) ?? stringValue(source.confirmationId))
      ? { confirmationId: stringValue(source.id) ?? stringValue(source.confirmationId) }
      : {}),
    ...(stringValue(source.action) ? { action: stringValue(source.action) } : {}),
    title:
      stringValue(source.summary) ?? stringValue(source.title) ?? stringValue(payload.title) ?? "需要确认",
    ...((stringValue(source.message) ?? stringValue(source.description) ?? stringValue(payload.message))
      ? {
          message:
            stringValue(source.message) ?? stringValue(source.description) ?? stringValue(payload.message),
        }
      : {}),
    ...(stringValue(source.confirmLabel) ? { confirmLabel: stringValue(source.confirmLabel) } : {}),
    ...(stringValue(source.cancelLabel) ? { cancelLabel: stringValue(source.cancelLabel) } : {}),
    ...(stringValue(source.expiresAt) ? { expiresAt: stringValue(source.expiresAt) } : {}),
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length ? value : undefined;
}

function numberOrString(value: unknown) {
  return typeof value === "number" || typeof value === "string" ? value : undefined;
}
