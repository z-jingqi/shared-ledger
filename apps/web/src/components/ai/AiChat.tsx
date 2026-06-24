import { CaretRightIcon, PlusIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";
import { useChat } from "@ai-sdk/react";
import { Button, Textarea } from "@shared-ledger/ui";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { ImportAttachmentCards, type ImportAttachmentView } from "../imports/ImportAttachmentCards";
import {
  maximumAttachmentFiles,
  supportedImportAccept,
  uploadImportFiles,
} from "../../features/imports/upload";
import { isSupportedAttachment, supportedFileDescription } from "../../features/imports/files";
import { watchImportJobs } from "../../features/imports/status";
import { API } from "../../lib";

export function AiChat({
  bookId,
  page,
  compact = false,
}: {
  bookId?: string;
  page: string;
  compact?: boolean;
}) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ImportAttachmentView[]>([]);
  const [isUploading, setUploading] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stopWatchingRef = useRef<(() => void) | undefined>(undefined);
  const previewUrlsRef = useRef(new Set<string>());
  const transport = useMemo(
    () => new DefaultChatTransport({ api: `${API}/ai/chat`, credentials: "include", body: { bookId, page } }),
    [bookId, page],
  );
  const { messages, sendMessage, status, error, stop } = useChat({ transport, experimental_throttle: 50 });
  const busy = status === "streaming" || status === "submitted" || isUploading;

  useEffect(() => {
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) previewUrlsRef.current.add(attachment.previewUrl);
    });
  }, [attachments]);

  useEffect(() => () => {
    stopWatchingRef.current?.();
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight || "22");
    const maximumHeight = lineHeight * 5;
    const nextHeight = Math.min(textarea.scrollHeight, maximumHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maximumHeight ? "auto" : "hidden";
    setComposerExpanded(nextHeight > lineHeight * 1.5 || attachments.length > 0);
  }, [input, attachments.length]);

  const addAttachments = (files: FileList | null) => {
    if (!files?.length) return;
    const incoming = Array.from(files);
    const unsupported = incoming.find((file) => !isSupportedAttachment(file));
    if (unsupported) {
      toast.error("附件格式暂不支持", {
        description: `${unsupported.name} 不是支持的 ${supportedFileDescription} 格式。`,
        duration: 3000,
        closeButton: true,
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const next = [...attachments, ...incoming.map(createAttachment)].slice(0, maximumAttachmentFiles);
    if (attachments.length + incoming.length > maximumAttachmentFiles) {
      toast.warning(`一次最多添加 ${maximumAttachmentFiles} 个附件`, {
        duration: 3000,
        closeButton: true,
      });
    }
    setAttachments(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (attachments.length && !bookId) {
      toast.error("请先选择账本再上传附件", { duration: 3000, closeButton: true });
      return;
    }
    setInput("");
    const uploadableAttachments = attachments.filter(
      (attachment) => attachment.status === "idle" || attachment.status === "failed",
    );
    if (uploadableAttachments.length && bookId) {
      const shouldSaveAttachments = hasAttachmentSaveIntent(text);
      if (!shouldSaveAttachments) {
        toast.info("附件已忽略", {
          description: "没有检测到保存/记账意图，所以不会解析、保存或进入待确认。",
          duration: 3000,
          closeButton: true,
        });
        clearAttachments(uploadableAttachments.map((attachment) => attachment.id));
      } else {
        const uploadIds = new Set(uploadableAttachments.map((attachment) => attachment.id));
        try {
          setUploading(true);
          setAttachments((current) =>
            current.map((attachment) =>
              uploadIds.has(attachment.id) ? { ...attachment, status: "uploading" } : attachment,
            ),
          );
          const { jobs } = await uploadImportFiles(
            bookId,
            uploadableAttachments.map((attachment) => attachment.file),
            { autoConfirm: true },
          );
          const jobToAttachment = new Map<string, string>();
          jobs.forEach((job, index) => {
            const attachment = uploadableAttachments[index];
            if (attachment) jobToAttachment.set(job.id, attachment.id);
          });
          setAttachments((current) =>
            current.map((attachment) => {
              const job = jobs.find((item) => jobToAttachment.get(item.id) === attachment.id);
              return job ? { ...attachment, status: "processing", jobId: job.id } : attachment;
            }),
          );
          stopWatchingRef.current?.();
          stopWatchingRef.current = watchImportJobs(jobs.map((job) => job.id), (job) => {
            const attachmentId = jobToAttachment.get(job.id);
            if (!attachmentId) return;
            setAttachments((current) =>
              current.map((attachment) =>
                attachment.id === attachmentId
                  ? {
                      ...attachment,
                      status:
                        job.status === "failed"
                          ? "failed"
                          : job.status === "completed" || job.status === "pending_confirmation"
                            ? "completed"
                            : "processing",
                      errorMessage: job.errorMessage,
                    }
                  : attachment,
              ),
            );
          });
          toast.success(`已提交 ${jobs.length} 个附件，正在 OCR 和 AI 分析`, {
            description: "完成后会自动保存到当前账本。",
            duration: 3000,
            closeButton: true,
          });
        } catch (cause) {
          toast.error(cause instanceof Error ? cause.message : "附件上传失败", {
            duration: 3000,
            closeButton: true,
          });
          setAttachments((current) =>
            current.map((attachment) =>
              uploadIds.has(attachment.id) ? { ...attachment, status: "failed", errorMessage: "附件上传失败" } : attachment,
            ),
          );
          setInput(text);
          return;
        } finally {
          setUploading(false);
        }
      }
    }
    if (text) void sendMessage({ text });
  };

  const clearAttachments = (ids: string[]) => {
    const removing = new Set(ids);
    setAttachments((current) => {
      current.forEach((attachment) => {
        if (removing.has(attachment.id) && attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      return current.filter((attachment) => !removing.has(attachment.id));
    });
  };

  const renderMessageText = (message: (typeof messages)[number]) =>
    message.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");

  return (
    <div className={compact ? "ai-content" : "ai-page"}>
      {messages.length === 0 ? (
        <div className="ai-empty">
          <SparkleIcon size={33} weight="fill" />
          <h2>今天想聊聊账本的什么？</h2>
          <p>我可以分析趋势、解释图表，也可以帮你整理上传的票据和表格。</p>
        </div>
      ) : (
        <div className="ai-messages" aria-live="polite">
          {messages.map((message, index) => {
            const text = renderMessageText(message);
            return (
              <article key={message.id} className={`ai-message ${message.role === "user" ? "ai-user" : "ai-assistant"}`}>
                {message.role === "assistant" ? (
                  <Streamdown
                    className="ai-markdown"
                    mode={status === "streaming" && index === messages.length - 1 ? "streaming" : "static"}
                  >
                    {text}
                  </Streamdown>
                ) : (
                  <p>{text}</p>
                )}
              </article>
            );
          })}
        </div>
      )}
      <form className={`ai-composer ${composerExpanded ? "expanded" : ""}`} onSubmit={submit}>
        <ImportAttachmentCards attachments={attachments} onRemove={(id) => clearAttachments([id])} />
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          multiple
          accept={supportedImportAccept}
          onChange={(event) => addAttachments(event.currentTarget.files)}
        />
        <Button
          aria-label="添加附件"
          className="ai-composer-attach"
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || attachments.length >= maximumAttachmentFiles}
        >
          <PlusIcon />
        </Button>
        <Textarea
          ref={textareaRef}
          className="ai-composer-textarea"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="问问你的账本，或添加附件导入…"
          disabled={busy}
          rows={1}
        />
        {status === "streaming" || status === "submitted" ? (
          <Button className="ai-composer-send" type="button" size="icon" aria-label="停止" onClick={stop}>
            <XIcon />
          </Button>
        ) : (
          <Button className="ai-composer-send" aria-label="发送" size="icon" disabled={isUploading}>
            <CaretRightIcon />
          </Button>
        )}
      </form>
      {error && <p className="field-error">{error.message}</p>}
    </div>
  );
}

function hasAttachmentSaveIntent(text: string) {
  return /保存|记账|入账|导入|记录|存到|添加到/.test(text);
}

function createAttachment(file: File): ImportAttachmentView {
  const canPreview = file.type.startsWith("image/") && typeof URL.createObjectURL === "function";
  return {
    id: `attachment_${crypto.randomUUID()}`,
    file,
    status: "idle",
    ...(canPreview ? { previewUrl: URL.createObjectURL(file) } : {}),
  };
}
