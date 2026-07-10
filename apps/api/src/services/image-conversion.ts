import { detectImageMimeType, GoogleVisionOcrError, googleVisionSupportsImageBytes } from "./ocr";

export const googleVisionInlineImageMaxBytes = 4 * 1024 * 1024;

export type ImageConversionOutput = {
  bytes: ArrayBuffer;
  fileType: string;
  converted: boolean;
};

export async function prepareImageForGoogleVision(input: { fileType: string }, sourceBytes: ArrayBuffer) {
  const sourceFileType = input.fileType.toLowerCase();
  const detectedFileType = detectImageMimeType(sourceBytes) ?? sourceFileType;
  if (googleVisionSupportsImageBytes(sourceBytes, sourceFileType)) {
    assertGoogleVisionInlineImageSize(sourceBytes);
    return {
      bytes: sourceBytes,
      fileType: detectedFileType,
      converted: false,
    } satisfies ImageConversionOutput;
  }

  throw new GoogleVisionOcrError({
    code: "UNSUPPORTED_IMAGE_FORMAT",
    message: "图片未完成转换，请重新选择文件",
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
