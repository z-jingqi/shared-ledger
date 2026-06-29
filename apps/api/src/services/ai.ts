import {
  AlephAIError,
  createAlephAIClient,
  createAlephAiProvider,
  type AiProvider,
  type AlephAIClient,
  type ErrorCode,
  type InvokeRequest,
  type UserUsageResponse,
} from "@shared-ledger/ai";
import type { AiToolCallPlan } from "@shared-ledger/shared";
import type { Env, LedgerUser } from "../types";

type RuntimeAiUser = Pick<LedgerUser, "id" | "plan">;

const project = "shared-ledger";

export function runtimeAlephEnv(env: Env) {
  return env.ALEPH_AI_ENV ?? env.APP_ENV ?? "prod";
}

export function runtimeAlephClient(env: Env): AlephAIClient {
  if (env.ALEPH_AI_TEST_CLIENT) return env.ALEPH_AI_TEST_CLIENT;
  if (env.APP_ENV === "test" && !env.ALEPH_AI_BASE_URL && !env.ALEPH_AI_SERVICE_TOKEN) return createTestAlephClient();
  if (!env.ALEPH_AI_BASE_URL || !env.ALEPH_AI_SERVICE_TOKEN) {
    throw new AlephAIError("validation_failed", "Aleph AI 未配置：需要 ALEPH_AI_BASE_URL 与 ALEPH_AI_SERVICE_TOKEN");
  }
  return createAlephAIClient({
    baseUrl: env.ALEPH_AI_BASE_URL,
    serviceToken: env.ALEPH_AI_SERVICE_TOKEN,
  });
}

export function runtimeAiProvider(env: Env, user: RuntimeAiUser): AiProvider {
  return createAlephAiProvider({
    client: runtimeAlephClient(env),
    env: runtimeAlephEnv(env),
    project,
    user,
  });
}

export async function getRuntimeAiUsage(env: Env, user: RuntimeAiUser): Promise<UserUsageResponse> {
  return runtimeAlephClient(env).getUserUsage({
    project,
    userId: user.id,
    plan: user.plan,
    env: runtimeAlephEnv(env),
  });
}

export type AiErrorBody = {
  error: string;
  code?: ErrorCode;
  requestId?: string;
  details?: Record<string, unknown>;
};

export function aiErrorStatus(error: unknown) {
  if (!(error instanceof AlephAIError)) return 503;
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
  if (error instanceof AlephAIError) {
    return {
      error: error.message,
      code: error.code,
      requestId: error.requestId,
      details: error.details,
    };
  }
  return { error: error instanceof Error ? error.message : fallback };
}

function createTestAlephClient(): AlephAIClient {
  return {
    async invoke<TOutput = unknown>(request: InvokeRequest) {
      const payload = latestUserPayload(request.input.messages);
      const format = responseFormatName(request.input.response_format);
      return {
        requestId: `test_request_${crypto.randomUUID()}`,
        status: "ok",
        route: "test.route",
        provider: "test",
        model: "test-model",
        usage: { inputTokens: 1, outputTokens: 1, creditsCharged: 1 },
        output: (format === "ledger_import_records" ? { records: [] } : testToolPlan(payload)) as TOutput,
      };
    },
    async *stream(request: InvokeRequest) {
      const prompt = latestMessageText(request.input.messages);
      const text = testChatText(prompt);
      const requestId = `test_request_${crypto.randomUUID()}`;
      yield {
        type: "route",
        requestId,
        route: { id: "test-route", name: "test.route", provider: "test", model: "test-model" },
      };
      for (const char of text) yield { type: "delta", requestId, delta: char };
      yield { type: "usage", requestId, usage: { inputTokens: 1, outputTokens: text.length, creditsCharged: 1 } };
      yield { type: "done", requestId };
    },
    async getUserUsage(params: { project: string; userId: string; plan?: string; env?: string }) {
      return {
        project: params.project,
        userId: params.userId,
        plan: params.plan ?? "free",
        periodStart: "2026-06-01T00:00:00.000Z",
        periodEnd: "2026-07-01T00:00:00.000Z",
        credits: { used: 0, limit: 100, remaining: 100 },
        requests: { used: 0, limit: 30, remaining: 30 },
      };
    },
  };
}

function latestUserPayload(messages: Array<{ role: string; content?: unknown }>) {
  const content = latestMessageText(messages);
  try {
    const parsed = JSON.parse(content);
    return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : { text: content };
  } catch {
    return { text: content };
  }
}

function latestMessageText(messages: Array<{ role: string; content?: unknown }>) {
  const message = [...messages].reverse().find((item) => item.role === "user") ?? messages[messages.length - 1];
  return typeof message?.content === "string" ? message.content : "";
}

function responseFormatName(format: unknown) {
  if (!format || typeof format !== "object") return undefined;
  const jsonSchema = (format as { json_schema?: unknown }).json_schema;
  if (!jsonSchema || typeof jsonSchema !== "object") return undefined;
  return (jsonSchema as { name?: unknown }).name;
}

function testToolPlan(payload: Record<string, unknown>): AiToolCallPlan {
  const text = String(payload.text ?? "");
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  const hasAttachments = attachments.length > 0;
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
}

function testChatText(text: string) {
  if (text.includes("笑话")) return "当然：有个账本说自己很透明，因为它从来不藏余额。";
  if (text.trim()) return `收到：${text}`;
  return "你好，我可以正常聊天，也可以在你需要时操作账本。";
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
