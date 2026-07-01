import { supportedFileTypes } from "@shared-ledger/import";
import { imageOcrDailyLimits, supportedFileExtensions } from "@shared-ledger/shared";
import type { D1LedgerRepository } from "../repository";

export const maximumImageImportFileBytes = 10 * 1024 * 1024;
export const maximumImageImportBatchFiles = 5;

export class ImportUploadError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ImportUploadError";
  }
}

export function assertImageImportFile(value: unknown): asserts value is File {
  if (!(value instanceof File) || !value.name) throw new ImportUploadError("当前只支持图片识别");
  if (!isSupportedImageMimeType(value.type) && !hasSupportedImageExtension(value.name)) {
    throw new ImportUploadError("当前只支持图片识别");
  }
  if (value.size <= 0 || value.size > maximumImageImportFileBytes) {
    throw new ImportUploadError("文件大小必须在 1 B 到 10 MB 之间");
  }
  const resolvedType = imageImportFileType(value);
  if (!resolvedType.startsWith("image/") || !isSupportedImageMimeType(resolvedType)) {
    throw new ImportUploadError("当前只支持图片识别");
  }
}

export function imageImportFileType(file: File) {
  const normalizedMimeType = normalizeImageMimeType(file.type);
  if (normalizedMimeType) return normalizedMimeType;
  const name = file.name.toLowerCase();
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".heic")) return "image/heic";
  if (name.endsWith(".heif")) return "image/heif";
  if (name.endsWith(".tif") || name.endsWith(".tiff")) return "image/tiff";
  if (name.endsWith(".bmp")) return "image/bmp";
  if (name.endsWith(".raw")) return "image/x-raw";
  if (name.endsWith(".dng")) return "image/x-adobe-dng";
  return file.type;
}

export async function assertImageOcrQuota(repository: D1LedgerRepository, userId: string, requested = 1) {
  const plan = await repository.getUserPlan(userId);
  const limit = imageOcrLimitForPlan(plan);
  if (limit <= 0) throw new ImportUploadError("当前套餐不支持图片识别", 403);
  const date = shanghaiUsageDate();
  const [used, active] = await Promise.all([
    repository.countDailyImageOcrUsage(userId, date),
    repository.countActiveImageOcrJobs(userId, shanghaiDateRange(date)),
  ]);
  if (used + active + requested > limit) throw new ImportUploadError("今日图片识别额度已用完", 429);
}

export function imageOcrLimitForPlan(plan: unknown) {
  return plan === "pro" ? imageOcrDailyLimits.pro : imageOcrDailyLimits.free;
}

export function shanghaiUsageDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function shanghaiDateRange(usageDate: string) {
  const start = new Date(`${usageDate}T00:00:00+08:00`);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function normalizeImageMimeType(type: string) {
  const normalized = type.toLowerCase();
  if (!normalized) return "";
  if (normalized === "image/jpg") return "image/jpeg";
  if (normalized === "image/x-tiff") return "image/tiff";
  if (normalized === "image/x-ms-bmp") return "image/bmp";
  if (normalized === "image/raw") return "image/x-raw";
  if (normalized === "image/dng" || normalized === "image/x-dng") return "image/x-adobe-dng";
  if (normalized === "image/heic-sequence") return "image/heic";
  if (normalized === "image/heif-sequence") return "image/heif";
  return isSupportedImageMimeType(normalized) ? normalized : "";
}

function isSupportedImageMimeType(type: string): type is (typeof supportedFileTypes)[number] {
  return (supportedFileTypes as readonly string[]).includes(type);
}

function hasSupportedImageExtension(name: string) {
  return supportedFileExtensions.some((extension) => name.toLowerCase().endsWith(extension));
}
