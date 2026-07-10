import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeGoogleVisionOcrText } from "../../src/services/imports";
import { GoogleVisionOcrClient } from "../../src/services/ocr";

const runLiveOcr = process.env.REFRESH_RECEIPT_OCR === "1";
const testDir = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(testDir, "../..");
const fixturePath = resolve(apiDir, "test/fixtures/receipts/IMG_4706.ocr.txt");

describe.skipIf(!runLiveOcr)("receipt OCR fixture refresh", () => {
  it("refreshes the normalized IMG_4706 OCR text with one Google Vision request", async () => {
    const vars = parseDevVars(await readFile(resolve(apiDir, ".dev.vars"), "utf8"));
    const apiKey = vars.GOOGLE_VISION_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_VISION_API_KEY is missing from apps/api/.dev.vars");
    const imagePath = process.env.RECEIPT_JPEG_PATH;
    if (!imagePath) throw new Error("RECEIPT_JPEG_PATH must point to the browser-converted JPEG");
    const image = await readFile(imagePath);
    const bytes = image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength);
    const result = await new GoogleVisionOcrClient(apiKey).recognizeImage({
      bytes,
      sourceMimeType: "image/heic",
      processedMimeType: "image/jpeg",
      converted: true,
    });
    const normalized = normalizeGoogleVisionOcrText(result);
    expect(normalized).toContain("234.49");
    expect(normalized.length).toBeGreaterThan(100);
    await mkdir(dirname(fixturePath), { recursive: true });
    await writeFile(fixturePath, `${normalized.trim()}\n`);
  });
});

function parseDevVars(source: string) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}
