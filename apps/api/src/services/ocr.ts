import { googleVisionSupportedImageTypes } from "@shared-ledger/shared";
import type { Env } from "../types";

export type GoogleVisionErrorPayload = {
  code: string;
  message: string;
  httpStatus?: number;
  requestId?: string;
  stage?: string;
  retryable?: boolean;
  terminal?: boolean;
};

export class GoogleVisionOcrError extends Error {
  code: string;
  httpStatus?: number;
  requestId?: string;
  stage?: string;
  retryable: boolean;
  terminal: boolean;

  constructor(payload: GoogleVisionErrorPayload) {
    super(payload.message);
    this.name = "GoogleVisionOcrError";
    this.code = payload.code;
    this.httpStatus = payload.httpStatus;
    this.requestId = payload.requestId;
    this.stage = payload.stage;
    this.retryable = payload.retryable ?? false;
    this.terminal = payload.terminal ?? false;
  }
}

export type GoogleVisionOcrResult = {
  plainText: string;
  markdown?: string;
  pages: Array<{ text: string; confidence?: number | null }>;
  metadata: {
    input: {
      converted: boolean;
      sourceMimeType: string;
      processedMimeType: string;
    };
    engine: "google-vision";
    engineVersion: "v1";
  };
};

type VisionAnnotateResult = {
  error?: { code?: number; message?: string; status?: string };
  fullTextAnnotation?: {
    text?: string;
    pages?: Array<{
      confidence?: number;
      width?: number;
      height?: number;
      blocks?: VisionBlock[];
    }>;
  };
  textAnnotations?: Array<{ description?: string }>;
};

type VisionAnnotateResponse = {
  responses?: VisionAnnotateResult[];
};

type VisionVertex = { x?: number; y?: number };
type VisionBoundingBox = { vertices?: VisionVertex[] };
type VisionSymbol = { text?: string; confidence?: number };
type VisionWord = {
  boundingBox?: VisionBoundingBox;
  symbols?: VisionSymbol[];
  confidence?: number;
};
type VisionParagraph = {
  boundingBox?: VisionBoundingBox;
  words?: VisionWord[];
};
type VisionBlock = {
  boundingBox?: VisionBoundingBox;
  paragraphs?: VisionParagraph[];
};
type OcrLayoutBlock = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const visionEndpoint = "https://vision.googleapis.com/v1/images:annotate";
const supportedVisionImageTypes = new Set<string>(googleVisionSupportedImageTypes);

export class GoogleVisionOcrClient {
  constructor(private readonly apiKey: string) {}

  async recognizeImage(input: {
    bytes: ArrayBuffer;
    sourceMimeType: string;
    processedMimeType: string;
    converted: boolean;
  }): Promise<GoogleVisionOcrResult> {
    const response = await fetch(visionEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Goog-Api-Key": this.apiKey,
      },
      body: JSON.stringify({
        requests: [
          {
            image: { content: arrayBufferToBase64(input.bytes) },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            imageContext: { languageHints: ["zh", "en"] },
          },
        ],
      }),
    });
    const raw = (await response.json().catch(() => null)) as VisionAnnotateResponse | null;
    if (!response.ok) {
      throw new GoogleVisionOcrError({
        code: "GOOGLE_VISION_HTTP_ERROR",
        message: `Google Vision OCR request failed (${response.status})`,
        httpStatus: response.status,
        requestId: response.headers.get("x-request-id") ?? undefined,
        stage: "ocr",
        retryable: response.status >= 500 || response.status === 429,
        terminal: response.status < 500 && response.status !== 429,
      });
    }
    const result = raw?.responses?.[0];
    if (result?.error) {
      throw new GoogleVisionOcrError({
        code: result.error.status ?? "GOOGLE_VISION_ERROR",
        message: result.error.message ?? "Google Vision OCR failed",
        httpStatus: result.error.code,
        stage: "ocr",
        retryable: (result.error.code ?? 500) >= 500 || result.error.code === 429,
        terminal: (result.error.code ?? 500) < 500 && result.error.code !== 429,
      });
    }
    const text =
      result?.fullTextAnnotation?.text?.trim() ?? result?.textAnnotations?.[0]?.description?.trim() ?? "";
    return {
      plainText: text,
      markdown: buildVisionLayoutMarkdown(result) ?? text,
      pages: [
        {
          text,
          confidence: averageConfidence(result?.fullTextAnnotation?.pages),
        },
      ],
      metadata: {
        input: {
          converted: input.converted,
          sourceMimeType: input.sourceMimeType,
          processedMimeType: input.processedMimeType,
        },
        engine: "google-vision",
        engineVersion: "v1",
      },
    };
  }
}

export function runtimeOcrClient(env: Env): GoogleVisionOcrClient {
  if (!env.GOOGLE_VISION_API_KEY) throw new Error("GOOGLE_VISION_API_KEY 未配置，无法识别图片");
  return new GoogleVisionOcrClient(env.GOOGLE_VISION_API_KEY);
}

