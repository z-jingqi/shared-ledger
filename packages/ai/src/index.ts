import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject, generateText, streamText, type LanguageModel, type ModelMessage } from "ai";
import {
  ledgerSkillSelectionSchema,
  ledgerToolStepSchema,
  type LedgerSkillDefinition,
  type LedgerSkillSelection,
  type LedgerToolStep,
} from "@shared-ledger/ledger-skills";
import { aiImportItemSchema, aiImportRecordSchema, type TransactionType } from "@shared-ledger/shared";
import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type ErrorCode =
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "input_too_large"
  | "quota_exceeded"
  | "provider_unavailable"
  | "provider_error"
  | "internal_error";

export class LedgerAIError extends Error {
  readonly code: ErrorCode;
  readonly requestId?: string;
  readonly details?: JsonObject;

  constructor(code: ErrorCode, message: string, options: { requestId?: string; details?: JsonObject } = {}) {
    super(message);
    this.name = "LedgerAIError";
    this.code = code;
    if (options.requestId !== undefined) this.requestId = options.requestId;
    if (options.details !== undefined) this.details = options.details;
  }
}

export type AiContext = {
  bookId: string;
  userId: string;
  page?: string;
  text: string;
  categories?: Array<{ name: string; type: "income" | "expense" }>;
  onImportProgress?: (progress: AiImportProgress) => Promise<void> | void;
};
export type AiChatMessage = { role: "system" | "user" | "assistant" | "tool"; content?: string };
export type AiTextStream = { textStream: AsyncIterable<string> };
export type LedgerAiUser = { id: string; plan: string };
export type AiImportProgress = {
  stage: "ai_summary" | "ai_items" | "ai_merging";
  text: string;
  chunkIndex?: number;
  chunkTotal?: number;
};

export interface AiProvider {
  structureImport(input: AiContext): Promise<z.infer<typeof aiImportRecordSchema>[]>;
  streamChat(messages: AiChatMessage[], context: Pick<AiContext, "bookId" | "page">): AiTextStream;
  selectSkill(input: AiSkillSelectionInput): Promise<LedgerSkillSelection>;
  planSkillStep(input: AiSkillStepInput): Promise<LedgerToolStep>;
  chat(input: AiContext): Promise<string>;
}

export type LedgerAiProviderName = "openrouter" | "openai" | "workers-ai";
export type LedgerLanguageModelConfig =
  | {
      provider: "openrouter";
      model: string;
      apiKey: string;
      baseURL?: string;
      appName?: string;
      appUrl?: string;
    }
  | {
      provider: "openai";
      model: string;
      apiKey: string;
      baseURL?: string;
    }
  | {
      provider: "workers-ai";
      model: string;
      apiKey?: string;
      baseURL: string;
    };

export type LedgerAiTestClient = {
  generateObject<TOutput>(input: {
    schemaName: string;
    system: string;
    prompt: string;
    temperature?: number;
    maxOutputTokens?: number;
  }): Promise<TOutput>;
  streamText(input: {
    system: string;
    messages: ModelMessage[];
    temperature?: number;
    maxOutputTokens?: number;
  }): AsyncIterable<string>;
  generateText(input: {
    system: string;
    prompt: string;
    temperature?: number;
    maxOutputTokens?: number;
  }): Promise<string>;
};

export type LedgerAiRuntime = {
  model?: LanguageModel;
  provider?: LedgerAiProviderName | "test";
  modelId?: string;
  user: LedgerAiUser;
  importTimeoutMs?: number;
  importSummaryMaxTokens?: number;
  importItemsMaxTokens?: number;
  testClient?: LedgerAiTestClient;
};

const importSummaryMaxChars = 12_000;
const importChunkMaxChars = 2_500;
const importChunkMaxLines = 80;
const importChunkOverlapLines = 2;
const importChunkMaxCount = 25;
const defaultImportSummaryMaxTokens = 900;
const defaultImportItemsMaxTokens = 1800;
const defaultChatMaxTokens = 1400;
const defaultSkillMaxTokens = 900;
const defaultToolStepMaxTokens = 1800;

