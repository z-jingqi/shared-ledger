import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertImageImportFile,
  assertImageOcrQuota,
  maximumImageImportFileBytes,
} from "../src/services/import-validation";
import {
  GoogleVisionOcrClient,
  GoogleVisionOcrError,
  googleVisionSupportsImageType,
  ocrConfidence,
  type GoogleVisionOcrResult,
} from "../src/services/ocr";
import { prepareImageForGoogleVision } from "../src/services/image-conversion";
import type { D1LedgerRepository } from "../src/repository";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Vision OCR client", () => {
  it("calls Google Vision annotate with document text detection", async () => {
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        const normalized = request instanceof Request ? request : new Request(request, init);
        requests.push(normalized);
        return Response.json({
          responses: [
            {
              fullTextAnnotation: {
                text: "合计 12.00",
                pages: [{ confidence: 0.9 }],
              },
            },
          ],
        });
      }),
    );

    const result = await new GoogleVisionOcrClient("secret").recognizeImage({
      bytes: new TextEncoder().encode("image").buffer,
      sourceMimeType: "image/png",
      processedMimeType: "image/png",
      converted: false,
    });

    expect(result.plainText).toBe("合计 12.00");
    expect(result.metadata).toMatchObject({
      engine: "google-vision",
      input: { converted: false, sourceMimeType: "image/png", processedMimeType: "image/png" },
    });
    expect(requests[0]?.url).toContain("https://vision.googleapis.com/v1/images:annotate");
    expect(requests[0]?.url).not.toContain("key=");
    expect(requests[0]?.headers.get("X-Goog-Api-Key")).toBe("secret");
    const body = (await requests[0]!.json()) as {
      requests: Array<{ features: unknown; image: { content?: string } }>;
    };
    expect(body.requests[0].features).toEqual([{ type: "DOCUMENT_TEXT_DETECTION" }]);
    expect(body.requests[0].image.content).toBeTruthy();
  });

  it("adds coordinate-derived receipt rows when Google Vision returns layout blocks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          responses: [
            {
              fullTextAnnotation: {
                text: "1234567890123 测试商品\n9.90\n2\n19.80\n应收 19.80",
                pages: [
                  {
                    confidence: 0.9,
                    blocks: [
                      visionBlock("1234567890123 测试商品", 100, 100, 700, 40),
                      visionBlock("9.90", 900, 150, 80, 30),
                      visionBlock("2", 1300, 150, 40, 30),
                      visionBlock("19.80", 1600, 150, 90, 30),
                      visionBlock("应收 19.80", 100, 250, 220, 30),
                    ],
                  },
                ],
              },
            },
          ],
        }),
      ),
    );

    const result = await new GoogleVisionOcrClient("secret").recognizeImage({
      bytes: new TextEncoder().encode("image").buffer,
      sourceMimeType: "image/png",
      processedMimeType: "image/png",
      converted: false,
    });

    expect(result.markdown).toContain("OCR visual rows derived from Google Vision bounding boxes");
    expect(result.markdown).toContain("[ROW 1] [x=100] 1234567890123 测试商品");
    expect(result.markdown).toContain("[ROW 2] [x=900] 9.90 | [x=1300] 2 | [x=1600] 19.80");
  });

  it("keeps weighted quantities and uses the rightmost row value as line amount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          responses: [
            {
              fullTextAnnotation: {
                text: "1234567890123 马铃薯(称重)\n3.77\n0.904\n3.41\n应收 3.41",
                pages: [
                  {
                    confidence: 0.9,
                    blocks: [
                      visionBlock("1234567890123 马铃薯(称重)", 100, 100, 700, 40),
                      visionBlock("3.77", 900, 150, 80, 30),
                      visionBlock("0.904", 1300, 150, 70, 30),
                      visionBlock("3.41", 1600, 150, 90, 30),
                      visionBlock("应收 3.41", 100, 250, 220, 30),
                    ],
                  },
                ],
              },
            },
          ],
        }),
      ),
    );

    const result = await new GoogleVisionOcrClient("secret").recognizeImage({
      bytes: new TextEncoder().encode("image").buffer,
      sourceMimeType: "image/png",
      processedMimeType: "image/png",
      converted: false,
    });

    expect(result.markdown).toContain("[ROW 1] [x=100] 1234567890123 马铃薯(称重)");
    expect(result.markdown).toContain("[ROW 2] [x=900] 3.77 | [x=1300] 0.904 | [x=1600] 3.41");
  });

  it("preserves structured Google Vision error fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } },
          { status: 429 },
        ),
      ),
    );

    await expect(
      new GoogleVisionOcrClient("bad").recognizeImage({
        bytes: new ArrayBuffer(0),
        sourceMimeType: "image/png",
        processedMimeType: "image/png",
        converted: false,
      }),
    ).rejects.toMatchObject({
      name: "GoogleVisionOcrError",
      code: "GOOGLE_VISION_HTTP_ERROR",
      retryable: true,
      terminal: false,
    } satisfies Partial<GoogleVisionOcrError>);
  });

  it("detects Google Vision supported and conversion-required image types", () => {
    expect(googleVisionSupportsImageType("image/png")).toBe(true);
    expect(googleVisionSupportsImageType("image/jpeg")).toBe(true);
    expect(googleVisionSupportsImageType("image/heic")).toBe(false);
    expect(googleVisionSupportsImageType("image/tiff")).toBe(true);
  });

  it("keeps directly supported images without conversion", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;
    const result = await prepareImageForGoogleVision({ fileType: "image/jpeg" }, bytes);

    expect(result.fileType).toBe("image/jpeg");
    expect(result.converted).toBe(false);
    expect(result.bytes).toBe(bytes);
  });

  it("rejects HEIF container images that were not converted in the browser", async () => {
    const source = new Uint8Array([1, 2, 3]).buffer;
    await expect(prepareImageForGoogleVision({ fileType: "image/heic" }, source)).rejects.toMatchObject({
      code: "UNSUPPORTED_IMAGE_FORMAT",
      message: "图片未完成转换，请重新选择文件",
      terminal: true,
    });
  });

  it("rejects AVIF images when the browser did not convert them to JPEG", async () => {
    const source = new Uint8Array([4, 5, 6]).buffer;
    await expect(prepareImageForGoogleVision({ fileType: "image/avif" }, source)).rejects.toMatchObject({
      code: "UNSUPPORTED_IMAGE_FORMAT",
      terminal: true,
    });
  });

  it("rejects unsupported image formats instead of using Cloudflare image transforms", async () => {
    await expect(
      prepareImageForGoogleVision({ fileType: "image/svg+xml" }, new TextEncoder().encode("<svg />").buffer),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_IMAGE_FORMAT",
      terminal: true,
    });
  });

  it("averages page confidence and defaults to high confidence when absent", () => {
    expect(
      ocrConfidence(
        ocrResult({
          pages: [
            { text: "a", confidence: 0.7 },
            { text: "b", confidence: 0.9 },
          ],
        }),
      ),
    ).toBeCloseTo(0.8);
    expect(ocrConfidence(ocrResult({ pages: [{ text: "a" }] }))).toBe(1);
  });

  it("rejects oversized image imports before creating OCR jobs", () => {
    const file = new File([new Uint8Array(maximumImageImportFileBytes + 1)], "huge.jpg", {
      type: "image/jpeg",
    });

    expect(() => assertImageImportFile(file)).toThrow("文件大小必须在 1 B 到 5 MB 之间");
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
});

function ocrResult(input: Partial<GoogleVisionOcrResult> = {}): GoogleVisionOcrResult {
  return {
    plainText: "text",
    markdown: "text",
    pages: [{ text: "text" }],
    metadata: {
      input: {
        converted: false,
        sourceMimeType: "image/png",
        processedMimeType: "image/png",
      },
      engine: "google-vision",
      engineVersion: "v1",
    },
    ...input,
  };
}

function visionBlock(text: string, x: number, y: number, width: number, height: number) {
  return {
    boundingBox: {
      vertices: [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ],
    },
    paragraphs: [
      {
        words: text.split(" ").map((word) => ({
          symbols: Array.from(word).map((symbol) => ({ text: symbol, confidence: 0.99 })),
        })),
      },
    ],
  };
}
