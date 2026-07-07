import {
  AlephAIError,
  createAlephAIClient,
  type AlephAIClient,
  type ChatMessage,
  type ErrorCode,
  type InvokeRequest,
  type JsonObject,
  type StreamEvent,
  type UserUsageResponse,
} from "./platform-client";
import {
  ledgerSkillNames,
  ledgerSkillSelectionSchema,
  ledgerToolStepSchema,
  type LedgerSkillDefinition,
  type LedgerSkillSelection,
  type LedgerToolStep,
} from "@shared-ledger/ledger-skills";
import { aiImportItemSchema, aiImportRecordSchema } from "@shared-ledger/shared";
import { z } from "zod";

export { AlephAIError, createAlephAIClient };
export type { AlephAIClient, ErrorCode, InvokeRequest, JsonObject, StreamEvent, UserUsageResponse };

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
export type LedgerAiRuntime = {
  client: AlephAIClient;
  env: string;
  user: LedgerAiUser;
  project?: string;
  importTimeoutMs?: number;
  importSummaryMaxTokens?: number;
  importItemsMaxTokens?: number;
};
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

const projectId = "shared-ledger";
const chatTask = "ledger.chat";
const skillSelectTask = "ledger.skill_select";
const skillStepTask = "ledger.skill_step";
const importSummaryMaxChars = 12_000;
const importChunkMaxChars = 2_500;
const importChunkMaxLines = 80;
const importChunkOverlapLines = 2;
const importChunkMaxCount = 25;
const defaultImportSummaryMaxTokens = 900;
const defaultImportItemsMaxTokens = 1800;

