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
