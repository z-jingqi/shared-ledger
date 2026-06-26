import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output, streamText, type LanguageModel, type ModelMessage } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import {
  aiActionNames,
  aiImportRecordSchema,
  aiIntentSchema,
  type AiActionName,
  type AiIntent,
  type TransactionType,
} from "@shared-ledger/shared";
import { z } from "zod";

export type AiContext = { bookId: string; userId: string; page?: string; text: string };
export type WorkersAiBinding = { run(model: string, input: unknown): Promise<unknown> };
export type LedgerAiConfig = {
  provider: "workers-ai" | "openai" | "anthropic" | "openrouter";
  model: string;
  apiKeyRef?: string;
  baseUrl?: string;
};
export type LedgerAiEnvironment = {
  ai?: WorkersAiBinding;
  providerKeys?: Record<string, string | undefined>;
};
export interface AiProvider {
  structureImport(input: AiContext): Promise<z.infer<typeof aiImportRecordSchema>[]>;
  parseUserIntent(input: AiIntentInput): Promise<AiIntent>;
  chat(input: AiContext): Promise<string>;
}
export const defaultAiConfig: LedgerAiConfig = {
  provider: "workers-ai",
  model: "@cf/meta/llama-3.1-8b-instruct",
};

const importSystemPrompt =
  "You extract bookkeeping entries. Return only records supported by the supplied text.";
const chatSystemPrompt = "你是一起记的账本助手。回答基于用户当前账本上下文，简洁、明确、不得编造数据。";
const intentSystemPrompt = [
  "你是一起记的业务意图解析器，只返回符合 schema 的结构化结果。",
  "从 availableActions 中选择且只选择一个 action，不要输出列表外的 action。",
  "action 语义：create-record=新增收支记录；search-records=查找或筛选记录；analyze-records=分析账本；invite-member=邀请成员；save-attachments=保存或上传附件；confirm-import-batch=确认导入批次；cancel-task=取消任务；retry-task=重试任务。",
  "不要执行任何业务动作，不要编造金额、日期、联系人或任务 ID。信息缺失时填写 missingFields 和 followUpQuestion。",
  "日期基于 today 和 timeZone 解释；明确日期时写入 occurredAt/from/to，模糊表达也保留 dateExpression。",
  "分类和标签优先使用传入的 categories/tags 的 id；没有匹配 id 时可以输出建议名称。",
  "需要用户确认的动作应设置 requiresConfirmation=true，并填写 confirmation.action/summary。",
].join("\n");

export type AiIntentEntity = { id?: string; name: string; type?: TransactionType | string; color?: string; icon?: string };
export type AiIntentInput = {
  text: string;
  bookId: string;
  userId?: string;
  page: string;
  today: string;
  timeZone: string;
  categories: AiIntentEntity[];
  tags: AiIntentEntity[];
  hasAttachments?: boolean;
  availableActions: AiActionName[];
};
export type ParseUserIntentInput = AiIntentInput & { model: LanguageModel };

const supportedAiActions = new Set<AiActionName>(aiActionNames);

function keyFor(config: LedgerAiConfig, keys: Record<string, string | undefined>) {
  const key = keys[config.apiKeyRef ?? config.provider];
  if (!key) throw new Error(`${config.provider} 尚未配置密钥引用 ${config.apiKeyRef ?? config.provider}`);
  return key;
}

export function resolveModel(config: LedgerAiConfig, environment: LedgerAiEnvironment): LanguageModel {
  switch (config.provider) {
    case "workers-ai":
      if (!environment.ai) throw new Error("Workers AI binding 未配置");
      return createWorkersAI({ binding: environment.ai as any })(config.model);
    case "openai":
      return createOpenAI({
        apiKey: keyFor(config, environment.providerKeys ?? {}),
        baseURL: config.baseUrl,
      })(config.model);
    case "anthropic":
      return createAnthropic({
        apiKey: keyFor(config, environment.providerKeys ?? {}),
        baseURL: config.baseUrl,
      })(config.model);
    case "openrouter":
      return createOpenRouter({
        apiKey: keyFor(config, environment.providerKeys ?? {}),
        baseURL: config.baseUrl,
      })(config.model);
  }
}

export async function parseUserIntent(input: ParseUserIntentInput): Promise<AiIntent> {
  if (!input.model) throw new Error("AI intent parser requires a configured language model");
  const availableActions = normalizeAvailableActions(input.availableActions);
  const result = await generateText({
    model: input.model,
    system: intentSystemPrompt,
    prompt: JSON.stringify(
      {
        text: input.text,
        page: input.page,
        bookId: input.bookId,
        userId: input.userId,
        today: input.today,
        timeZone: input.timeZone,
        categories: input.categories,
        tags: input.tags,
        hasAttachments: Boolean(input.hasAttachments),
        availableActions,
      },
      null,
      2,
    ),
    output: Output.object({ schema: aiIntentSchema }),
  });
  const intent = aiIntentSchema.parse(result.output);
  if (!availableActions.includes(intent.action)) {
    throw new Error(`AI intent parser returned unavailable action: ${intent.action}`);
  }
  return intent;
}

export function createAiProvider(config: LedgerAiConfig, environment: LedgerAiEnvironment) {
  const model = resolveModel(config, environment);
  return {
    config,
    streamChat(messages: ModelMessage[], context: Pick<AiContext, "bookId" | "page">) {
      return streamText({
        model,
        system: `${chatSystemPrompt}\n页面：${context.page ?? "账本"}\n账本：${context.bookId}`,
        messages,
      });
    },
    async chat(input: AiContext) {
      const result = await generateText({
        model,
        system: `${chatSystemPrompt}\n页面：${input.page ?? "账本"}\n账本：${input.bookId}`,
        prompt: input.text,
      });
      return result.text;
    },
    async parseUserIntent(input: AiIntentInput): Promise<AiIntent> {
      return parseUserIntent({ ...input, model });
    },
    async structureImport(input: AiContext): Promise<z.infer<typeof aiImportRecordSchema>[]> {
      const result = await generateText({
        model,
        system: importSystemPrompt,
        prompt: input.text,
        output: Output.array({ element: aiImportRecordSchema }),
      });
      return result.output.map((record) => aiImportRecordSchema.parse(record));
    },
  };
}

function normalizeAvailableActions(actions: AiActionName[]) {
  if (!actions.length) throw new Error("parseUserIntent requires at least one available AI action");
  const invalidActions = actions.filter((action) => !supportedAiActions.has(action));
  if (invalidActions.length) throw new Error(`parseUserIntent received unsupported AI actions: ${invalidActions.join(", ")}`);
  return Array.from(new Set(actions));
}
