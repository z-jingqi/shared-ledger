import {
  createLedgerAiProvider,
  createLedgerLanguageModel,
  LedgerAIError,
  type AiProvider,
  type ErrorCode,
  type JsonObject,
  type LedgerAiTestClient,
  type LedgerLanguageModelConfig,
} from "@shared-ledger/ai";
import type { Env, LedgerUser } from "../types";

type RuntimeAiUser = Pick<LedgerUser, "id" | "plan">;

export type AiErrorBody = {
  error: string;
  code?: ErrorCode;
  requestId?: string;
  details?: JsonObject;
};

export type RuntimeAiUsage = {
  provider: string;
  model: string;
  quota: null;
  usage: null;
};

export function runtimeAiProvider(env: Env, user: RuntimeAiUser): AiProvider {
  const testClient = env.AI_TEST_CLIENT ?? (env.APP_ENV === "test" ? createTestAiClient() : undefined);
  if (testClient) {
    return createLedgerAiProvider({
      provider: "test",
      modelId: "test-model",
      user,
      testClient,
      importTimeoutMs: runtimeImportTimeoutMs(env),
      importPipelineTimeoutMs: runtimeImportPipelineTimeoutMs(env),
      importSummaryMaxTokens: runtimePositiveNumber(env.AI_IMPORT_SUMMARY_MAX_TOKENS),
      importItemsMaxTokens: runtimePositiveNumber(env.AI_IMPORT_ITEMS_MAX_TOKENS),
    });
  }
  const config = runtimeLanguageModelConfig(env);
  return createLedgerAiProvider({
    provider: config.provider,
    modelId: config.model,
    user,
    model: createLedgerLanguageModel(config),
    importTimeoutMs: runtimeImportTimeoutMs(env),
    importPipelineTimeoutMs: runtimeImportPipelineTimeoutMs(env),
    importSummaryMaxTokens: runtimePositiveNumber(env.AI_IMPORT_SUMMARY_MAX_TOKENS),
    importItemsMaxTokens: runtimePositiveNumber(env.AI_IMPORT_ITEMS_MAX_TOKENS),
  });
}

function runtimeImportPipelineTimeoutMs(env: Env) {
  return runtimePositiveNumber(env.AI_IMPORT_PIPELINE_TIMEOUT_MS) ?? 8 * 60_000;
}

export function runtimeLanguageModelConfig(env: Env): LedgerLanguageModelConfig {
  const provider = (env.AI_PROVIDER ?? inferProvider(env)).trim().toLowerCase();
  if (provider === "openrouter") {
    const model = env.OPENROUTER_MODEL?.trim();
    const apiKey = env.OPENROUTER_API_KEY?.trim();
    if (!model || !apiKey) {
      throw new LedgerAIError(
        "validation_failed",
        "OpenRouter AI 未配置：需要 OPENROUTER_API_KEY 与 OPENROUTER_MODEL",
      );
    }
    return {
      provider: "openrouter",
      model,
      apiKey,
      baseURL: env.OPENROUTER_BASE_URL?.trim() || undefined,
      appName: "shared-ledger",
      appUrl: env.WEB_ORIGIN,
    };
  }
  if (provider === "openai") {
    const model = env.OPENAI_MODEL?.trim();
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!model || !apiKey) {
      throw new LedgerAIError("validation_failed", "OpenAI 未配置：需要 OPENAI_API_KEY 与 OPENAI_MODEL");
    }
    return {
      provider: "openai",
      model,
      apiKey,
      baseURL: env.OPENAI_BASE_URL?.trim() || undefined,
    };
  }
  if (provider === "workers-ai") {
    const model = env.WORKERS_AI_MODEL?.trim();
    const baseURL = env.WORKERS_AI_BASE_URL?.trim();
    if (!model || !baseURL) {
      throw new LedgerAIError(
        "validation_failed",
        "Workers AI OpenAI-compatible endpoint 未配置：需要 WORKERS_AI_BASE_URL 与 WORKERS_AI_MODEL",
      );
    }
    return {
      provider: "workers-ai",
      model,
      baseURL,
      apiKey: env.WORKERS_AI_API_TOKEN?.trim() || undefined,
    };
  }
  throw new LedgerAIError("validation_failed", `不支持的 AI_PROVIDER：${provider}`);
}

export function getRuntimeAiUsage(env: Env, _user: RuntimeAiUser): RuntimeAiUsage {
  if (env.AI_TEST_CLIENT || env.APP_ENV === "test") {
    return {
      provider: "test",
      model: "test-model",
      quota: null,
      usage: null,
    };
  }
  const config = runtimeLanguageModelConfig(env);
  return {
    provider: config.provider,
    model: config.model,
    quota: null,
    usage: null,
  };
}

export function aiErrorStatus(error: unknown) {
  if (!(error instanceof LedgerAIError)) return 503;
  switch (error.code) {
    case "quota_exceeded":
      return 429;
    case "validation_failed":
    case "input_too_large":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "provider_error":
      return 502;
    case "provider_unavailable":
      return 503;
    default:
      return 503;
  }
}

export function aiErrorBody(error: unknown, fallback = "AI 服务不可用"): AiErrorBody {
  if (error instanceof LedgerAIError) {
    return {
      error: error.message,
      code: error.code,
      requestId: error.requestId,
      details: error.details,
    };
  }
  return { error: error instanceof Error ? error.message : fallback };
}