const importSummarySystemPrompt = [
  "You extract the receipt-level bookkeeping summary from OCR text.",
  "Return only JSON matching the supplied schema.",
  "If OCR layout rows are present, use them as the primary evidence for receipt item rows and totals.",
  "Use the merchant/receipt purpose as note, the transaction date, the final paid/received total, transaction type, and a likely category.",
  "Prefer category names from the provided existing categories. If none fits and the text clearly implies a category, return a concise new categoryName.",
  "Do not extract product/service line items in this step.",
  "Do not invent unsupported totals. If the total is ambiguous, choose the best supported final total and add a short warning.",
  "If the OCR text appears to contain multiple receipts, return one combined record and add a warning.",
].join("\n");
const importItemsSystemPrompt = [
  "You extract receipt line items from one OCR text chunk.",
  "Return only JSON matching the supplied schema.",
  "If an OCR layout rows table is present, treat each row in that table as the primary item source.",
  "For table rows, use lineAmount as the item amount. Do not use unitPrice or quantity as amount when lineAmount is present.",
  "Only include explicit product/service lines that have a supported paid line amount in this chunk.",
  "Do not include merchant names, addresses, dates, receipt numbers, tax/subtotal/total/payment/change/discount summary lines, or card/payment lines as items.",
  "Never create placeholder items such as 其他商品, unknown item, or miscellaneous.",
  "Never use unmatched numeric columns, unit prices, quantities, summary totals, payment amounts, or discounts as item amounts.",
  "Prefer category names from the provided existing categories. If none fits and the item clearly implies a category, return a concise categoryName.",
  "If the chunk contains product/service lines but line amounts are unreadable, omit only those uncertain lines and add a short warning.",
  "Do not invent unsupported records or unsupported amounts. Leave only truly unknowable fields empty and explain them in warnings.",
].join("\n");
const chatSystemPrompt = [
  "你是一个正常、友好、可靠的通用聊天机器人，同时也是一起记应用的智能助手。",
  "用户可以聊任何话题；和账本无关的问题也要自然回答，不要强行转回记账。",
  "如果回答涉及当前账本数据，只能基于工具或上下文提供的真实数据，不要编造记录、成员、余额或文件状态。",
].join("\n");
const skillSelectSystemPrompt = [
  "你是一起记应用的通用智能助手。你可以正常聊天，也可以操作应用数据。",
  "用户输入可能有错别字、口语、省略、多意图或附件；不要依赖关键词，要理解语义。",
  "先选择最合适的 Skill：普通聊天选择 general.chat；真实账本查询/分析/写入/附件处理选择对应 ledger.* Skill。",
  "不要因为用户话题和账本无关就拒绝；普通聊天应自然回答。",
  "输出必须符合 schema。",
].join("\n");
const skillStepSystemPrompt = [
  "你是一起记应用的 Skill 执行规划器。",
  "只能从当前 Skill 提供的 tools 中选择一个 toolName。",
  "如果需要真实账本数据，必须选择查询/分析工具，不要编造数据。",
  "如果用户要修改应用数据，选择最小必要工具，并把参数放入 args。",
  "金额筛选中，“大于/超过”使用 minAmount 且 minStrict=true；“至少/不低于”使用 minAmount 且 minStrict=false；“小于/低于”使用 maxAmount 且 maxStrict=true；“不超过/最多”使用 maxAmount 且 maxStrict=false。",
  "附件会在 attachments 中提供元数据；图片可用于头像或视觉问题，文件可用于导入或分析。用户没要求保存/导入时不要选择 save-attachments。",
  "删除、移除成员、删除账本、批量修改、发送邀请、导出等高影响动作必须 requiresConfirmation=true。",
  "如果一次工具结果已经足够回答用户，把 isFinal 设为 true；只有确实需要基于观察结果继续第二步时才设为 false。",
  "普通聊天选择 chat，并在 userMessage 中给出自然回复要点。",
  "输出必须符合 schema。",
].join("\n");

export type AiSkillSelectionInput = {
  text: string;
  userId?: string;
  bookId?: string;
  page: string;
  today: string;
  timeZone: string;
  skills: LedgerSkillDefinition[];
  context?: Record<string, unknown>;
  attachments?: Array<Record<string, unknown>>;
};
export type AiSkillStepInput = AiSkillSelectionInput & {
  selectedSkill: LedgerSkillDefinition;
  observations?: Array<Record<string, unknown>>;
  stepIndex: number;
  maxSteps: number;
};

