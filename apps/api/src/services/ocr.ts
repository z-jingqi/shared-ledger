import type { Env } from "../types";

type AlephApiResponse<T> = { success: true; data: T } | { success: false; error: string };
type AlephJobStatus = "queued" | "processing" | "ready" | "failed" | "deleted";
export type AlephOcrJob = {
  jobId: string;
  status: AlephJobStatus;
  error?: string;
};
export type AlephOcrResult = {
  plainText: string;
  markdown: string;
  pages: Array<{ text: string; confidence?: number | null }>;
};

export class AlephOcrClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async createJob(file: { bytes: ArrayBuffer; filename: string; mimeType: string }): Promise<AlephOcrJob> {
    const form = new FormData();
    form.append("file", new File([file.bytes], file.filename, { type: file.mimeType }));
    return this.request<AlephOcrJob>("/v1/jobs", { method: "POST", body: form });
  }

  async getJob(jobId: string): Promise<AlephOcrJob> {
    return this.request<AlephOcrJob>(`/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  async getResult(jobId: string): Promise<AlephOcrResult> {
    return this.request<AlephOcrResult>(`/v1/jobs/${encodeURIComponent(jobId)}/result`);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${this.apiKey}` },
    });
    const payload = (await response.json().catch(() => null)) as AlephApiResponse<T> | null;
    if (!response.ok || !payload?.success) {
      const error =
        payload && !payload.success ? payload.error : `Aleph-OCR request failed (${response.status})`;
      throw new Error(error);
    }
    return payload.data;
  }
}

export function runtimeOcrClient(env: Env): AlephOcrClient {
  if (!env.ALEPH_OCR_BASE_URL) throw new Error("ALEPH_OCR_BASE_URL 未配置，无法识别图片或 PDF");
  if (!env.ALEPH_OCR_API_KEY) throw new Error("ALEPH_OCR_API_KEY 未配置，无法识别图片或 PDF");
  return new AlephOcrClient(env.ALEPH_OCR_BASE_URL, env.ALEPH_OCR_API_KEY);
}

export function ocrConfidence(result: AlephOcrResult): number {
  const values = result.pages
    .map((page) => page.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