const importSummarySystemPrompt = [
  "You extract the receipt-level bookkeeping summary from OCR text.",
  "Return only JSON matching the supplied schema.",
  "Use the merchant/receipt purpose as note, the transaction date, the final paid/received total, transaction type, and a likely category.",
  "Prefer category names from the provided existing categories. If none fits and the text clearly implies a category, return a concise new categoryName.",
  "Do not extract product/service line items in this step.",
  "Do not invent unsupported totals. If the total is ambiguous, choose the best supported final total and add a short warning.",
  "If the OCR text appears to contain multiple receipts, return one combined record and add a warning.",
].join("\n");
const importItemsSystemPrompt = [
  "You extract receipt line items from one OCR text chunk.",
  "Return only JSON matching the supplied schema.",
  "Only include explicit product/service lines that have a supported amount in this chunk.",
  "Do not include merchant names, addresses, dates, receipt numbers, tax/subtotal/total/payment/change/discount summary lines, or card/payment lines as items.",
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

export function createAlephAiProvider(runtime: LedgerAiRuntime): AiProvider {
  const project = runtime.project ?? projectId;

  function invokeRequest(input: {
    task: string;
    mode: "object" | "stream";
    messages: ChatMessage[];
    responseFormat?: JsonObject;
    temperature?: number;
    maxTokens?: number;
  }) {
    return {
      project,
      env: runtime.env,
      task: input.task,
      user: runtime.user,
      mode: input.mode,
      input: {
        messages: input.messages,
        ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        ...(input.maxTokens === undefined ? {} : { max_tokens: input.maxTokens }),
      },
    };
  }

  return {
    streamChat(messages: AiChatMessage[], context: Pick<AiContext, "bookId" | "page">) {
      const alephMessages: ChatMessage[] = [
        {
          role: "system",
          content: `${chatSystemPrompt}\n页面：${context.page ?? "账本"}\n账本：${context.bookId}`,
        },
        ...messages.map(toAlephMessage),
      ];
      return {
        textStream: streamDeltas(
          runtime.client.stream(
            invokeRequest({
              task: chatTask,
              mode: "stream",
              messages: alephMessages,
              temperature: 0.4,
              maxTokens: 1400,
            }),
          ),
        ),
      };
    },
    async chat(input: AiContext) {
      let text = "";
      for await (const delta of this.streamChat([{ role: "user", content: input.text }], input).textStream) {
        text += delta;
      }
      return text;
    },
    async selectSkill(input: AiSkillSelectionInput): Promise<LedgerSkillSelection> {
      const response = await runtime.client.invoke<unknown>(
        invokeRequest({
          task: skillSelectTask,
          mode: "object",
          messages: [
            { role: "system", content: skillSelectSystemPrompt },
            { role: "user", content: JSON.stringify(skillSelectionPayload(input), null, 2) },
          ],
          responseFormat: responseFormat("ledger_skill_selection", skillSelectionJsonSchema),
          temperature: 0.1,
          maxTokens: 900,
        }),
      );
      return ledgerSkillSelectionSchema.parse(response.output);
    },
    async planSkillStep(input: AiSkillStepInput): Promise<LedgerToolStep> {
      const response = await runtime.client.invoke<unknown>(
        invokeRequest({
          task: skillStepTask,
          mode: "object",
          messages: [
            { role: "system", content: skillStepSystemPrompt },
            { role: "user", content: JSON.stringify(skillStepPayload(input), null, 2) },
          ],
          responseFormat: responseFormat("ledger_skill_step", skillStepJsonSchema(input.selectedSkill)),
          temperature: 0.1,
          maxTokens: 1800,
        }),
      );
      const step = ledgerToolStepSchema.parse(response.output);
      if (step.skillName !== input.selectedSkill.name) {
        throw new AlephAIError("validation_failed", `AI selected mismatched skill: ${step.skillName}`);
      }
      if (!input.selectedSkill.tools.some((tool) => tool.name === step.toolName)) {
        throw new AlephAIError("validation_failed", `AI selected unavailable tool: ${step.toolName}`);
      }
      return step;
    },
    async structureImport(input: AiContext): Promise<z.infer<typeof aiImportRecordSchema>[]> {
      const chunks = chunkOcrText(input.text);
      if (chunks.length > importChunkMaxCount) {
        throw new AlephAIError(
          "input_too_large",
          `OCR 文本过长，请拆分图片后重试。当前需要 ${chunks.length} 段，最多支持 ${importChunkMaxCount} 段。`,
        );
      }

      await notifyImportProgress(input, { stage: "ai_summary", text: "分析票据信息" });
      const summaryResponse = await withTimeout(
        runtime.client.invoke<unknown>(
          invokeRequest({
            task: skillStepTask,
            mode: "object",
            messages: [
              { role: "system", content: importSummarySystemPrompt },
              {
                role: "user",
                content: JSON.stringify(
                  {
                    bookId: input.bookId,
                    userId: input.userId,
                    page: input.page ?? "导入",
                    existingCategories: input.categories ?? [],
                    summaryText: buildImportSummaryText(input.text),
                  },
                  null,
                  2,
                ),
              },
            ],
            responseFormat: responseFormat("import_receipt_summary", importReceiptSummaryJsonSchema),
            temperature: 0,
            maxTokens: runtime.importSummaryMaxTokens ?? defaultImportSummaryMaxTokens,
          }),
        ),
        runtime.importTimeoutMs ?? 45_000,
      );
      const summary = importReceiptSummaryOutputSchema.parse(summaryResponse.output);
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
            input,
            runtime,
            invokeRequest,
            chunk,
            chunkIndex: index,
            chunkNumber,
            chunkTotal: chunks.length,
            depth: 0,
          }),
        );
      }

      await notifyImportProgress(input, { stage: "ai_merging", text: "合并识别结果" });
      const merged = mergeImportChunks(summary, chunkResults);
      return [aiImportRecordSchema.parse(merged)];
    },
  };
}

type InvokeRequestBuilder = (input: {
  task: string;
  mode: "object" | "stream";
  messages: ChatMessage[];
  responseFormat?: JsonObject;
  temperature?: number;
  maxTokens?: number;
}) => InvokeRequest;

type ImportReceiptSummary = z.infer<typeof importReceiptSummaryOutputSchema>;
type ImportChunkItem = z.infer<typeof aiImportItemSchema> & { sourceChunkIndex: number };
type ImportChunkResult = {
  chunkIndex: number;
  confidence: number;
  warnings: string[];
  items: ImportChunkItem[];
};

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

