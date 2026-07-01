import {
  supportedFileAccept as sharedSupportedFileAccept,
  supportedFileExtensions,
  supportedFileTypes,
} from "@shared-ledger/shared";

export const maxAttachmentFiles = 5;
export const supportedFileAccept = sharedSupportedFileAccept;
export const supportedFileDescription = "图片";
export const unsupportedFileMessage = "当前只支持图片识别";

export function isSupportedAttachment(file: File) {
  return (
    (supportedFileTypes as readonly string[]).includes(file.type) ||
    supportedFileExtensions.some((extension) => file.name.toLowerCase().endsWith(extension))
  );
}
