import {
  CheckCircleIcon,
  CircleNotchIcon,
  FileIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

export type ImportAttachmentView = {
  id: string;
  file: File;
  previewUrl?: string;
  jobId?: string;
  status?: "idle" | "uploading" | "processing" | "completed" | "failed";
  errorMessage?: string;
  retryable?: boolean;
  cancelable?: boolean;
  progress?: number;
  stage?: string;
  currentPage?: number;
  totalPages?: number;
};

export function ImportAttachmentCards({
  attachments,
  onRemove,
  onCancel,
  onRetry,
}: {
  attachments: ImportAttachmentView[];
  onRemove?: (id: string) => void;
  onCancel?: (id: string) => Promise<void> | void;
  onRetry?: (id: string) => Promise<void> | void;
}) {
  const [confirming, setConfirming] = useState<ImportAttachmentView>();
  const [cancellingId, setCancellingId] = useState<string>();
  const [retryingId, setRetryingId] = useState<string>();
  if (!attachments.length) return null;
  const cancel = async () => {
    if (!confirming || !onCancel) return;
    setCancellingId(confirming.id);
    try {
      await onCancel(confirming.id);
      setConfirming(undefined);
    } finally {
      setCancellingId(undefined);
    }
  };
  return (
    <>
      <div className="import-attachment-strip" aria-label="已选择附件">
        {attachments.map((attachment) => (
          <article className="import-attachment-card" key={attachment.id}>
            {attachment.previewUrl ? (
              <img src={attachment.previewUrl} alt={attachment.file.name} />
            ) : (
              <div className="import-file-preview">
                <strong>{fileExtension(attachment.file.name)}</strong>
                <span>{attachment.file.name}</span>
              </div>
            )}
            {onRemove && !isLocked(attachment.status) && (
              <button type="button" aria-label={`移除 ${attachment.file.name}`} onClick={() => onRemove(attachment.id)}>
                <XIcon size={16} />
              </button>
            )}
            {attachment.status === "completed" && (
              <span className="import-card-status complete" aria-label="处理完成">
                <CheckCircleIcon size={34} weight="fill" />
              </span>
            )}
            {attachment.status === "failed" && (
              <span className="import-card-status failed" title={attachment.errorMessage} aria-label="处理失败">
                <WarningCircleIcon size={34} weight="fill" />
                {attachment.retryable && onRetry && (
                  <button
                    className="import-retry-inline"
                    type="button"
                    disabled={retryingId === attachment.id}
                    onClick={async () => {
                      setRetryingId(attachment.id);
                      try {
                        await onRetry(attachment.id);
                      } finally {
                        setRetryingId(undefined);
                      }
                    }}
                  >
                    {retryingId === attachment.id ? "重试中" : "重试"}
                  </button>
                )}
              </span>
            )}
            {(attachment.status === "uploading" || attachment.status === "processing") && (
              <span className="import-card-overlay">
                <CircleNotchIcon size={28} weight="bold" />
                {importProgressLabel(attachment)}
                {attachment.status === "processing" && onCancel && attachment.cancelable !== false && (
                  <button
                    className="import-cancel-inline"
                    type="button"
                    disabled={cancellingId === attachment.id}
                    onClick={() => setConfirming(attachment)}
                  >
                    取消
                  </button>
                )}
              </span>
            )}
          </article>
        ))}
      </div>
      {confirming && (
        <>
          <button
            className="import-cancel-backdrop"
            type="button"
            aria-label="关闭取消识别"
            onClick={() => setConfirming(undefined)}
          />
          <dialog open className="import-cancel-sheet" aria-modal="true" aria-label="取消识别">
            <span className="sheet-grabber" aria-hidden="true" />
            <h2>取消识别？</h2>
            <p>取消后不会保存这次导入，已处理的页面也会被丢弃。</p>
            <div className="import-cancel-file">
              <strong>{fileExtension(confirming.file.name)}</strong>
              <span>{confirming.file.name}</span>
            </div>
            <button
              className="import-cancel-danger"
              type="button"
              disabled={cancellingId === confirming.id}
              onClick={() => void cancel()}
            >
              {cancellingId === confirming.id ? "取消中" : "取消识别"}
            </button>
            <button
              className="import-cancel-secondary"
              type="button"
              disabled={cancellingId === confirming.id}
              onClick={() => setConfirming(undefined)}
            >
              继续等待
            </button>
          </dialog>
        </>
      )}
    </>
  );
}

function importProgressLabel(attachment: ImportAttachmentView) {
  if (attachment.status === "uploading") return "上传中";
  if (attachment.stage === "converting") return "正在转换图片";
  if (attachment.stage === "compressing") return "正在压缩图片";
  if (attachment.stage === "ai_processing" || attachment.stage === "ready") return "AI 分析中";
  if (typeof attachment.currentPage === "number" && typeof attachment.totalPages === "number") {
    return `第 ${attachment.currentPage}/${attachment.totalPages} 页`;
  }
  if (typeof attachment.progress === "number" && attachment.progress > 0) return `OCR ${attachment.progress}%`;
  return "处理中";
}

function isLocked(status: ImportAttachmentView["status"]) {
  return status === "uploading" || status === "processing";
}

function fileExtension(name: string) {
  const extension = name.split(".").pop()?.trim();
  return extension ? extension.slice(0, 8).toUpperCase() : <FileIcon size={34} />;
}
