import {
  supportedFileAccept as sharedSupportedFileAccept,
  supportedFileExtensions,
  supportedFileTypes,
} from "@shared-ledger/shared";

export const maxAttachmentFiles = 5;
export const supportedFileAccept = sharedSupportedFileAccept;
export const supportedFileDescription = "图片、PDF、Excel、CSV";

export function isSupportedAttachment(file: File) {
  return (
    (supportedFileTypes as readonly string[]).includes(file.type) ||
    supportedFileExtensions.some((extension) => file.name.toLowerCase().endsWith(extension))
  );
}

export function isOcrAttachment(file: File) {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("image/") ||
    file.type === "application/pdf" ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".webp") ||
    name.endsWith(".heic") ||
    name.endsWith(".heif") ||
    name.endsWith(".tif") ||
    name.endsWith(".tiff") ||
    name.endsWith(".bmp") ||
    name.endsWith(".pdf")
  );
}
