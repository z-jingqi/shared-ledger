import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyAlephWebhookSignature } from "../src/routes/imports";
import { AlephOcrClient, AlephToolsError, ocrConfidence } from "../src/services/ocr";

describe("Aleph-OCR client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends bearer auth and unwraps successful responses", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ success: true, data: { jobId: "ocr_1", status: "queued" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const job = await new AlephOcrClient("https://ocr.example.com/", "secret").createOcrJob(
      {
        bytes: new TextEncoder().encode("image").buffer,
        filename: "receipt.png",
        mimeType: "image/png",
      },
      {
        callbackUrl: "https://api.example.com/imports/aleph-webhook",
        metadata: { importJobId: "import_1" },
        idempotencyKey: "import_1",
      },
    );

    expect(job).toEqual({ jobId: "ocr_1", status: "queued" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ocr.example.com/v1/tools/ocr",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret", "Idempotency-Key": "import_1" }),
      }),
    );
    const body = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body as FormData;
    expect(body.get("ocrMode")).toBe("small");
    expect(body.get("callbackUrl")).toBe("https://api.example.com/imports/aleph-webhook");
    expect(JSON.parse(String(body.get("metadata")))).toEqual({ importJobId: "import_1" });
  });

  it("requests Aleph-OCR job cancellation", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ success: true, data: { jobId: "ocr_1", status: "cancel_requested" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const job = await new AlephOcrClient("https://ocr.example.com/", "secret").cancelJob("ocr_1");

    expect(job).toEqual({ jobId: "ocr_1", status: "cancel_requested" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ocr.example.com/v1/jobs/ocr_1/cancel",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
      }),
    );
  });

  it("creates async image pipeline jobs with fixed preprocessing and OCR options", async () => {
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ success: true, data: { jobId: "pipeline_1", status: "queued", operation: "image.pipeline" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const job = await new AlephOcrClient("https://ocr.example.com/", "secret").createImagePipelineJob(
      {
        bytes: new TextEncoder().encode("heic").buffer,
        filename: "receipt.heic",
        mimeType: "image/heic",
      },
      {
        callbackUrl: "https://api.example.com/imports/aleph-webhook",
        metadata: { importJobId: "import_1", phase: "pipeline" },
        idempotencyKey: "pipeline:import_1:0",
      },
    );

    expect(job).toEqual({ jobId: "pipeline_1", status: "queued", operation: "image.pipeline" });
    const body = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body as FormData;
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ocr.example.com/v1/tools/image/pipeline",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer secret",
          "Idempotency-Key": "pipeline:import_1:0",
        }),
      }),
    );
    const pipeline = JSON.parse(String(body.get("pipeline")));
    expect(pipeline).toEqual({
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
    });
    expect(JSON.parse(String(body.get("metadata")))).toEqual({ importJobId: "import_1", phase: "pipeline" });
  });

  it("surfaces Aleph-OCR API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false, error: "Unauthorized" }, { status: 401 })));

    await expect(new AlephOcrClient("https://ocr.example.com", "bad").getJob("ocr_1")).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("preserves structured Aleph Tools error fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
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
    );

    await expect(new AlephOcrClient("https://ocr.example.com", "bad").getJob("ocr_1")).rejects.toMatchObject({
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
    expect(ocrConfidence({ ocr: { plainText: "text", markdown: "text", pages: [{ text: "a", confidence: 0.6 }] } })).toBe(0.6);
  });

  it("verifies Aleph-OCR webhook HMAC signatures", async () => {
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