export function createLedgerLanguageModel(config: LedgerLanguageModelConfig): LanguageModel {
  if (config.provider === "openrouter") {
    return createOpenRouter({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      appName: config.appName ?? "shared-ledger",
      appUrl: config.appUrl,
    }).chat(config.model, { structuredOutputs: { strict: false } });
  }
  if (config.provider === "openai") {
    return createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL }).chat(config.model);
  }
  return createOpenAICompatible<string, string, string, string>({
    name: "workers-ai",
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    includeUsage: true,
    supportsStructuredOutputs: true,
  }).chatModel(config.model);
}

export function createLedgerAiProvider(runtime: LedgerAiRuntime): AiProvider {
  async function generateStructured<TOutput>(input: {
    schemaName: string;
    schema: z.ZodType<TOutput>;
    system: string;
    payload: unknown;
    temperature?: number;
    maxOutputTokens?: number;
  }): Promise<TOutput> {
    const prompt = JSON.stringify(input.payload, null, 2);
    try {
      if (runtime.testClient) {
        return input.schema.parse(
          await runtime.testClient.generateObject<TOutput>({
            schemaName: input.schemaName,
            system: input.system,
            prompt,
            temperature: input.temperature,
            maxOutputTokens: input.maxOutputTokens,
          }),
        );
      }
      const result = await withTimeout(
        generateObject<typeof input.schema, "object", TOutput>({
          model: requireModel(runtime),
          output: "object",
          schema: input.schema,
          schemaName: input.schemaName,
          system: input.system,
          prompt,
          temperature: input.temperature,
          maxOutputTokens: input.maxOutputTokens,
          maxRetries: 1,
        }),
        runtime.importTimeoutMs ?? 45_000,
      );
      return result.object;
    } catch (error) {
      const normalized = normalizeAiError(error);
      if (!runtime.testClient && shouldFallbackToJsonText(normalized)) {
        try {
          const result = await withTimeout(
            generateText({
              model: requireModel(runtime),
              system: [
                input.system,
                "Return only one valid JSON object. Do not wrap it in Markdown.",
                schemaHintForStructuredOutput(input.schemaName),
              ].join("\n"),
              prompt,
              temperature: input.temperature,
              maxOutputTokens: input.maxOutputTokens,
              maxRetries: 1,
            }),
            runtime.importTimeoutMs ?? 45_000,
          );
          return input.schema.parse(parseJsonObjectFromText(result.text));
        } catch (fallbackError) {
          throw normalizeAiError(fallbackError);
        }
      }
      throw normalized;
    }
  }

  return {
    streamChat(messages: AiChatMessage[], context: Pick<AiContext, "bookId" | "page">) {
      const system = `${chatSystemPrompt}\n页面：${context.page ?? "账本"}\n账本：${context.bookId}`;
      if (runtime.testClient) {
        return {
          textStream: runtime.testClient.streamText({
            system,
            messages: messages.map(toModelMessage),
            temperature: 0.4,
            maxOutputTokens: defaultChatMaxTokens,
          }),
        };
      }
      try {
        const result = streamText({
          model: requireModel(runtime),
          system,
          messages: messages.map(toModelMessage),
          temperature: 0.4,
          maxOutputTokens: defaultChatMaxTokens,
          timeout: { totalMs: 60_000, chunkMs: 20_000 },
          maxRetries: 1,
        });
        return { textStream: result.textStream };
      } catch (error) {
        throw normalizeAiError(error);
      }
    },
    async chat(input: AiContext) {
      try {
        if (runtime.testClient) {
          return runtime.testClient.generateText({
            system: `${chatSystemPrompt}\n页面：${input.page ?? "账本"}\n账本：${input.bookId}`,
            prompt: input.text,
            temperature: 0.4,
            maxOutputTokens: defaultChatMaxTokens,
          });
        }
        const result = await generateText({
          model: requireModel(runtime),
          system: `${chatSystemPrompt}\n页面：${input.page ?? "账本"}\n账本：${input.bookId}`,
          prompt: input.text,
          temperature: 0.4,
          maxOutputTokens: defaultChatMaxTokens,
          timeout: { totalMs: 60_000 },
          maxRetries: 1,
        });
        return result.text;
      } catch (error) {
        throw normalizeAiError(error);
      }
    },
    async selectSkill(input: AiSkillSelectionInput): Promise<LedgerSkillSelection> {
      return ledgerSkillSelectionSchema.parse(
        await generateStructured({
          schemaName: "ledger_skill_selection",
          schema: ledgerSkillSelectionSchema,
          system: skillSelectSystemPrompt,
          payload: skillSelectionPayload(input),
          temperature: 0.1,
          maxOutputTokens: defaultSkillMaxTokens,
        }),
      );
    },
    async planSkillStep(input: AiSkillStepInput): Promise<LedgerToolStep> {
      const step = ledgerToolStepSchema.parse(
        await generateStructured({
          schemaName: "ledger_skill_step",
          schema: ledgerToolStepSchema,
          system: skillStepSystemPrompt,
          payload: skillStepPayload(input),
          temperature: 0.1,
          maxOutputTokens: defaultToolStepMaxTokens,
        }),
      );
      if (step.skillName !== input.selectedSkill.name) {
        throw new LedgerAIError("validation_failed", `AI selected mismatched skill: ${step.skillName}`);
      }
      if (!input.selectedSkill.tools.some((tool) => tool.name === step.toolName)) {
        throw new LedgerAIError("validation_failed", `AI selected unavailable tool: ${step.toolName}`);
      }
      return step;
    },
    async structureImport(input: AiContext): Promise<z.infer<typeof aiImportRecordSchema>[]> {
      const layoutRows = parseOcrLayoutRows(input.text, input.categories ?? []);
      const chunks = chunkOcrText(input.text);
      if (chunks.length > importChunkMaxCount) {
        throw new LedgerAIError(
          "input_too_large",
          `OCR 文本过长，请拆分图片后重试。当前需要 ${chunks.length} 段，最多支持 ${importChunkMaxCount} 段。`,
        );
      }

      await notifyImportProgress(input, { stage: "ai_summary", text: "分析票据信息" });
      let summary: ImportReceiptSummary;
      try {
        summary = importReceiptSummaryOutputSchema.parse(
          await generateStructured({
            schemaName: "import_receipt_summary",
            schema: importReceiptSummaryOutputSchema,
            system: importSummarySystemPrompt,
            payload: {
              bookId: input.bookId,
              userId: input.userId,
              page: input.page ?? "导入",
              existingCategories: input.categories ?? [],
              summaryText: buildImportSummaryText(input.text),
            },
            temperature: 0,
            maxOutputTokens: runtime.importSummaryMaxTokens ?? defaultImportSummaryMaxTokens,
          }),
        );
      } catch (error) {
        summary = fallbackImportReceiptSummary(input.text, input.categories ?? [], error);
      }
      if (layoutRows.length && layoutRowsMatchTotal(layoutRows, summary.amount)) {
        await notifyImportProgress(input, { stage: "ai_merging", text: "合并识别结果" });
        return [
          aiImportRecordSchema.parse({
            ...summary,
            items: layoutRows.map((row) => ({
              name: row.name,
              amount: row.amount,
              ...(row.categoryName ? { categoryName: row.categoryName } : {}),
            })),
            warnings: uniqueWarnings(summary.warnings),
          }),
        ];
      }
      const chunkResults: ImportChunkResult[] = [];

      for (const [index, chunk] of chunks.entries()) {
        const chunkNumber = index + 1;
        await notifyImportProgress(input, {
          stage: "ai_items",
          text: `提取明细 ${chunkNumber}/${chunks.length}`,
          chunkIndex: chunkNumber,
          chunkTotal: chunks.length,
        });
        chunkResults.push(
          await extractImportItemsChunk({
            generateStructured,
            input,
            chunk,
            chunkIndex: index,
            chunkNumber,
            chunkTotal: chunks.length,
            depth: 0,
            maxOutputTokens: runtime.importItemsMaxTokens ?? defaultImportItemsMaxTokens,
          }),
        );
      }

      await notifyImportProgress(input, { stage: "ai_merging", text: "合并识别结果" });
      const merged = mergeImportChunks(summary, chunkResults);
      return [aiImportRecordSchema.parse(merged)];
    },
  };
}

