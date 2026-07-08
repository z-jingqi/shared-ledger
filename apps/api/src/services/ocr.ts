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
  raw: Record<string, unknown>;
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
const supportedVisionImageTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/bmp",
  "image/webp",
  "image/tiff",
  "image/x-tiff",
  "image/raw",
  "image/x-raw",
  "image/x-adobe-dng",
  "image/x-canon-cr2",
  "image/x-nikon-nef",
  "image/x-sony-arw",
  "image/vnd.microsoft.icon",
  "image/x-icon",
]);

export class GoogleVisionOcrClient {
  constructor(private readonly apiKey: string) {}

  async recognizeImage(input: {
    bytes: ArrayBuffer;
    sourceMimeType: string;
    processedMimeType: string;
    converted: boolean;
  }): Promise<GoogleVisionOcrResult> {
    const response = await fetch(`${visionEndpoint}?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
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
      raw: (raw ?? {}) as Record<string, unknown>,
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
  const rows = extractReceiptItemRows(blocks);
  if (!rows.length) return undefined;
  const lines = [
    "OCR layout rows derived from Google Vision bounding boxes.",
    "Use lineAmount as the paid amount for each item; unitPrice and quantity are only context.",
    "",
    "| name | unitPrice | quantity | lineAmount |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${escapeMarkdownTable(row.name)} | ${row.unitPrice ?? ""} | ${row.quantity ?? ""} | ${row.lineAmount ?? ""} |`,
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

function extractReceiptItemRows(blocks: OcrLayoutBlock[]) {
  const products = mergeReceiptProductContinuations(blocks);
  if (!products.length) return [];
  const numericBlocks = blocks.filter((block) => isReceiptNumber(block.text));
  const columns = receiptColumnRanges([...products, ...numericBlocks]);

  return products.map((product, index) => {
    const rowNumbers = numericBlocks.filter((block) => isInProductRow(product, block));
    const unitPrice = nearestColumnValue(product, rowNumbers, columns.unit);
    const quantity = nearestColumnValue(product, rowNumbers, columns.quantity);
    const amount = nearestColumnValue(product, rowNumbers, columns.amount);
    const embedded = parseEmbeddedProductNumbers(product.text);
    return {
      name: cleanReceiptProductName(product.text),
      unitPrice: unitPrice ?? embedded.unitPrice,
      quantity: quantity ?? embedded.quantity,
      lineAmount:
        amount ?? inferredSingleItemAmount(unitPrice ?? embedded.unitPrice, quantity ?? embedded.quantity),
      sourceIndex: index,
    };
  });
}

function mergeReceiptProductContinuations(blocks: OcrLayoutBlock[]) {
  const productBlocks = blocks.filter((block) => isReceiptProductBlock(block.text));
  return productBlocks.map((product, index) => {
    const nextProductY = productBlocks[index + 1]?.y ?? Number.POSITIVE_INFINITY;
    const continuations = blocks.filter((block) => {
      if (block === product || isReceiptProductBlock(block.text) || isReceiptNumber(block.text)) return false;
      if (isReceiptNonItemText(block.text)) return false;
      return (
        block.y > product.y &&
        block.y < nextProductY &&
        block.y < product.y + 200 &&
        Math.abs(block.x - product.x) < 80
      );
    });
    if (!continuations.length) return product;
    const text = [product.text, ...continuations.map((block) => block.text)].join(" ");
    const bottom = Math.max(
      product.y + product.height,
      ...continuations.map((block) => block.y + block.height),
    );
    return { ...product, text, height: bottom - product.y };
  });
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

function isReceiptProductBlock(text: string) {
  const compact = text.replace(/\s+/g, "");
  if (!/^\d{8,}\*?/.test(compact)) return false;
  if (isReceiptNonItemText(compact)) return false;
  return /[\p{Script=Han}A-Za-z]/u.test(compact.replace(/^\d{8,}\*?/, ""));
}

function isReceiptNonItemText(text: string) {
  return /流水号|订单号|会员|积分|应收|实收|找零|优惠|合计|总计|收银员|机台号|交易时间|发票|反馈/.test(
    text.replace(/\s+/g, ""),
  );
}

function isReceiptNumber(text: string) {
  return /^-?\d+(?:\.\d{1,2})?$/.test(text.trim());
}

function isInProductRow(product: OcrLayoutBlock, candidate: OcrLayoutBlock) {
  const candidateCenterY = candidate.y + candidate.height / 2;
  const rowTop = product.y - 12;
  const rowBottom = product.y + product.height + 70;
  return candidateCenterY >= rowTop && candidateCenterY <= rowBottom;
}

function receiptColumnRanges(blocks: OcrLayoutBlock[]) {
  const minX = Math.min(...blocks.map((block) => block.x));
  const maxX = Math.max(...blocks.map((block) => block.x + block.width));
  const width = Math.max(maxX - minX, 1);
  const unitMax = minX + width * 0.28;
  const quantityMax = minX + width * 0.52;
  return {
    unit: [minX, unitMax] as const,
    quantity: [unitMax, quantityMax] as const,
    amount: [quantityMax, Number.POSITIVE_INFINITY] as const,
  };
}

function nearestColumnValue(
  product: OcrLayoutBlock,
  candidates: OcrLayoutBlock[],
  range: readonly [number, number],
) {
  const [minX, maxX] = range;
  const filtered = candidates.filter((candidate) => candidate.x >= minX && candidate.x < maxX);
  if (!filtered.length) return undefined;
  const rowAnchor = product.y + product.height;
  const nearest = filtered.sort((left, right) => {
    const leftDistance = Math.abs(left.y + left.height / 2 - rowAnchor);
    const rightDistance = Math.abs(right.y + right.height / 2 - rowAnchor);
    return leftDistance - rightDistance;
  })[0];
  return nearest.text.trim();
}

function parseEmbeddedProductNumbers(text: string): { unitPrice?: string; quantity?: string } {
  const values = text
    .trim()
    .match(/-?\d+(?:\.\d{1,2})?/g)
    ?.filter((value) => value.includes("."));
  const trailing = values?.at(-1);
  return trailing ? { unitPrice: trailing } : {};
}

function inferredSingleItemAmount(unitPrice: string | undefined, quantity: string | undefined) {
  if (!unitPrice) return undefined;
  const parsedQuantity = quantity ? Number.parseFloat(quantity) : 1;
  if (!Number.isFinite(parsedQuantity) || Math.abs(parsedQuantity - 1) > 0.001) return undefined;
  return unitPrice;
}

function cleanReceiptProductName(text: string) {
  return text
    .trim()
    .replace(/^\d{8,}\s*\*?\s*/, "")
    .replace(/\s+\d+(?:\.\d{1,2})\s+\d+(?:\.\d+)?$/, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([）)])$/, "$1")
    .trim();
}

function escapeMarkdownTable(value: string) {
  return value.replace(/\|/g, "\\|");
}

function arrayBufferToBase64(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < view.length; index += chunkSize) {
    binary += String.fromCharCode(...view.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
