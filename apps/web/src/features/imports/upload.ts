import { googleVisionSupportedImageTypes, supportedFileAccept } from "@shared-ledger/shared";
import { api } from "../../lib";
import { createPreviewThumbnail } from "./preview-thumbnail";
import type { ImportJobStatus } from "./status";

export const maximumAttachmentFiles = 5;
export const supportedImportAccept = supportedFileAccept;

export type ImportBatchJob = ImportJobStatus;
export type UploadPlaceholder = ImportJobStatus & {
  localOnly: true;
  status: "uploading";
};
export type UploadProgressEvent = {
  index: number;
  placeholderId?: string;
  fileName: string;
  fileType?: string;
  progress?: number;
  progressText: string;
  localPreviewUrl?: string;
  errorMessage?: string;
};

export type PreparedImportFile = {
  file: File;
  metadata: {
    originalName: string;
    originalType: string;
    converted: boolean;
  };
  localPreviewUrl?: string;
};

const googleVisionImageTypes = new Set<string>(googleVisionSupportedImageTypes);
const ocrInputMaxBytes = 7 * 1024 * 1024;
const nativePreviewImageTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/x-ms-bmp",
  "image/avif",
]);
const heifImageTypes = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const localUploadControllers = new Map<string, AbortController>();
const cancelledLocalUploadIds = new Set<string>();