type ImportReceiptSummary = z.infer<typeof importReceiptSummaryOutputSchema>;
type ImportChunkItem = z.infer<typeof aiImportItemSchema> & { sourceChunkIndex: number };
type ImportChunkResult = {
  chunkIndex: number;
  confidence: number;
  warnings: string[];
  items: ImportChunkItem[];
};
type GenerateStructured = <TOutput>(input: {
  schemaName: string;
  schema: z.ZodType<TOutput>;
  system: string;
  payload: unknown;
  temperature?: number;
  maxOutputTokens?: number;
}) => Promise<TOutput>;

function requireModel(runtime: LedgerAiRuntime): LanguageModel {
  if (!runtime.model) throw new LedgerAIError("validation_failed", "AI provider 未配置");
  return runtime.model;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LedgerAIError("provider_unavailable", "AI 分析超时")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function notifyImportProgress(input: AiContext, progress: AiImportProgress) {
  await input.onImportProgress?.(progress);
}

function buildImportSummaryText(text: string) {
  const lines = splitOcrLines(text);
  if (!lines.length) return text.trim().slice(0, importSummaryMaxChars);
  const keywordPattern =
    /(合计|总计|总额|应付|实付|支付|付款|收款|找零|小计|日期|时间|商户|店|发票|订单|receipt|total|amount|paid|payment|date|time|merchant|store)/i;
  const selected = new Map<number, string>();
  const addRange = (start: number, end: number) => {
    for (let index = Math.max(0, start); index < Math.min(lines.length, end); index += 1) {
      selected.set(index, lines[index]);
    }
  };
  addRange(0, 80);
  addRange(lines.length - 80, lines.length);
  lines.forEach((line, index) => {
    if (keywordPattern.test(line)) selected.set(index, line);
  });
  return Array.from(selected.entries())
    .sort(([left], [right]) => left - right)
    .map(([, line]) => line)
    .join("\n")
    .slice(0, importSummaryMaxChars);
}

function chunkOcrText(text: string) {
  const lines = splitOcrLines(text);
  if (!lines.length) return text.trim() ? [text.trim().slice(0, importChunkMaxChars)] : [];
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    const nextLength = currentLength + line.length + (current.length ? 1 : 0);
    if (current.length && (current.length >= importChunkMaxLines || nextLength > importChunkMaxChars)) {
      chunks.push(current.join("\n"));
      const overlap = current.slice(-importChunkOverlapLines);
      current = [...overlap];
      currentLength = overlap.join("\n").length;
    }
    current.push(line);
    currentLength += line.length + (current.length > 1 ? 1 : 0);
  }
  if (current.length) chunks.push(current.join("\n"));
  return chunks;
}

function splitOcrLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseOcrLayoutRows(
  text: string,
  categories: Array<{ name: string; type: TransactionType }>,
): Array<z.infer<typeof aiImportItemSchema>> {
  const rows: Array<z.infer<typeof aiImportItemSchema>> = [];
  for (const line of splitOcrLines(text)) {
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < 4 || cells[0]?.toLowerCase() === "name" || cells.every((cell) => /^-+$/.test(cell))) {
      continue;
    }
    const [name, , , amountText] = cells;
    const amount = parseImportMoney(amountText ?? "");
    if (!name || amount === undefined) continue;
    const categoryName = inferItemCategoryName(name, categories);
    rows.push({
      name,
      amount,
      ...(categoryName ? { categoryName } : {}),
    });
  }
  return rows;
}

function layoutRowsMatchTotal(rows: Array<z.infer<typeof aiImportItemSchema>>, amount: number) {
  if (!rows.length) return false;
  const itemSum = rows.reduce((total, item) => total + item.amount, 0);
  return Math.abs(itemSum - amount) <= 0.01;
}

function fallbackImportReceiptSummary(
  text: string,
  categories: Array<{ name: string; type: TransactionType }>,
  cause: unknown,
): ImportReceiptSummary {
  const amount = extractReceiptAmount(text);
  const occurredAt = extractReceiptOccurredAt(text);
  if (amount === undefined || !occurredAt) throw cause;
  return {
    type: "expense",
    amount,
    occurredAt,
    note: extractReceiptNote(text),
    categoryName: inferOverallCategoryName(text, categories),
    confidence: 0.72,
    warnings: ["AI 摘要解析失败，已使用 OCR 规则兜底"],
  };
}

