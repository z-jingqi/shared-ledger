export interface ServiceBinding {
  fetch(request: Request): Promise<Response>;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type ErrorCode =
  | "validation_failed"
  | "unauthorized"
  | "forbidden"
  | "service_binding_required"
  | "project_not_found"
  | "service_token_revoked"
  | "route_not_found"
  | "route_disabled"
  | "task_route_disabled"
  | "capability_not_supported"
  | "input_too_large"
  | "quota_policy_missing"
  | "quota_exceeded"
  | "idempotency_conflict"
  | "provider_unavailable"
  | "provider_error"
  | "usage_estimated"
  | "admin_auth_required"
  | "admin_origin_rejected"
  | "internal_error";

export interface PlatformErrorBody {
  requestId: string;
  status: "error";
  error: {
    code: ErrorCode;
    message: string;
    details?: JsonObject;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | JsonObject[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: JsonValue;
}

export interface InvokeRequest {
  project: string;
  env: string;
  task: string;
  user: { id: string; plan: string };
  mode: "text" | "stream" | "object" | "tool_calling" | "embedding" | "rerank" | "vision";
  input: {
    messages: ChatMessage[];
    tools?: JsonValue;
    tool_choice?: JsonValue;
    response_format?: JsonValue;
    temperature?: number;
    max_tokens?: number;
    stream_options?: JsonValue;
  };
  idempotencyKey?: string;
}

export interface InvokeResponse<TOutput = JsonValue> {
  requestId: string;
  status: "ok";
  route: string;
  provider: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    creditsCharged: number;
    estimatedCostUsd?: number;
    estimated?: boolean;
  };
  output: TOutput;
}

export type StreamEvent =
  | {
      type: "route";
      requestId: string;
      route: { id: string; name: string; provider: string; model: string; gatewayRoute?: string };
    }
  | { type: "delta"; requestId: string; delta: string }
  | { type: "usage"; requestId: string; usage: InvokeResponse["usage"] }
  | { type: "done"; requestId: string }
  | { type: "error"; requestId: string; error: PlatformErrorBody["error"] };

export interface UserUsageResponse {
  project: string;
  userId: string;
  plan: string;
  periodStart: string;
  periodEnd: string;
  credits: {
    used: number;
    limit: number;
    remaining: number;
  };
  requests: {
    used: number;
    limit: number;
    remaining: number;
  };
}

export interface AlephAIClient {
  invoke<TOutput = unknown>(request: InvokeRequest): Promise<InvokeResponse<TOutput>>;
  stream(request: InvokeRequest): AsyncIterable<StreamEvent>;
  getUserUsage(params: { project: string; userId: string; plan?: string; env?: string }): Promise<UserUsageResponse>;
}

export class AlephAIError extends Error {
  readonly code: ErrorCode;
  readonly requestId?: string;
  readonly details?: JsonObject;

  constructor(code: ErrorCode, message: string, options: { requestId?: string; details?: JsonObject } = {}) {
    super(message);
    this.name = "AlephAIError";
    this.code = code;
    if (options.requestId !== undefined) {
      this.requestId = options.requestId;
    }
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export function createAlephAIClient(config: { service: ServiceBinding; serviceToken: string }): AlephAIClient {
  const transport = createTransport(config);

  return {
    async invoke<TOutput = unknown>(request: InvokeRequest): Promise<InvokeResponse<TOutput>> {
      const response = await transport("/v1/invoke", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(request),
      });
      return readJsonResponse<InvokeResponse<TOutput>>(response);
    },

    stream(request: InvokeRequest): AsyncIterable<StreamEvent> {
      return createStreamIterator(
        transport("/v1/stream", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify(request),
        }),
      );
    },

    async getUserUsage(params: { project: string; userId: string; plan?: string; env?: string }): Promise<UserUsageResponse> {
      const search = new URLSearchParams();
      if (params.plan) {
        search.set("plan", params.plan);
      }
      if (params.env) {
        search.set("env", params.env);
      }
      const suffix = search.toString();
      const response = await transport(
        `/v1/projects/${encodeURIComponent(params.project)}/users/${encodeURIComponent(params.userId)}/usage${
          suffix.length > 0 ? `?${suffix}` : ""
        }`,
        { method: "GET" },
      );
      return readJsonResponse<UserUsageResponse>(response);
    },
  };
}

function createTransport(config: { service: ServiceBinding; serviceToken: string }): (path: string, init: RequestInit) => Promise<Response> {
  return async (path, init) => {
    const request = new Request(`https://aleph-ai-platform.internal${path}`, withServiceToken(init, config.serviceToken));
    return config.service.fetch(request);
  };
}

function withServiceToken(init: RequestInit, serviceToken: string): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${serviceToken}`);
  return { ...init, headers };
}

function jsonHeaders(): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  return headers;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as T | PlatformErrorBody | undefined;
  if (!response.ok) {
    const errorBody = isPlatformErrorBody(body) ? body : undefined;
    throw new AlephAIError(
      errorBody?.error.code ?? "provider_error",
      errorBody?.error.message ?? `Aleph AI request failed with HTTP ${response.status}`,
      errorOptions(errorBody?.requestId, errorBody?.error.details),
    );
  }
  return body as T;
}

function isPlatformErrorBody(value: unknown): value is PlatformErrorBody {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const body = value as PlatformErrorBody;
  return body.status === "error" && typeof body.error?.code === "string";
}

async function* createStreamIterator(responsePromise: Promise<Response>): AsyncIterable<StreamEvent> {
  const response = await responsePromise;
  if (!response.ok || !response.body) {
    await readJsonResponse(response);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const read = await reader.read();
      if (read.done) {
        break;
      }
      buffer += decoder.decode(read.value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = parseFrame(frame);
        if (!event) {
          continue;
        }
        if (event.type === "error") {
          throw new AlephAIError(event.error.code, event.error.message, errorOptions(event.requestId, event.error.details));
        }
        yield event;
      }
    }

    const finalText = buffer + decoder.decode();
    const event = parseFrame(finalText);
    if (event) {
      yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): StreamEvent | null {
  const data = frame
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data:"));
  if (!data) {
    return null;
  }
  try {
    return JSON.parse(data.slice(5).trim()) as StreamEvent;
  } catch {
    return null;
  }
}

function errorOptions(
  requestId: string | undefined,
  details: PlatformErrorBody["error"]["details"],
): { requestId?: string; details?: NonNullable<PlatformErrorBody["error"]["details"]> } {
  return {
    ...(requestId ? { requestId } : {}),
    ...(details ? { details } : {}),
  };
}