export function createTestAiClient(): LedgerAiTestClient {
  return {
    async generateObject<TOutput>(request: Parameters<LedgerAiTestClient["generateObject"]>[0]) {
      const payload = latestUserPayload(request.prompt);
      return (
        request.schemaName === "import_receipt_summary"
          ? {
              type: "expense",
              amount: 1,
              occurredAt: "2026-06-28",
              confidence: 0.9,
              warnings: [],
            }
          : request.schemaName === "import_items_chunk"
            ? { items: [], confidence: 0.9, warnings: [] }
            : request.schemaName === "ledger_skill_selection"
              ? testSkillSelection(payload)
              : testSkillStep(payload)
      ) as TOutput;
    },
    async *streamText(request) {
      const prompt = latestMessageText(request.messages);
      for (const char of testChatText(prompt)) yield char;
    },
    async generateText(request) {
      return testChatText(request.prompt);
    },
  };
}

function inferProvider(env: Env) {
  if (env.OPENROUTER_API_KEY) return "openrouter";
  if (env.OPENAI_API_KEY) return "openai";
  if (env.WORKERS_AI_BASE_URL) return "workers-ai";
  return "openrouter";
}

function runtimeImportTimeoutMs(env: Env) {
  return runtimePositiveNumber(env.AI_IMPORT_TIMEOUT_MS);
}

function runtimePositiveNumber(value: string | undefined) {
  const configured = Number(value);
  return Number.isFinite(configured) && configured > 0 ? configured : undefined;
}

function latestUserPayload(content: string) {
  try {
    const parsed = JSON.parse(content);
    return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : { text: content };
  } catch {
    return { text: content };
  }
}

function latestMessageText(messages: Array<{ role: string; content?: unknown }>) {
  const message =
    [...messages].reverse().find((item) => item.role === "user") ?? messages[messages.length - 1];
  return typeof message?.content === "string" ? message.content : "";
}

function testSkillSelection(payload: Record<string, unknown>) {
  const text = String(payload.text ?? "");
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (text.includes("不合理") || text.includes("分析"))
    return { skillName: "ledger.analysis", confidence: 1 };
  if (text.includes("分类")) return { skillName: "ledger.categories", confidence: 1 };
  if (text.includes("记录") || text.includes("打车") || text.includes("mock"))
    return { skillName: "ledger.records", confidence: 1 };
  if (text.includes("用户名") || text.includes("头像")) return { skillName: "ledger.profile", confidence: 1 };
  if (text.includes("邀请")) return { skillName: "ledger.members", confidence: 1 };
  if (attachments.length && (text.includes("导入") || text.includes("保存") || text.includes("入账")))
    return { skillName: "ledger.imports", confidence: 1 };
  if (
    text.includes("小于") ||
    text.includes("大于") ||
    text.includes("所有") ||
    text.includes("收入") ||
    text.includes("支出")
  )
    return { skillName: "ledger.search", confidence: 1 };
  return { skillName: "general.chat", confidence: 1 };
}

function testSkillStep(payload: Record<string, unknown>) {
  const text = String(payload.text ?? "");
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const hasAttachments = attachments.length > 0;
  const skill =
    typeof payload.selectedSkill === "object" && payload.selectedSkill
      ? String((payload.selectedSkill as { name?: unknown }).name ?? "general.chat")
      : "general.chat";
  if (text.includes("打车") && text.includes("38")) {
    return {
      skillName: "ledger.records",
      toolName: "create-record",
      args: { type: "expense", amount: 38, note: "打车", categoryName: "交通", occurredAt: "2026-06-27" },
      confidence: 1,
      requiresConfirmation: false,
    };
  }
  if (text.includes("小于30")) {
    return {
      skillName: "ledger.search",
      toolName: "search-records",
      args: { type: "expense", maxAmount: 30, maxStrict: true, sort: "date_desc" },
      confidence: 1,
      requiresConfirmation: false,
    };
  }
  if (text.includes("不合理") || text.includes("分析")) {
    return {
      skillName: "ledger.analysis",
      toolName: "analyze-records",
      args: { type: "expense", sort: "amount_desc" },
      confidence: 1,
      requiresConfirmation: false,
    };
  }
  if (text.includes("邀请")) {
    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
    return {
      skillName: "ledger.members",
      toolName: "invite-member",
      args: { ...(email ? { email } : {}), role: "member" },
      confidence: 1,
      requiresConfirmation: true,
    };
  }
  if (text.includes("删除") && text.includes("分类")) {
    return {
      skillName: "ledger.categories",
      toolName: "delete-category",
      args: { name: "医疗", type: "expense" },
      confidence: 1,
      requiresConfirmation: true,
    };
  }
  if (text.includes("分类")) {
    return {
      skillName: "ledger.categories",
      toolName: "create-category",
      args: { name: "医疗", type: "expense" },
      confidence: 1,
      requiresConfirmation: false,
    };
  }
  if (text.includes("用户名")) {
    const name = text.match(/改成\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)/)?.[1] ?? "SoundOnly2";
    return {
      skillName: "ledger.profile",
      toolName: "update-profile",
      args: { name },
      confidence: 1,
      requiresConfirmation: false,
    };
  }
  if (hasAttachments && skill === "ledger.imports") {
    return {
      skillName: "ledger.imports",
      toolName: "save-attachments",
      args: { autoConfirm: false },
      confidence: 1,
      requiresConfirmation: false,
    };
  }
  if (skill === "general.chat") {
    return {
      skillName: "general.chat",
      toolName: "chat",
      args: { userMessage: testChatText(text) },
      userMessage: testChatText(text),
      confidence: 1,
      requiresConfirmation: false,
      isFinal: true,
    };
  }
  return {
    skillName: skill,
    toolName: "chat",
    args: { userMessage: "我先帮你看一下。" },
    userMessage: "我先帮你看一下。",
    confidence: 0.8,
    requiresConfirmation: false,
    isFinal: true,
  };
}

function testChatText(prompt: string) {
  if (/你好|hello|hi/i.test(prompt)) return "你好，我在。";
  return "这是测试 AI 回复。";
}
