import type { ImportJob } from "../store";
import { detectImageMimeType, GoogleVisionOcrError, googleVisionSupportsImageBytes } from "./ocr";

export const googleVisionInlineImageMaxBytes = 7 * 1024 * 1024;
const maxConvertibleInputBytes = 24 * 1024 * 1024;
const maxConvertiblePixels = 28_000_000;

export type ImageConversionOutput = {
  bytes: ArrayBuffer;
  fileType: string;
  converted: boolean;
};

export async function prepareImageForGoogleVision(job: ImportJob, sourceBytes: ArrayBuffer) {
  const sourceFileType = job.fileType.toLowerCase();
  const detectedFileType = detectImageMimeType(sourceBytes) ?? sourceFileType;
  if (googleVisionSupportsImageBytes(sourceBytes, sourceFileType)) {
    assertGoogleVisionInlineImageSize(sourceBytes);
    return {
      bytes: sourceBytes,
      fileType: detectedFileType,
      converted: false,
    } satisfies ImageConversionOutput;
  }

  if (isWorkerConvertibleImageType(sourceFileType) || isWorkerConvertibleImageType(detectedFileType)) {
    if (sourceBytes.byteLength > maxConvertibleInputBytes) {
      throw new GoogleVisionOcrError({
        code: "IMAGE_INPUT_TOO_LARGE",
        message: "图片过大，请压缩后重新上传",
        stage: "ocr",
        retryable: false,
        terminal: true,
      });
    }
    try {
      const { convertUnsupportedImageToJpeg } = await import("./image-codecs");
      const output = await convertUnsupportedImageToJpeg(sourceBytes, {
        maxPixels: maxConvertiblePixels,
        quality: 88,
      });
      assertGoogleVisionInlineImageSize(output);
      return {
        bytes: output,
        fileType: "image/jpeg",
        converted: true,
      } satisfies ImageConversionOutput;
    } catch (error) {
      throw new GoogleVisionOcrError({
        code: "IMAGE_CONVERSION_FAILED",
        message: error instanceof Error ? `图片转换失败：${error.message}` : "图片转换失败",
        stage: "ocr",
        retryable: false,
        terminal: true,
      });
    }
  }

  throw new GoogleVisionOcrError({
    code: "UNSUPPORTED_IMAGE_FORMAT",
    message: "当前图片格式不能用于 Google Vision OCR，也暂不支持在 Worker 中转换，请转换为 JPG 或 PNG 后重试",
    stage: "ocr",
    retryable: false,
    terminal: true,
  });
}

export function assertGoogleVisionInlineImageSize(bytes: ArrayBuffer) {
  if (bytes.byteLength <= googleVisionInlineImageMaxBytes) return;
  throw new GoogleVisionOcrError({
    code: "OCR_INPUT_TOO_LARGE",
    message: "图片过大，无法作为内联 OCR 输入，请压缩后重新上传",
    stage: "ocr",
    retryable: false,
    terminal: true,
  });
}

function isWorkerConvertibleImageType(fileType: string) {
  const normalized = fileType.toLowerCase();
  return (
    normalized === "image/heic" ||
    normalized === "image/heif" ||
    normalized === "image/heic-sequence" ||
    normalized === "image/heif-sequence" ||
    normalized === "image/avif"
  );
}