async function extractImportItemsChunk(input: {
  input: AiContext;
  runtime: LedgerAiRuntime;
  invokeRequest: InvokeRequestBuilder;
  chunk: string;
  chunkIndex: number;
  chunkNumber: number;
  chunkTotal: number;
  depth: number;
}): Promise<ImportChunkResult> {
  try {
    const response = await withTimeout(
      input.runtime.client.invoke<unknown>(
        input.invokeRequest({
          task: skillStepTask,
          mode: "object",
          messages: [
            { role: "system", content: importItemsSystemPrompt },
            {
              role: "user",
              content: JSON.stringify(
                {
                  bookId: input.input.bookId,
                  userId: input.input.userId,
                  page: input.input.page ?? "导入",
                  existingCategories: input.input.categories ?? [],
                  chunkIndex: input.chunkNumber,
                  chunkTotal: input.chunkTotal,
                  text: input.chunk,
                },
                null,
                2,
              ),
            },
          ],
          responseFormat: responseFormat("import_items_chunk", importItemsChunkJsonSchema),
          temperature: 0,
          maxTokens: input.runtime.importItemsMaxTokens ?? defaultImportItemsMaxTokens,
        }),
      ),
      input.runtime.importTimeoutMs ?? 45_000,
    );
    const parsed = importItemsChunkOutputSchema.parse(response.output);
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
        const rightResult = await extractImportItemsChunk({ ...input, chunk: right, depth: input.depth + 1 });
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
  if (error instanceof AlephAIError) {
    return ["input_too_large", "validation_failed", "provider_error", "provider_unavailable"].includes(
      error.code,
    );
  }
  return false;
}

function normalizeImportChunkError(error: unknown) {
  if (error instanceof z.ZodError) {
    return new AlephAIError("validation_failed", "AI 明细结构不完整，请重试", {
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new AlephAIError("provider_unavailable", "AI 分析超时，请稍后重试"));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function toAlephMessage(message: AiChatMessage): ChatMessage {
  return {
    role: message.role,
    content: message.content ?? "",
  };
}

async function* streamDeltas(events: AsyncIterable<StreamEvent>) {
  for await (const event of events) {
    if (event.type === "delta") yield event.delta;
    if (event.type === "error")
      throw new AlephAIError(event.error.code, event.error.message, {
        requestId: event.requestId,
        details: event.error.details,
      });
  }
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

function responseFormat(name: string, schema: JsonObject): JsonObject {
  return {
    type: "json_schema",
    json_schema: {
      name,
      strict: false,
      schema,
    },
  };
}

const moneyJsonSchema = {
  type: "number",
  exclusiveMinimum: 0,
  multipleOf: 0.01,
} as unknown as JsonObject;

const importItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "amount"],
  properties: {
    name: { type: "string", maxLength: 120 },
    amount: moneyJsonSchema,
    categoryName: { type: "string", maxLength: 30 },
    note: { type: "string", maxLength: 500 },
  },
} as unknown as JsonObject;

const importReceiptSummaryJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "amount", "occurredAt", "confidence", "warnings"],
  properties: {
    type: { type: "string", enum: ["income", "expense"] },
    amount: moneyJsonSchema,
    occurredAt: { type: "string" },
    note: { type: "string", maxLength: 500 },
    categoryName: { type: "string", maxLength: 30 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    warnings: { type: "array", items: { type: "string" } },
  },
} as unknown as JsonObject;

const importItemsChunkJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "confidence", "warnings"],
  properties: {
    items: {
      type: "array",
      items: importItemJsonSchema,
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    warnings: { type: "array", items: { type: "string" } },
  },
} as unknown as JsonObject;

const skillSelectionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["skillName", "confidence"],
  properties: {
    skillName: { type: "string", enum: ledgerSkillNames },
    reason: { type: "string", maxLength: 500 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as unknown as JsonObject;

function skillStepJsonSchema(skill: LedgerSkillDefinition) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["skillName", "toolName", "args", "requiresConfirmation", "confidence"],
    properties: {
      skillName: { type: "string", enum: [skill.name] },
      toolName: { type: "string", enum: skill.tools.map((tool) => tool.name) },
      args: { type: "object" },
      userMessage: { type: "string", maxLength: 2000 },
      requiresConfirmation: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      isFinal: { type: "boolean" },
    },
  } as unknown as JsonObject;
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