export function createUploadPlaceholders(files: File[]): UploadPlaceholder[] {
  const timestamp = new Date().toISOString();
  return files.map((file, index) => ({
    id: `upload_${Date.now()}_${index}_${Math.random().toString(36).slice(2)}`,
    fileName: file.name,
    fileType: file.type || undefined,
    status: "uploading",
    progress: 2,
    progressText: "正在准备图片…",
    localOnly: true,
    localPreviewUrl: canUseLocalPreview(file) ? URL.createObjectURL(file) : undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

export function revokeUploadPlaceholderUrls(placeholders: ImportJobStatus[]) {
  if (typeof URL.revokeObjectURL !== "function") return;
  for (const placeholder of placeholders) {
    if (placeholder.localPreviewUrl) URL.revokeObjectURL(placeholder.localPreviewUrl);
  }
}

export function abortLocalImportUpload(placeholderId: string) {
  cancelledLocalUploadIds.add(placeholderId);
  const controller = localUploadControllers.get(placeholderId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export async function uploadImportFiles(
  bookId: string,
  files: File[],
  options?: {
    autoConfirm?: boolean;
    placeholders?: UploadPlaceholder[];
    signal?: AbortSignal;
    onProgress?: (event: UploadProgressEvent) => void;
  },
) {
  const body = new FormData();
  const requestSignal = options?.signal;
  const placeholderIds = (options?.placeholders ?? []).map((placeholder) => placeholder.id);
  placeholderIds.forEach((placeholderId) => cancelledLocalUploadIds.delete(placeholderId));
  const preparedFiles: Array<PreparedImportFile & { sourceIndex: number; placeholderId?: string }> = [];
  try {
    for (const [index, file] of files.entries()) {
      const placeholder = options?.placeholders?.[index];
      if (placeholder?.id && cancelledLocalUploadIds.has(placeholder.id)) continue;
      const preparationController = requestSignal ? undefined : new AbortController();
      const signal = requestSignal ?? preparationController?.signal;
      if (placeholder?.id && preparationController) {
        localUploadControllers.set(placeholder.id, preparationController);
      }
      const emit = (event: Omit<UploadProgressEvent, "index" | "fileName" | "placeholderId">) =>
        options?.onProgress?.({
          index,
          placeholderId: placeholder?.id,
          fileName: file.name,
          ...event,
        });
      try {
        const prepared = await prepareImageFileForUpload(file, {
          signal,
          onProgress: emit,
        });
        if (placeholder?.id && cancelledLocalUploadIds.has(placeholder.id)) {
          if (prepared.localPreviewUrl) URL.revokeObjectURL(prepared.localPreviewUrl);
          continue;
        }
        preparedFiles.push({ ...prepared, sourceIndex: index, placeholderId: placeholder?.id });
        emit({
          progress: 32,
          progressText: "准备上传…",
          fileType: prepared.file.type,
          ...(prepared.localPreviewUrl ? { localPreviewUrl: prepared.localPreviewUrl } : {}),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") continue;
        throw error;
      } finally {
        if (placeholder?.id) localUploadControllers.delete(placeholder.id);
      }
    }
    if (!preparedFiles.length) throw new DOMException("Aborted", "AbortError");
    preparedFiles.forEach((prepared) => body.append("files", prepared.file));
    body.append("fileMetadata", JSON.stringify(preparedFiles.map((prepared) => prepared.metadata)));
    if (options?.autoConfirm) body.append("autoConfirm", "true");
    assertNotAborted(requestSignal);
    preparedFiles.forEach((prepared) => {
      const placeholder = options?.placeholders?.[prepared.sourceIndex];
      options?.onProgress?.({
        index: prepared.sourceIndex,
        placeholderId: prepared.placeholderId ?? placeholder?.id,
        fileName: files[prepared.sourceIndex]?.name ?? prepared.file.name,
        fileType: prepared.file.type,
        progress: 40,
        progressText: "上传中…",
      });
    });
    return await api<{ jobs: ImportBatchJob[] }>(`/books/${bookId}/imports/batch`, {
      method: "POST",
      body,
      signal: requestSignal,
    });
  } finally {
    for (const placeholderId of placeholderIds) {
      localUploadControllers.delete(placeholderId);
      cancelledLocalUploadIds.delete(placeholderId);
    }
  }
}

export async function prepareImageFileForUpload(
  file: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (event: Omit<UploadProgressEvent, "index" | "fileName" | "placeholderId">) => void;
  } = {},
): Promise<PreparedImportFile> {
  const originalType = normalizedFileType(file);
  options.onProgress?.({ progress: 2, progressText: "正在准备图片…" });
  assertNotAborted(options.signal);

  const visionSupported = googleVisionImageTypes.has(originalType);
  if (visionSupported) {
    const compressed = await compressVisionSupportedImage(file, options);
    return {
      file: compressed.file,
      localPreviewUrl: compressed.localPreviewUrl,
      metadata: {
        originalName: file.name,
        originalType,
        converted: compressed.file.type.toLowerCase() !== originalType,
      },
    };
  }

  options.onProgress?.({ progress: 8, progressText: "正在转换格式…" });
  const converted = await convertUnsupportedImageToJpeg(file, options);
  return {
    file: converted.file,
    localPreviewUrl: converted.localPreviewUrl,
    metadata: {
      originalName: file.name,
      originalType,
      converted: true,
    },
  };
}

async function compressVisionSupportedImage(
  file: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (event: Omit<UploadProgressEvent, "index" | "fileName" | "placeholderId">) => void;
  },
) {
  if (file.size <= ocrInputMaxBytes && file.size < 512 * 1024) {
    options.onProgress?.({ progress: 28, progressText: "准备上传…" });
    return { file };
  }
  try {
    options.onProgress?.({ progress: 10, progressText: "正在压缩图片…" });
    const blob = await makeJpegWithinLimit(file, options);
    if (file.size <= ocrInputMaxBytes && blob.size >= file.size) {
      options.onProgress?.({ progress: 28, progressText: "准备上传…" });
      return { file };
    }
    const preparedFile = new File([blob], jpegFileName(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
    return {
      file: preparedFile,
      localPreviewUrl: createObjectUrl(preparedFile),
    };
  } catch (error) {
    if (file.size <= ocrInputMaxBytes) {
      options.onProgress?.({ progress: 28, progressText: "准备上传…" });
      return { file };
    }
    throw new Error(error instanceof Error ? error.message : "图片过大，请重新选择文件");
  }
}

async function convertUnsupportedImageToJpeg(
  file: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (event: Omit<UploadProgressEvent, "index" | "fileName" | "placeholderId">) => void;
  },
) {
  const fileType = normalizedFileType(file);
  let blob: Blob | undefined;
  if (nativePreviewImageTypes.has(fileType)) {
    try {
      blob = await makeJpegWithinLimit(file, options);
    } catch {
      blob = undefined;
    }
  }
  if (!blob && heifImageTypes.has(fileType)) {
    blob = await makeHeifJpegWithinLimit(file, options);
  }
  if (!blob) {
    throw new Error("当前浏览器无法转换该图片格式，请先导出为 JPEG 后重试");
  }
  const preparedFile = new File([blob], jpegFileName(file.name), {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
  return {
    file: preparedFile,
    localPreviewUrl: createObjectUrl(preparedFile),
  };
}

async function makeJpegWithinLimit(
  file: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (event: Omit<UploadProgressEvent, "index" | "fileName" | "placeholderId">) => void;
  },
) {
  const attempts = [
    { edge: 3000, quality: 0.9 },
    { edge: 2800, quality: 0.86 },
    { edge: 2400, quality: 0.84 },
    { edge: 2000, quality: 0.82 },
  ];
  let lastBlob: Blob | undefined;
  for (const attempt of attempts) {
    assertNotAborted(options.signal);
    const blob = await createPreviewThumbnail(file, {
      maxWidth: attempt.edge,
      maxHeight: attempt.edge,
      type: "image/jpeg",
      quality: attempt.quality,
      signal: options.signal,
    });
    lastBlob = blob;
    if (blob.size <= ocrInputMaxBytes) return blob;
  }
  throw new Error(lastBlob?.size ? "图片过大，请重新上传压缩图片" : "图片转换失败");
}

async function makeHeifJpegWithinLimit(
  file: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (event: Omit<UploadProgressEvent, "index" | "fileName" | "placeholderId">) => void;
  },
) {
  const { convertHeifToJpegBlob } = await import("./heif-converter");
  const attempts = [
    { edge: 3000, quality: 0.9 },
    { edge: 2800, quality: 0.86 },
    { edge: 2400, quality: 0.84 },
    { edge: 2000, quality: 0.82 },
  ];
  let lastBlob: Blob | undefined;
  for (const attempt of attempts) {
    assertNotAborted(options.signal);
    const blob = await convertHeifToJpegBlob(file, {
      maxWidth: attempt.edge,
      maxHeight: attempt.edge,
      quality: attempt.quality,
      signal: options.signal,
    });
    lastBlob = blob;
    if (blob.size <= ocrInputMaxBytes) return blob;
  }
  throw new Error(lastBlob?.size ? "图片过大，请重新上传压缩图片" : "图片转换失败");
}

function normalizedFileType(file: File) {
  return (file.type || guessImageTypeFromName(file.name) || "application/octet-stream").toLowerCase();
}

function guessImageTypeFromName(fileName: string) {
  const suffix = fileName.split(".").pop()?.toLowerCase();
  if (!suffix) return undefined;
  if (suffix === "jpg" || suffix === "jpeg") return "image/jpeg";
  if (suffix === "png") return "image/png";
  if (suffix === "gif") return "image/gif";
  if (suffix === "webp") return "image/webp";
  if (suffix === "bmp") return "image/bmp";
  if (suffix === "heic") return "image/heic";
  if (suffix === "heif") return "image/heif";
  if (suffix === "avif") return "image/avif";
  if (suffix === "tif" || suffix === "tiff") return "image/tiff";
  if (suffix === "raw") return "image/raw";
  if (suffix === "dng") return "image/dng";
  return undefined;
}

function jpegFileName(fileName: string) {
  return fileName.includes(".") ? fileName.replace(/\.[^.]+$/, ".jpg") : `${fileName}.jpg`;
}

function createObjectUrl(file: File) {
  return typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : undefined;
}

function canUseLocalPreview(file: File) {
  if (typeof URL.createObjectURL !== "function") return false;
  return nativePreviewImageTypes.has(normalizedFileType(file));
}

function assertNotAborted(signal?: AbortSignal): asserts signal is AbortSignal | undefined {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

export async function cancelImportJob(jobId: string) {
  return api<{ job: ImportBatchJob }>(`/imports/${jobId}/cancel`, { method: "POST" });
}

export async function deleteImportJob(jobId: string) {
  await api<void>(`/imports/${jobId}`, { method: "DELETE" });
}

export async function retryImportJob(jobId: string) {
  return api<{ job: ImportBatchJob }>(`/imports/${jobId}/retry`, { method: "POST" });
}
