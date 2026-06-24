import { afterEach, describe, expect, it, vi } from "vitest";
import { AlephOcrClient, ocrConfidence } from "../src/services/ocr";

describe("Aleph-OCR client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends bearer auth and unwraps successful responses", async () => {
    const fetch = vi.fn(async () => Response.json({ success: true, data: { jobId: "ocr_1", status: "queued" } }));
    vi.stubGlobal("fetch", fetch);

    const job = await new AlephOcrClient("https://ocr.example.com/", "secret").createJob({
      bytes: new TextEncoder().encode("image").buffer,
      filename: "receipt.png",
      mimeType: "image/png",
    });

    expect(job).toEqual({ jobId: "ocr_1", status: "queued" });
    expect(fetch).toHaveBeenCalledWith(
      "https://ocr.example.com/v1/jobs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
      }),
    );
  });

  it("surfaces Aleph-OCR API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false, error: "Unauthorized" }, { status: 401 })));

    await expect(new AlephOcrClient("https://ocr.example.com", "bad").getJob("ocr_1")).rejects.toThrow(
      "Unauthorized",
    );
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
});
