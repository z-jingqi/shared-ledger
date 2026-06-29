import type { Env } from "../types";

type AlephApiResponse<T> = { success: true; data: T; requestId?: string } | { success: false; error: AlephErrorPayload | string; requestId?: string };
type AlephJobStatus = "queued" | "processing" | "cancel_requested" | "cancelled" | "ready" | "failed" | "deleted";
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
  outputAvailable?: boolean;
  error?: string | AlephErrorPayload;
};
export type AlephPlainOcrResult = {
  plainText: string;
  markdown: string;
  pages: Array<{ text: string; confidence?: number | null }>;
};
export type AlephImagePipelineResult = {
  tool?: "image.pipeline";
  ocr: AlephPlainOcrResult;
  compressed?: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    width: number;
    height: number;
  };
};
export type AlephOcrResult = AlephPlainOcrResult | AlephImagePipelineResult;

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
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async createOcrJob(
    file: { bytes: ArrayBuffer; filename: string; mimeType: string },
    options: { callbackUrl?: string; metadata?: Record<string, unknown>; idempotencyKey?: string } = {},
  ): Promise<AlephOcrJob> {
    const form = new FormData();
    form.append("file", new File([file.bytes], file.filename, { type: file.mimeType }));
    form.append("ocrMode", "small");
    if (options.callbackUrl) form.append("callbackUrl", options.callbackUrl);
    if (options.metadata) form.append("metadata", JSON.stringify(options.metadata));
    return this.request<AlephOcrJob>("/v1/tools/ocr", {
      method: "POST",
      body: form,
      headers: options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
    });
  }

  async createImagePipelineJob(
    file: { bytes: ArrayBuffer; filename: string; mimeType: string },
    options: { callbackUrl?: string; metadata?: Record<string, unknown>; idempotencyKey?: string } = {},
  ): Promise<AlephOcrJob> {
    const form = new FormData();
    form.append("file", new File([file.bytes], file.filename, { type: file.mimeType }));
    form.append(
      "pipeline",
      JSON.stringify({
        convert: { targetFormat: "webp", width: 1600, fit: "inside" },
        compress: {
          outputFormat: "jpeg",
          targetSizeBytes: 900000,
          maxWidth: 1600,
          maxHeight: 1600,
          minQuality: 45,
          maxQuality: 85,
        },
        ocr: { ocrMode: "small" },
      }),
    );
    if (options.callbackUrl) form.append("callbackUrl", options.callbackUrl);
    if (options.metadata) form.append("metadata", JSON.stringify(options.metadata));
    return this.request<AlephOcrJob>("/v1/tools/image/pipeline", {
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

  async downloadOutput(jobId: string): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
    const response = await this.fetchWithAuth(`/v1/jobs/${encodeURIComponent(jobId)}/output`);
    if (!response.ok) throw await this.errorFromResponse(response, "OUTPUT_NOT_FOUND");
    return {
      bytes: await response.arrayBuffer(),
      mimeType: response.headers.get("content-type")?.split(";")[0] || "image/jpeg",
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchWithAuth(path, init);
    const payload = (await response.json().catch(() => null)) as AlephApiResponse<T> | null;
    if (!response.ok || !payload?.success) {
      if (payload && !payload.success) throw this.errorFromPayload(payload.error, response, payload.requestId);
      throw this.fallbackError(response);
    }
    return payload.data;
  }

  private async fetchWithAuth(path: string, init: RequestInit = {}) {
    try {
      return await fetch(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${this.apiKey}` },
      });
    } catch (error) {
      throw new AlephToolsError({
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Aleph Tools request failed",
        retryable: true,
        terminal: false,
      });
    }
  }

  private async errorFromResponse(response: Response, fallbackCode: string) {
    const payload = (await response.json().catch(() => null)) as AlephApiResponse<unknown> | null;
    if (payload && !payload.success) return this.errorFromPayload(payload.error, response, payload.requestId);
    return this.fallbackError(response, fallbackCode);
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
  if (!env.ALEPH_TOOLS_BASE_URL) throw new Error("ALEPH_TOOLS_BASE_URL 未配置，无法识别图片或 PDF");
  if (!env.ALEPH_TOOLS_API_KEY) throw new Error("ALEPH_TOOLS_API_KEY 未配置，无法识别图片或 PDF");
  return new AlephToolsClient(env.ALEPH_TOOLS_BASE_URL, env.ALEPH_TOOLS_API_KEY);
}

export function ocrConfidence(result: AlephOcrResult): number {
  const ocr = plainOcrResult(result);
  const values = ocr.pages
    .map((page) => page.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function plainOcrResult(result: AlephOcrResult): AlephPlainOcrResult {
  return "ocr" in result ? result.ocr : result;
}
