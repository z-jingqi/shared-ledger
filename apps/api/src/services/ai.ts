import { createAiProvider, defaultAiConfig, type AiProvider, type LedgerAiConfig } from "@shared-ledger/ai";
import type { AiToolCallPlan } from "@shared-ledger/shared";
import type { ModelMessage } from "ai";
import type { Env } from "../types";

export function parseProviderKeys(value?: string) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed ? (parsed as Record<string, string>) : {};
  } catch {
    throw new Error("AI_PROVIDER_KEYS 必须是 JSON 对象");
  }
}

const providers = ["workers-ai", "openai", "anthropic", "openrouter"] as const;

function isProvider(value: string | undefined): value is LedgerAiConfig["provider"] {
  return Boolean(value && (providers as readonly string[]).includes(value));
}

function runtimeProviderKeys(env: Env) {
  const keys = parseProviderKeys(env.AI_PROVIDER_KEYS);
  if (env.OPENROUTER_API_KEY && !keys.openrouter) keys.openrouter = env.OPENROUTER_API_KEY;
  return keys;
}

function runtimeAiConfig(env: Env, config?: Partial<LedgerAiConfig>) {
  const keys = runtimeProviderKeys(env);
  const provider = isProvider(env.AI_PROVIDER) ? env.AI_PROVIDER : keys.openrouter && !config?.provider ? "openrouter" : undefined;
  return {
    ...defaultAiConfig,
    ...(provider === "openrouter" ? { model: env.AI_MODEL ?? env.OPENROUTER_MODEL ?? "xiaomi/mimo-v2.5" } : {}),
    ...config,
    ...(provider ? { provider } : {}),
    ...(env.AI_MODEL ? { model: env.AI_MODEL } : {}),
    ...(env.AI_BASE_URL ? { baseUrl: env.AI_BASE_URL } : {}),
  } satisfies LedgerAiConfig;
}

export function runtimeAiProvider(env: Env, config?: Partial<LedgerAiConfig>) {
  if (env.APP_ENV === "test" && !env.AI && !env.AI_PROVIDER_KEYS) return createTestAiProvider();
  return createAiProvider(
    runtimeAiConfig(env, config),
    { ai: env.AI, providerKeys: runtimeProviderKeys(env) },
  );
}

function createTestAiProvider(): AiProvider {
  return {
    async structureImport() {
      return [];
    },
    streamChat(messages: ModelMessage[]) {
      const last = [...messages].reverse().find((message) => message.role === "user");
      const text = testChatText(typeof last?.content === "string" ? last.content : "");
      return { textStream: textChunks(text) } as unknown as ReturnType<AiProvider["streamChat"]>;
    },
    async chat(input: { text: string }) {
      return testChatText(input.text);
    },
    async planToolCall(input: { text: string; attachments?: Array<Record<string, unknown>> }): Promise<AiToolCallPlan> {
      const text = input.text;
      const hasAttachments = Boolean(input.attachments?.length);
      if (text.includes("打车") && text.includes("38")) {
        return {
          toolName: "create-record",
          args: { type: "expense", amount: 38, note: "打车", categoryName: "交通", occurredAt: "2026-06-27" },
          confidence: 1,
          requiresConfirmation: false,
        };
      }
      if (text.includes("小于30")) {
        return {
          toolName: "search-records",
          args: { maxAmount: 30, maxStrict: true, sort: "date_desc" },
          confidence: 1,
          requiresConfirmation: false,
        };
      }
      if (text.includes("不合理") || text.includes("分析")) {
        return { toolName: "analyze-records", args: { type: "expense", sort: "amount_desc" }, confidence: 1, requiresConfirmation: false };
      }
      if (text.includes("删除") && text.includes("分类")) {
        return { toolName: "delete-category", args: { name: "医疗", type: "expense" }, confidence: 1, requiresConfirmation: true };
      }
      if (text.includes("创建") && text.includes("分类")) {
        return { toolName: "create-category", args: { name: "医疗", type: "expense" }, confidence: 1, requiresConfirmation: false };
      }
      if (text.includes("大于100") || text.includes("所有的支出") || text.includes("支出")) {
        return {
          toolName: "search-records",
          args: { type: "expense", minAmount: text.includes("大于100") ? 100 : undefined, sort: "date_desc" },
          confidence: 1,
          requiresConfirmation: false,
        };
      }
      if (text.includes("收入")) {
        return { toolName: "search-records", args: { type: "income", sort: "date_desc" }, confidence: 1, requiresConfirmation: false };
      }
      if (text.includes("用户名")) {
        return { toolName: "update-profile", args: { name: "SoundOnly2" }, confidence: 1, requiresConfirmation: false };
      }
      if (text.includes("头像") && hasAttachments) {
        return { toolName: "update-profile", args: { avatarFromAttachment: true }, confidence: 1, requiresConfirmation: false };
      }
      const inviteEmail = emailLikeToken(text);
      if (text.includes("邀请") && inviteEmail) {
        return {
          toolName: "invite-member",
          args: { email: inviteEmail, role: "member" },
          confidence: 1,
          requiresConfirmation: true,
        };
      }
      if (text.includes("mock") && text.includes("创建")) {
        return {
          toolName: "create-record",
          args: {
            records: [
              { type: "expense", amount: 12, note: "mock 早餐", occurredAt: "2026-06-27" },
              { type: "income", amount: 88, note: "mock 收入", occurredAt: "2026-06-27" },
            ],
          },
          confidence: 1,
          requiresConfirmation: false,
        };
      }
      if (text.includes("mock") && text.includes("删除")) {
        return { toolName: "delete-record", args: { q: "mock" }, confidence: 1, requiresConfirmation: true };
      }
      if (hasAttachments && (text.includes("导入") || text.includes("保存") || text.includes("入账"))) {
        return { toolName: "save-attachments", args: { autoConfirm: false }, confidence: 1, requiresConfirmation: false };
      }
      return { toolName: "chat", args: {}, userMessage: testChatText(text), confidence: 1, requiresConfirmation: false };
    },
  };
}

function testChatText(text: string) {
  if (text.includes("笑话")) return "当然：有个账本说自己很透明，因为它从来不藏余额。";
  if (text.trim()) return `收到：${text}`;
  return "你好，我可以正常聊天，也可以在你需要时操作账本。";
}

async function* textChunks(text: string) {
  for (const char of text) yield char;
}

function emailLikeToken(text: string) {
  const at = text.indexOf("@");
  if (at <= 0) return undefined;
  let start = at;
  while (start > 0 && !isBoundary(text[start - 1])) start -= 1;
  let end = at + 1;
  while (end < text.length && !isBoundary(text[end])) end += 1;
  const value = text.slice(start, end).trim();
  return value.includes(".") ? value : undefined;
}

function isBoundary(char: string | undefined) {
  return !char || [" ", "，", "。", "、", "；", ";", ",", "\n", "\t"].includes(char);
}
