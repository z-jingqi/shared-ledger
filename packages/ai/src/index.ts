import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output, streamText, type LanguageModel, type ModelMessage } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import {
  aiActionNames,
  aiImportRecordSchema,
  aiToolCallPlanSchema,
  type AiActionName,
  type AiToolCallPlan,
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
  streamChat(messages: ModelMessage[], context: Pick<AiContext, "bookId" | "page">): ReturnType<typeof streamText>;
  planToolCall(input: AiToolPlanInput): Promise<AiToolCallPlan>;
  chat(input: AiContext): Promise<string>;
}
export const defaultAiConfig: LedgerAiConfig = {
  provider: "workers-ai",
  model: "@cf/meta/llama-3.1-8b-instruct",
};

const importSystemPrompt =
  "You extract bookkeeping entries. Return only records supported by the supplied text.";
const chatSystemPrompt = [
  "你是一个正常、友好、可靠的通用聊天机器人，同时也是一起记应用的智能助手。",
  "用户可以聊任何话题；和账本无关的问题也要自然回答，不要强行转回记账。",
  "如果回答涉及当前账本数据，只能基于工具或上下文提供的真实数据，不要编造记录、成员、余额或文件状态。",
].join("\n");
const toolPlanSystemPrompt = [
  "你是一起记应用的智能助手。你可以正常聊天，也可以使用工具操作应用数据。",
  "用户输入可能有错别字、口语、省略、多意图或附件；不要依赖关键词，要理解语义。",
  "如果用户只是聊天、提问、写作或任何不需要应用数据/操作的内容，选择 toolName=chat，并在 userMessage 中给出自然回复要点。",
  "如果用户需要真实账本数据，必须选择最合适的查询或分析工具，不要编造数据。",
  "如果用户要修改应用数据，选择最小必要工具，并把参数放入 args。",
  "附件会在 attachments 中提供元数据；图片可用于头像或视觉问题，文件可用于导入或分析。用户没要求保存/导入时不要选择 save-attachments。",
  "删除、移除成员、删除账本、批量修改、发送邀请、导出等高影响动作必须 requiresConfirmation=true。",
  "只能从 tools 列表中选择 toolName。输出必须符合 schema。",
].join("\n");

export type AiToolDefinition = {
  name: AiActionName;
  description: string;
  confirmation?: "never" | "dangerous" | "always";
  argsSchemaDescription?: string;
};
export type AiToolPlanInput = {
  text: string;
  userId?: string;
  bookId?: string;
  page: string;
  today: string;
  timeZone: string;
  tools: AiToolDefinition[];
  context?: Record<string, unknown>;
  attachments?: Array<Record<string, unknown>>;
};
export type PlanToolCallInput = AiToolPlanInput & { model: LanguageModel };

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

export async function planToolCall(input: PlanToolCallInput): Promise<AiToolCallPlan> {
  if (!input.model) throw new Error("AI tool planner requires a configured language model");
  const availableActions = normalizeAvailableActions(input.tools.map((tool) => tool.name));
  const result = await generateText({
    model: input.model,
    system: toolPlanSystemPrompt,
    prompt: JSON.stringify(
      {
        text: input.text,
        userId: input.userId,
        bookId: input.bookId,
        page: input.page,
        today: input.today,
        timeZone: input.timeZone,
        tools: input.tools,
        context: input.context ?? {},
        attachments: input.attachments ?? [],
      },
      null,
      2,
    ),
    output: Output.object({ schema: aiToolCallPlanSchema }),
  });
  const plan = aiToolCallPlanSchema.parse(result.output);
  if (!availableActions.includes(plan.toolName)) {
    throw new Error(`AI tool planner returned unavailable tool: ${plan.toolName}`);
  }
  return plan;
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
    async planToolCall(input: AiToolPlanInput): Promise<AiToolCallPlan> {
      return planToolCall({ ...input, model });
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
  if (!actions.length) throw new Error("AI tool planner requires at least one available tool");
  const invalidActions = actions.filter((action) => !supportedAiActions.has(action));
  if (invalidActions.length) throw new Error(`AI tool planner received unsupported tools: ${invalidActions.join(", ")}`);
  return Array.from(new Set(actions));
}
