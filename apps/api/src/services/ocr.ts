import type { Env, WorkerServiceBinding } from "../types";

type AlephApiResponse<T> =
  | { success: true; data: T; requestId?: string }
  | { success: false; error: AlephErrorPayload | string; requestId?: string };
type AlephJobStatus =
  | "queued"
  | "processing"
  | "cancel_requested"
  | "cancelled"
  | "ready"
  | "failed"
  | "deleted";

const internalOrigin = "https://aleph-tools.internal";

export type AlephErrorPayload = {
  code: string;
  message: string;
  httpStatus?: number;
  requestId?: string;
  jobId?: string;
  jobStatus?: string;
  stage?: string;
  retryable?: boolean;
  terminal?: boolean;
};

export type AlephOcrJob = {
  jobId: string;
  tool?: string;
  operation?: string;
  status: AlephJobStatus;
  progress?: number;
  stage?: string;
  currentPage?: number | null;
  totalPages?: number | null;
  completedAt?: string | null;
  terminal?: boolean;
  cancelable?: boolean;
  retryable?: boolean;
  resultAvailable?: boolean;
  error?: string | AlephErrorPayload;
};

export type AlephPlainOcrResult = {
  plainText: string;
  markdown?: string;
  pages: Array<{ text: string; confidence?: number | null }>;
  metadata?: { input?: { converted?: boolean } };
};
export type AlephOcrResult = AlephPlainOcrResult;

export class AlephToolsError extends Error {
  code: string;
  httpStatus?: number;
  requestId?: string;
  jobId?: string;
  jobStatus?: string;
  stage?: string;
  retryable: boolean;
  terminal: boolean;

  constructor(payload: AlephErrorPayload) {
    super(payload.message);
    this.name = "AlephToolsError";
    this.code = payload.code;
    this.httpStatus = payload.httpStatus;
    this.requestId = payload.requestId;
    this.jobId = payload.jobId;
    this.jobStatus = payload.jobStatus;
    this.stage = payload.stage;
    this.retryable = payload.retryable ?? false;
    this.terminal = payload.terminal ?? false;
  }
}

export class AlephToolsClient {
  constructor(
    private readonly service: WorkerServiceBinding,
    private readonly apiKey: string,
  ) {}

  async createOcrJob(
    file: { bytes: ArrayBuffer; filename: string; mimeType: string },
    options: { callbackUrl?: string; metadata?: Record<string, unknown>; idempotencyKey?: string } = {},
  ): Promise<AlephOcrJob> {
    const form = new FormData();
    form.append("file", new File([file.bytes], file.filename, { type: file.mimeType }));
    if (options.callbackUrl) form.append("callbackUrl", options.callbackUrl);
    if (options.metadata) form.append("metadata", JSON.stringify(options.metadata));
    return this.request<AlephOcrJob>("/v1/tools/ocr", {
      method: "POST",
      body: form,
      headers: options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
    });
  }

  async getJob(jobId: string): Promise<AlephOcrJob> {
    return this.request<AlephOcrJob>(`/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  async getResult(jobId: string): Promise<AlephOcrResult> {
    return this.request<AlephOcrResult>(`/v1/jobs/${encodeURIComponent(jobId)}/result`);
  }

  async cancelJob(jobId: string): Promise<AlephOcrJob> {
    return this.request<AlephOcrJob>(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  }

  async streamJobEvents(jobId: string, lastEventId?: number) {
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (lastEventId && lastEventId > 0) headers["Last-Event-ID"] = String(lastEventId);
    const response = await this.fetchWithAuth(`/v1/jobs/${encodeURIComponent(jobId)}/events`, { headers });
    if (!response.ok || !response.body) throw new Error(`Aleph Tools 进度订阅失败 (${response.status})`);
    return response.body;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchWithAuth(path, init);
    const payload = (await response.json().catch(() => null)) as AlephApiResponse<T> | null;
    if (!response.ok || !payload?.success) {
      if (payload && !payload.success)
        throw this.errorFromPayload(payload.error, response, payload.requestId);
      throw this.fallbackError(response);
    }
    return payload.data;
  }

  private async fetchWithAuth(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    try {
      return await this.service.fetch(new Request(`${internalOrigin}${path}`, { ...init, headers }));
    } catch (error) {
      throw new AlephToolsError({
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Aleph Tools request failed",
        retryable: true,
        terminal: false,
      });
    }
  }

  private errorFromPayload(error: AlephErrorPayload | string, response: Response, requestId?: string) {
    if (typeof error === "string") {
      return new AlephToolsError({
        code: "INTERNAL_ERROR",
        message: error,
        httpStatus: response.status,
        requestId: requestId ?? response.headers.get("X-Request-Id") ?? undefined,
        retryable: true,
        terminal: false,
      });
    }
    return new AlephToolsError({
      ...error,
      httpStatus: error.httpStatus ?? response.status,
      requestId: error.requestId ?? requestId ?? response.headers.get("X-Request-Id") ?? undefined,
    });
  }

  private fallbackError(response: Response, fallbackCode = "INTERNAL_ERROR") {
    return new AlephToolsError({
      code: fallbackCode,
      message: `Aleph Tools request failed (${response.status})`,
      httpStatus: response.status,
      requestId: response.headers.get("X-Request-Id") ?? undefined,
      retryable: true,
      terminal: false,
    });
  }
}

export function runtimeOcrClient(env: Env): AlephToolsClient {
  if (!env.ALEPH_TOOLS) throw new Error("ALEPH_TOOLS service binding 未配置，无法识别图片");
  if (!env.ALEPH_TOOLS_API_KEY) throw new Error("ALEPH_TOOLS_API_KEY 未配置，无法识别图片");
  return new AlephToolsClient(env.ALEPH_TOOLS, env.ALEPH_TOOLS_API_KEY);
}

export function ocrConfidence(result: AlephOcrResult): number {
  const values = result.pages
    .map((page) => page.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