function parseImportMoney(value: string) {
  const normalized = value.trim().replace(/[￥¥,\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return undefined;
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : undefined;
}

function extractReceiptAmount(text: string) {
  const plainText = plainOcrText(text);
  const priorityPatterns = [
    /(?:实收|应收|支付|付款|微信|支付宝|银行卡|合计金额|总计|total|paid)\s*[:：]?\s*[￥¥]?\s*(\d+(?:\.\d{1,2})?)/gi,
  ];
  for (const pattern of priorityPatterns) {
    const matches = Array.from(plainText.matchAll(pattern))
      .map((match) => parseImportMoney(match[1] ?? ""))
      .filter((amount): amount is number => amount !== undefined);
    if (matches.length) return matches.at(-1);
  }
  return undefined;
}

function extractReceiptOccurredAt(text: string) {
  const plainText = plainOcrText(text);
  const dateTime = plainText.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dateTime) {
    const [, year, month, day, hour, minute, second = "00"] = dateTime;
    return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${minute}:${second}`;
  }
  const date = plainText.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (date) {
    const [, year, month, day] = date;
    return `${year}-${pad2(month)}-${pad2(day)}T12:00:00`;
  }
  return undefined;
}

function extractReceiptNote(text: string) {
  const firstLine = splitOcrLines(plainOcrText(text))[0] ?? "图片识别";
  return firstLine
    .replace(/欢迎您.*$/, "")
    .replace(/\s+/g, "")
    .slice(0, 80);
}

function inferOverallCategoryName(text: string, categories: Array<{ name: string; type: TransactionType }>) {
  return findExistingExpenseCategory(categories, ["购物", "食品", "餐饮", "日用品"]) ?? "购物";
}

function inferItemCategoryName(name: string, categories: Array<{ name: string; type: TransactionType }>) {
  const compact = name.replace(/\s+/g, "");
  if (/卫生巾|纸|巾|洗|牙|皂|清洁|日用/.test(compact)) {
    return findExistingExpenseCategory(categories, ["日用品", "购物"]) ?? "日用品";
  }
  if (/虾|蒜|肋排|娃娃菜|小葱|丝瓜|鸡|牛腱|鸭|西瓜|蓝莓|菜椒|番茄|鸡蛋|马铃薯|土豆|水果|蔬菜/.test(compact)) {
    return findExistingExpenseCategory(categories, ["食材", "食品", "餐饮", "购物"]) ?? "食材";
  }
  return findExistingExpenseCategory(categories, ["购物", "日用品"]) ?? "购物";
}

function findExistingExpenseCategory(
  categories: Array<{ name: string; type: TransactionType }>,
  names: string[],
) {
  const expenseCategories = categories.filter((category) => category.type === "expense");
  return names.find((name) => expenseCategories.some((category) => category.name === name));
}

function plainOcrText(text: string) {
  const marker = "OCR plain text:";
  const markerIndex = text.indexOf(marker);
  return markerIndex >= 0 ? text.slice(markerIndex + marker.length).trim() : text;
}

function pad2(value: string) {
  return value.padStart(2, "0");
}

async function extractImportItemsChunk(input: {
  generateStructured: GenerateStructured;
  input: AiContext;
  chunk: string;
  chunkIndex: number;
  chunkNumber: number;
  chunkTotal: number;
  depth: number;
  maxOutputTokens: number;
}): Promise<ImportChunkResult> {
  try {
    const parsed = importItemsChunkOutputSchema.parse(
      await input.generateStructured({
        schemaName: "import_items_chunk",
        schema: importItemsChunkOutputSchema,
        system: importItemsSystemPrompt,
        payload: {
          bookId: input.input.bookId,
          userId: input.input.userId,
          page: input.input.page ?? "导入",
          existingCategories: input.input.categories ?? [],
          chunkIndex: input.chunkNumber,
          chunkTotal: input.chunkTotal,
          text: input.chunk,
        },
        temperature: 0,
        maxOutputTokens: input.maxOutputTokens,
      }),
    );
    return {
      chunkIndex: input.chunkIndex,
      confidence: parsed.confidence,
      warnings: parsed.warnings,
      items: parsed.items.map((item) => ({ ...item, sourceChunkIndex: input.chunkIndex })),
    };
  } catch (error) {
    if (input.depth < 1 && shouldSplitImportChunkError(error)) {
      const split = splitImportChunk(input.chunk);
      if (split) {
        const [left, right] = split;
        const leftResult = await extractImportItemsChunk({ ...input, chunk: left, depth: input.depth + 1 });
        const rightResult = await extractImportItemsChunk({
          ...input,
          chunk: right,
          depth: input.depth + 1,
        });
        return {
          chunkIndex: input.chunkIndex,
          confidence: Math.min(leftResult.confidence, rightResult.confidence),
          warnings: [...leftResult.warnings, ...rightResult.warnings],
          items: [...leftResult.items, ...rightResult.items],
        };
      }
    }
    throw normalizeImportChunkError(error);
  }
}

function shouldSplitImportChunkError(error: unknown) {
  if (error instanceof z.ZodError) return true;
  if (error instanceof LedgerAIError) {
    return ["input_too_large", "validation_failed", "provider_error", "provider_unavailable"].includes(
      error.code,
    );
  }
  return false;
}

function normalizeImportChunkError(error: unknown) {
  if (error instanceof z.ZodError) {
    return new LedgerAIError("validation_failed", "AI 明细结构不完整，请重试", {
      details: { issues: error.issues.slice(0, 5) } as unknown as JsonObject,
    });
  }
  return error;
}

function splitImportChunk(chunk: string): [string, string] | undefined {
  const lines = splitOcrLines(chunk);
  if (lines.length > 1) {
    const middle = Math.ceil(lines.length / 2);
    return [lines.slice(0, middle).join("\n"), lines.slice(middle).join("\n")];
  }
  const trimmed = chunk.trim();
  if (trimmed.length <= 1) return undefined;
  const middle = Math.ceil(trimmed.length / 2);
  return [trimmed.slice(0, middle), trimmed.slice(middle)];
}

function mergeImportChunks(summary: ImportReceiptSummary, chunks: ImportChunkResult[]) {
  const items: Array<z.infer<typeof aiImportItemSchema>> = [];
  const seen = new Map<string, number[]>();

  for (const chunk of chunks) {
    for (const item of chunk.items) {
      const key = importItemDedupeKey(item);
      const sourceIndexes = seen.get(key) ?? [];
      const duplicateFromOverlap = sourceIndexes.some(
        (sourceIndex) =>
          sourceIndex !== item.sourceChunkIndex && Math.abs(sourceIndex - item.sourceChunkIndex) <= 1,
      );
      if (duplicateFromOverlap) continue;
      sourceIndexes.push(item.sourceChunkIndex);
      seen.set(key, sourceIndexes);
      items.push({
        name: item.name,
        amount: item.amount,
        ...(item.categoryName ? { categoryName: item.categoryName } : {}),
        ...(item.note ? { note: item.note } : {}),
      });
    }
  }

  const warnings = [...summary.warnings, ...chunks.flatMap((chunk) => chunk.warnings)];
  if (!items.length) warnings.push("未提取到明确明细");
  const itemSum = items.reduce((total, item) => total + item.amount, 0);
  if (items.length && Math.abs(itemSum - summary.amount) > 0.01) {
    warnings.push("明细金额合计与总金额不一致，请核对");
  }

  return {
    ...summary,
    items,
    confidence: Math.min(summary.confidence, ...chunks.map((chunk) => chunk.confidence)),
    warnings: uniqueWarnings(warnings),
  };
}

function importItemDedupeKey(item: z.infer<typeof aiImportItemSchema>) {
  return [
    item.name.trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN"),
    item.amount.toFixed(2),
    (item.categoryName ?? "").trim().toLocaleLowerCase("zh-CN"),
  ].join("|");
}

function uniqueWarnings(warnings: string[]) {
  return Array.from(new Set(warnings.map((warning) => warning.trim()).filter(Boolean)));
}

function shouldFallbackToJsonText(error: LedgerAIError) {
  return ["provider_error", "provider_unavailable", "validation_failed"].includes(error.code);
}

function schemaHintForStructuredOutput(schemaName: string) {
  if (schemaName === "import_receipt_summary") {
    return [
      'JSON shape: {"type":"expense","amount":123.45,"occurredAt":"YYYY-MM-DDTHH:mm:ss","note":"merchant or purpose","categoryName":"category","confidence":0.9,"warnings":[]}.',
      "Use only income or expense for type. amount must be a positive number.",
    ].join("\n");
  }
  if (schemaName === "import_items_chunk") {
    return [
      'JSON shape: {"items":[{"name":"item name","amount":12.34,"categoryName":"category","note":"optional"}],"confidence":0.9,"warnings":[]}.',
      "items must be an array. Every item amount must be the paid line amount.",
    ].join("\n");
  }
  return "Return a JSON object matching the requested schema.";
}

function parseJsonObjectFromText(text: string) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) return JSON.parse(fenced);
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new LedgerAIError("validation_failed", "AI 没有返回有效 JSON");
  }
}

function toModelMessage(message: AiChatMessage): ModelMessage {
  return {
    role: message.role === "tool" ? "assistant" : message.role,
    content: message.content ?? "",
  } as ModelMessage;
}

function skillSelectionPayload(input: AiSkillSelectionInput) {
  return {
    text: input.text,
    userId: input.userId,
    bookId: input.bookId,
    page: input.page,
    today: input.today,
    timeZone: input.timeZone,
    skills: input.skills.map((skill) => ({
      name: skill.name,
      title: skill.title,
      description: skill.description,
      useWhen: skill.useWhen,
      tools: skill.tools.map((tool) => tool.name),
    })),
    context: input.context ?? {},
    attachments: input.attachments ?? [],
  };
}

function skillStepPayload(input: AiSkillStepInput) {
  return {
    ...skillSelectionPayload(input),
    selectedSkill: input.selectedSkill,
    observations: input.observations ?? [],
    stepIndex: input.stepIndex,
    maxSteps: input.maxSteps,
  };
}

function normalizeAiError(error: unknown): LedgerAIError {
  if (error instanceof LedgerAIError) return error;
  const anyError = error as { statusCode?: unknown; status?: unknown; response?: { status?: unknown } };
  const status = Number(anyError?.statusCode ?? anyError?.status ?? anyError?.response?.status);
  const message = error instanceof Error ? error.message : "AI 服务不可用";
  const lower = message.toLowerCase();
  if (status === 401) return new LedgerAIError("unauthorized", message, errorDetails(error));
  if (status === 403) return new LedgerAIError("forbidden", message, errorDetails(error));
  if (status === 429 || lower.includes("quota") || lower.includes("rate limit")) {
    return new LedgerAIError("quota_exceeded", message, errorDetails(error));
  }
  if (status === 400 || lower.includes("validation") || lower.includes("schema")) {
    return new LedgerAIError("validation_failed", message, errorDetails(error));
  }
  if (lower.includes("too large") || lower.includes("context length") || lower.includes("maximum context")) {
    return new LedgerAIError("input_too_large", message, errorDetails(error));
  }
  if (status === 503 || status === 504 || lower.includes("timeout") || lower.includes("timed out")) {
    return new LedgerAIError("provider_unavailable", message, errorDetails(error));
  }
  return new LedgerAIError("provider_error", message, errorDetails(error));
}

function errorDetails(error: unknown): { requestId?: string; details?: JsonObject } {
  const value = error as { requestId?: unknown; cause?: unknown; data?: unknown };
  const details: JsonObject = {};
  if (typeof value?.cause === "string") details.cause = value.cause;
  if (value?.data && typeof value.data === "object") details.data = value.data as JsonObject;
  return {
    requestId: typeof value?.requestId === "string" ? value.requestId : undefined,
    details: Object.keys(details).length ? details : undefined,
  };
}

const importReceiptSummaryOutputSchema = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.number().positive(),
  occurredAt: z.string(),
  note: z.string().trim().max(500).optional(),
  categoryName: z.string().trim().min(1).max(30).optional(),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()).default([]),
});

const importItemsChunkOutputSchema = z.object({
  items: z.array(aiImportItemSchema).default([]),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()).default([]),
});
