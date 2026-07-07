import { supportedFileAccept } from "@shared-ledger/shared";
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

export function createUploadPlaceholders(files: File[]): UploadPlaceholder[] {
  const timestamp = new Date().toISOString();
  return files.map((file, index) => ({
    id: `upload_${Date.now()}_${index}_${Math.random().toString(36).slice(2)}`,
    fileName: file.name,
    fileType: file.type || undefined,
    status: "uploading",
    progress: 4,
    progressText: "正在上传…",
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

export async function uploadImportFiles(bookId: string, files: File[], options?: { autoConfirm?: boolean }) {
  const body = new FormData();
  const uploadFiles = await Promise.all(files.map(prepareImageFileForUpload));
  uploadFiles.forEach((file) => body.append("files", file));
  if (options?.autoConfirm) body.append("autoConfirm", "true");
  return api<{ jobs: ImportBatchJob[] }>(`/books/${bookId}/imports/batch`, {
    method: "POST",
    body,
  });
}

export async function prepareImageFileForUpload(file: File) {
  if (!shouldDownscale(file)) return file;
  try {
    const blob = await createPreviewThumbnail(file, {
      maxWidth: 1800,
      maxHeight: 1800,
      type: "image/jpeg",
      quality: 0.84,
    });
    if (!blob.size || blob.size >= file.size) return file;
    return new File([blob], file.name, { type: blob.type || "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

function shouldDownscale(file: File) {
  if (file.size < 256 * 1024) return false;
  return ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.type.toLowerCase());
}

function canUseLocalPreview(file: File) {
  if (typeof URL.createObjectURL !== "function") return false;
  return ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/bmp"].includes(
    file.type.toLowerCase(),
  );
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
