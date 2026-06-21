import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output, streamText, type LanguageModel, type ModelMessage } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { aiImportRecordSchema } from "@shared-ledger/shared";
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
  chat(input: AiContext): Promise<string>;
}
export const defaultAiConfig: LedgerAiConfig = {
  provider: "workers-ai",
  model: "@cf/meta/llama-3.1-8b-instruct",
};

const importSystemPrompt =
  "You extract bookkeeping entries. Return only records supported by the supplied text.";
const chatSystemPrompt = "你是一起记的账本助手。回答基于用户当前账本上下文，简洁、明确、不得编造数据。";

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
