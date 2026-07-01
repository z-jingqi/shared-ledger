import { describe, expect, it, vi } from "vitest";
import { verifyAlephWebhookSignature } from "../src/routes/imports";
import { assertImageImportFile, assertImageOcrQuota, maximumImageImportFileBytes } from "../src/services/import-validation";
import { AlephToolsClient, AlephToolsError, ocrConfidence } from "../src/services/ocr";
import type { D1LedgerRepository } from "../src/repository";
import type { WorkerServiceBinding } from "../src/types";

describe("Aleph Tools client", () => {
  it("calls Aleph Tools through service binding and sends only supported OCR multipart fields", async () => {
    const requests: Request[] = [];
    const service: WorkerServiceBinding = {
      fetch: vi.fn(async (request: Request) => {
        requests.push(request);
        return Response.json({ success: true, data: { jobId: "ocr_1", status: "queued" } });
      }),
    };

    const job = await new AlephToolsClient(service, "secret").createOcrJob(
      {
        bytes: new TextEncoder().encode("image").buffer,
        filename: "receipt.png",
        mimeType: "image/png",
      },
      {
        callbackUrl: "https://api.example.com/imports/aleph-webhook",
        metadata: { importJobId: "import_1", phase: "ocr" },
        idempotencyKey: "ocr:import_1:0",
      },
    );

    expect(job).toEqual({ jobId: "ocr_1", status: "queued" });
    expect(requests[0]?.url).toBe("https://aleph-tools.internal/v1/tools/ocr");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer secret");
    expect(requests[0]?.headers.get("Idempotency-Key")).toBe("ocr:import_1:0");
    const body = await requests[0]!.formData();
    expect([...body.keys()].sort()).toEqual(["callbackUrl", "file", "metadata"]);
    expect(body.get("file")).toBeInstanceOf(File);
    expect(body.get("callbackUrl")).toBe("https://api.example.com/imports/aleph-webhook");
    expect(JSON.parse(String(body.get("metadata")))).toEqual({ importJobId: "import_1", phase: "ocr" });
  });

  it("requests Aleph Tools job cancellation through service binding", async () => {
    const requests: Request[] = [];
    const service: WorkerServiceBinding = {
      fetch: vi.fn(async (request: Request) => {
        requests.push(request);
        return Response.json({ success: true, data: { jobId: "ocr_1", status: "cancel_requested" } });
      }),
    };

    const job = await new AlephToolsClient(service, "secret").cancelJob("ocr_1");

    expect(job).toEqual({ jobId: "ocr_1", status: "cancel_requested" });
    expect(requests[0]?.url).toBe("https://aleph-tools.internal/v1/jobs/ocr_1/cancel");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers.get("Authorization")).toBe("Bearer secret");
  });

  it("surfaces Aleph Tools API errors", async () => {
    const service: WorkerServiceBinding = {
      fetch: vi.fn(async () => Response.json({ success: false, error: "Unauthorized" }, { status: 401 })),
    };

    await expect(new AlephToolsClient(service, "bad").getJob("ocr_1")).rejects.toThrow("Unauthorized");
  });

  it("preserves structured Aleph Tools error fields", async () => {
    const service: WorkerServiceBinding = {
      fetch: vi.fn(async () =>
        Response.json(
          {
            success: false,
            error: {
              code: "RATE_LIMITED",
              message: "Too many active jobs",
              httpStatus: 429,
              requestId: "req_1",
              stage: "ocr",
              retryable: true,
              terminal: false,
            },
            requestId: "req_1",
          },
          { status: 429 },
        ),
      ),
    };

    await expect(new AlephToolsClient(service, "bad").getJob("ocr_1")).rejects.toMatchObject({
      name: "AlephToolsError",
      code: "RATE_LIMITED",
      requestId: "req_1",
      retryable: true,
      terminal: false,
    } satisfies Partial<AlephToolsError>);
  });

  it("averages page confidence and defaults to high confidence when absent", () => {
    expect(
      ocrConfidence({
        plainText: "text",
        markdown: "text",
        pages: [
          { text: "a", confidence: 0.7 },
          { text: "b", confidence: 0.9 },
        ],
      }),
    ).toBeCloseTo(0.8);
    expect(ocrConfidence({ plainText: "text", markdown: "text", pages: [{ text: "a" }] })).toBe(1);
  });

  it("rejects oversized image imports before creating OCR jobs", () => {
    const file = new File([new Uint8Array(maximumImageImportFileBytes + 1)], "huge.jpg", { type: "image/jpeg" });

    expect(() => assertImageImportFile(file)).toThrow("文件大小必须在 1 B 到 10 MB 之间");
  });

  it("preflights batch OCR quota with the requested file count", async () => {
    const repository = {
      async getUserPlan() {
        return "pro" as const;
      },
      async countDailyImageOcrUsage() {
        return 9;
      },
      async countActiveImageOcrJobs() {
        return 0;
      },
    } as unknown as D1LedgerRepository;

    await expect(assertImageOcrQuota(repository, "user_1", 2)).rejects.toMatchObject({
      status: 429,
      message: "今日图片识别额度已用完",
    });
  });

  it("verifies Aleph Tools webhook HMAC signatures", async () => {
    const timestamp = new Date().toISOString();
    const body = JSON.stringify({ event: "ocr.job.ready", jobId: "ocr_1", metadata: { importJobId: "import_1" } });
    const signature = `sha256=${await hmacSha256Hex("webhook-secret", `${timestamp}.${body}`)}`;

    await expect(verifyAlephWebhookSignature("webhook-secret", timestamp, signature, body)).resolves.toBe(true);
    await expect(verifyAlephWebhookSignature("webhook-secret", timestamp, "sha256=bad", body)).resolves.toBe(false);
    await expect(
      verifyAlephWebhookSignature("webhook-secret", new Date(Date.now() - 10 * 60_000).toISOString(), signature, body),
    ).resolves.toBe(false);
  });
});

async function hmacSha256Hex(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