export function ocrConfidence(result: GoogleVisionOcrResult): number {
  const values = result.pages
    .map((page) => page.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function googleVisionSupportsImageType(fileType: string) {
  return supportedVisionImageTypes.has(fileType.toLowerCase());
}

export function googleVisionSupportsImageBytes(bytes: ArrayBuffer, declaredMimeType: string) {
  return googleVisionSupportsImageType(detectImageMimeType(bytes) ?? declaredMimeType);
}

export function detectImageMimeType(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes);
  if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) return "image/jpeg";
  if (
    view.length >= 8 &&
    view[0] === 0x89 &&
    view[1] === 0x50 &&
    view[2] === 0x4e &&
    view[3] === 0x47 &&
    view[4] === 0x0d &&
    view[5] === 0x0a &&
    view[6] === 0x1a &&
    view[7] === 0x0a
  ) {
    return "image/png";
  }
  if (view.length >= 6 && view[0] === 0x47 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x38) {
    return "image/gif";
  }
  if (view.length >= 2 && view[0] === 0x42 && view[1] === 0x4d) return "image/bmp";
  if (
    view.length >= 12 &&
    view[0] === 0x52 &&
    view[1] === 0x49 &&
    view[2] === 0x46 &&
    view[3] === 0x46 &&
    view[8] === 0x57 &&
    view[9] === 0x45 &&
    view[10] === 0x42 &&
    view[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    view.length >= 4 &&
    ((view[0] === 0x49 && view[1] === 0x49 && view[2] === 0x2a && view[3] === 0x00) ||
      (view[0] === 0x4d && view[1] === 0x4d && view[2] === 0x00 && view[3] === 0x2a))
  ) {
    return "image/tiff";
  }
  return undefined;
}

function averageConfidence(pages: Array<{ confidence?: number }> | undefined) {
  const values = (pages ?? [])
    .map((page) => page.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildVisionLayoutMarkdown(result: VisionAnnotateResult | undefined) {
  const blocks = extractLayoutBlocks(result?.fullTextAnnotation?.pages);
  const rows = groupVisionBlocksIntoRows(blocks);
  if (!rows.length) return undefined;
  const lines = [
    "OCR visual rows derived from Google Vision bounding boxes.",
    "Each ROW preserves visual grouping only. Smaller x values are farther left; infer column meanings from the receipt headers.",
    "No unit price, quantity, or line amount semantics have been assigned in advance.",
    "",
    ...rows.map(
      (row, index) =>
        `[ROW ${index + 1}] ${row.blocks
          .map((block) => `[x=${Math.round(block.x)}] ${normalizeLayoutText(block.text)}`)
          .join(" | ")}`,
    ),
  ];
  return lines.join("\n");
}

function extractLayoutBlocks(pages: Array<{ blocks?: VisionBlock[] }> | undefined) {
  const blocks: OcrLayoutBlock[] = [];
  for (const page of pages ?? []) {
    for (const block of page.blocks ?? []) {
      const box = boundingBox(block.boundingBox);
      const text = blockText(block).trim();
      if (!text || !box) continue;
      blocks.push({ text, ...box });
    }
  }
  return blocks.sort((left, right) => left.y - right.y || left.x - right.x);
}

function groupVisionBlocksIntoRows(blocks: OcrLayoutBlock[]) {
  const rows: Array<{
    centerY: number;
    height: number;
    blocks: OcrLayoutBlock[];
  }> = [];
  for (const block of blocks) {
    const centerY = block.y + block.height / 2;
    const row = rows
      .filter(
        (candidate) =>
          Math.abs(candidate.centerY - centerY) <= Math.max(candidate.height, block.height) * 0.65,
      )
      .sort((left, right) => Math.abs(left.centerY - centerY) - Math.abs(right.centerY - centerY))[0];
    if (!row) {
      rows.push({ centerY, height: block.height, blocks: [block] });
      continue;
    }
    row.blocks.push(block);
    const rowTop = Math.min(...row.blocks.map((item) => item.y));
    const rowBottom = Math.max(...row.blocks.map((item) => item.y + item.height));
    row.centerY = (rowTop + rowBottom) / 2;
    row.height = rowBottom - rowTop;
  }
  return rows
    .sort((left, right) => left.centerY - right.centerY)
    .map((row) => ({
      blocks: row.blocks.sort((left, right) => left.x - right.x),
    }));
}

function boundingBox(box: VisionBoundingBox | undefined) {
  const vertices = box?.vertices?.filter(
    (vertex): vertex is Required<VisionVertex> =>
      typeof vertex.x === "number" &&
      Number.isFinite(vertex.x) &&
      typeof vertex.y === "number" &&
      Number.isFinite(vertex.y),
  );
  if (!vertices?.length) return undefined;
  const xs = vertices.map((vertex) => vertex.x);
  const ys = vertices.map((vertex) => vertex.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function blockText(block: VisionBlock) {
  return (block.paragraphs ?? [])
    .flatMap((paragraph) => paragraph.words ?? [])
    .map((word) => (word.symbols ?? []).map((symbol) => symbol.text ?? "").join(""))
    .join(" ");
}

function normalizeLayoutText(value: string) {
  return value.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function arrayBufferToBase64(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes);
  const nativeView = view as Uint8Array & { toBase64?: () => string };
  if (typeof nativeView.toBase64 === "function") return nativeView.toBase64();
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < view.length; index += chunkSize) {
    binary += String.fromCharCode(...view.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
