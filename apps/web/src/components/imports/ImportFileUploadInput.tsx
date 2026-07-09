import { type Ref, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";
import {
  isSupportedAttachment,
  maxAttachmentFiles,
  supportedFileAccept,
  unsupportedFileMessage,
} from "../../features/imports/files";
import {
  createUploadPlaceholders,
  revokeUploadPlaceholderUrls,
  uploadImportFiles,
  type ImportBatchJob,
  type UploadProgressEvent,
  type UploadPlaceholder,
} from "../../features/imports/upload";

export type ImportFileUploadInputHandle = {
  open: () => void;
};

type ImportFileUploadInputProps = {
  bookId?: string;
  disabled?: boolean;
  onUploadStart?: (placeholders: UploadPlaceholder[]) => void | Promise<void>;
  onUploadProgress?: (event: UploadProgressEvent) => void;
  onUploaded?: (jobs: ImportBatchJob[], placeholders: UploadPlaceholder[]) => void | Promise<void>;
  onUploadError?: (placeholders: UploadPlaceholder[], error: unknown) => void | Promise<void>;
  onUploadingChange?: (uploading: boolean) => void;
};

export function ImportFileUploadInput({
  bookId,
  disabled = false,
  onUploadStart,
  onUploadProgress,
  onUploaded,
  onUploadError,
  onUploadingChange,
  ref,
}: ImportFileUploadInputProps & { ref?: Ref<ImportFileUploadInputHandle> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const setUploadingState = (nextUploading: boolean) => {
    setUploading(nextUploading);
    onUploadingChange?.(nextUploading);
  };

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = "";
  };

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (disabled || uploading) return;
        inputRef.current?.click();
      },
    }),
    [disabled, uploading],
  );

  const upload = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (!files.length) {
      resetInput();
      return;
    }
    if (!bookId) {
      toast.error("请先选择账本", { duration: 3000, closeButton: true });
      resetInput();
      return;
    }
    const unsupported = files.find((file) => !isSupportedAttachment(file));
    if (unsupported) {
      toast.error(unsupportedFileMessage, {
        description: unsupported.name,
        duration: 3000,
        closeButton: true,
      });
      resetInput();
      return;
    }
    const selectedFiles = files.slice(0, maxAttachmentFiles);
    if (files.length > maxAttachmentFiles) {
      toast.warning(`一次最多上传 ${maxAttachmentFiles} 个文件`, { duration: 3000, closeButton: true });
    }

    setUploadingState(true);
    const placeholders = createUploadPlaceholders(selectedFiles);
    await onUploadStart?.(placeholders);
    try {
      const { jobs } = await uploadImportFiles(bookId, selectedFiles, {
        placeholders,
        onProgress: onUploadProgress,
      });
      await onUploaded?.(jobs, placeholders);
    } catch (cause) {
      await onUploadError?.(placeholders, cause);
      if (!onUploadError) {
        revokeUploadPlaceholderUrls(placeholders);
        toast.error(cause instanceof Error ? cause.message : "上传失败", {
          duration: 3000,
          closeButton: true,
        });
      }
    } finally {
      setUploadingState(false);
      resetInput();
    }
  };

  return (
    <input
      ref={inputRef}
      className="sr-only"
      type="file"
      multiple
      aria-label="上传图片"
      accept={supportedFileAccept}
      disabled={disabled || uploading}
      onChange={(event) => void upload(event.currentTarget.files)}
    />
  );
}
