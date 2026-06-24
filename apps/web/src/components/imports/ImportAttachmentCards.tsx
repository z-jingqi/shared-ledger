import {
  CheckCircleIcon,
  CircleNotchIcon,
  FileIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";

export type ImportAttachmentView = {
  id: string;
  file: File;
  previewUrl?: string;
  jobId?: string;
  status?: "idle" | "uploading" | "processing" | "completed" | "failed";
  errorMessage?: string;
};

export function ImportAttachmentCards({
  attachments,
  onRemove,
}: {
  attachments: ImportAttachmentView[];
  onRemove?: (id: string) => void;
}) {
  if (!attachments.length) return null;
  return (
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
            </span>
          )}
          {(attachment.status === "uploading" || attachment.status === "processing") && (
            <span className="import-card-overlay">
              <CircleNotchIcon size={28} weight="bold" />
              处理中
            </span>
          )}
        </article>
      ))}
    </div>
  );
}

function isLocked(status: ImportAttachmentView["status"]) {
  return status === "uploading" || status === "processing";
}

function fileExtension(name: string) {
  const extension = name.split(".").pop()?.trim();
  return extension ? extension.slice(0, 8).toUpperCase() : <FileIcon size={34} />;
}
