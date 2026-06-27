import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";
import {
  isSupportedAttachment,
  maxAttachmentFiles,
  supportedFileAccept,
  supportedFileDescription,
} from "../../features/imports/files";
import { uploadImportFiles, type ImportBatchJob } from "../../features/imports/upload";

export type ImportFileUploadInputHandle = {
  open: () => void;
};

type ImportFileUploadInputProps = {
  bookId?: string;
  disabled?: boolean;
  onUploaded?: (jobs: ImportBatchJob[]) => void | Promise<void>;
  onUploadingChange?: (uploading: boolean) => void;
};

export const ImportFileUploadInput = forwardRef<ImportFileUploadInputHandle, ImportFileUploadInputProps>(
  function ImportFileUploadInput({ bookId, disabled = false, onUploaded, onUploadingChange }, ref) {
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
        toast.error("文件格式暂不支持", {
          description: `${unsupported.name} 不是支持的 ${supportedFileDescription} 格式。`,
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
      try {
        const { jobs } = await uploadImportFiles(bookId, selectedFiles);
        toast.success("文件已上传", {
          description: "识别会在后台继续，完成后进入待确认。",
          duration: 3000,
          closeButton: true,
        });
        await onUploaded?.(jobs);
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "上传失败", { duration: 3000, closeButton: true });
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
        accept={supportedFileAccept}
        disabled={disabled || uploading}
        onChange={(event) => void upload(event.currentTarget.files)}
      />
    );
  },
);
