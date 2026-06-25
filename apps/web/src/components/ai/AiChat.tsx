import { CaretRightIcon, CheckCircleIcon, PlusIcon, SparkleIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useChat } from "@ai-sdk/react";
import { Button, Textarea } from "@shared-ledger/ui";
import { DefaultChatTransport } from "ai";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { ImportAttachmentCards, type ImportAttachmentView } from "../imports/ImportAttachmentCards";
import {
  cancelImportJob,
  maximumAttachmentFiles,
  retryImportJob,
  supportedImportAccept,
  uploadImportFiles,
} from "../../features/imports/upload";
import { isOcrAttachment, isSupportedAttachment, supportedFileDescription } from "../../features/imports/files";
import { watchImportJobs } from "../../features/imports/status";
import { API } from "../../lib";

type AttachmentRequestStatus = "asking" | "uploading" | "processing" | "completed" | "failed" | "ignored";

type AttachmentRequest = {
  id: string;
  text: string;
  attachments: ImportAttachmentView[];
  status: AttachmentRequestStatus;
  errorMessage?: string;
};

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
  const [attachmentRequests, setAttachmentRequests] = useState<AttachmentRequest[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
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
  const pendingAttachmentRequest = useMemo(
    () => [...attachmentRequests].reverse().find((request) => request.status === "asking"),
    [attachmentRequests],
  );

  useEffect(() => {
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) previewUrlsRef.current.add(attachment.previewUrl);
    });
  }, [attachments]);

  useEffect(() => {
    attachmentRequests.forEach((request) => {
      request.attachments.forEach((attachment) => {
        if (attachment.previewUrl) previewUrlsRef.current.add(attachment.previewUrl);
      });
    });
  }, [attachmentRequests]);

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
      setAttachmentError(`${unsupported.name} 不是支持的 ${supportedFileDescription} 格式。`);
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
    setAttachmentError("");
    setAttachments(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (attachments.length && !bookId) {
      toast.error("请先选择账本再上传附件", { duration: 3000, closeButton: true });
      return;
    }
    setAttachmentError("");
    setInput("");
    const uploadableAttachments = attachments.filter(
      (attachment) => attachment.status === "idle" || attachment.status === "failed",
    );
    if (uploadableAttachments.length) {
      const request: AttachmentRequest = {
        id: `attachment_request_${crypto.randomUUID()}`,
        text,
        attachments: uploadableAttachments,
        status: "asking",
      };
      setAttachmentRequests((current) => [...current, request]);
      setAttachments([]);
      const shouldSaveAttachments = hasAttachmentSaveIntent(text);
      if (shouldSaveAttachments) {
        await uploadAttachmentRequest(request.id, uploadableAttachments);
      }
      return;
    }
    if (pendingAttachmentRequest && hasAttachmentSaveIntent(text)) {
      await uploadAttachmentRequest(pendingAttachmentRequest.id, pendingAttachmentRequest.attachments);
      return;
    }
    if (pendingAttachmentRequest && hasAttachmentDismissIntent(text)) {
      setAttachmentRequests((current) =>
        current.map((request) =>
          request.id === pendingAttachmentRequest.id ? { ...request, status: "ignored" } : request,
        ),
      );
      return;
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

  const removeRequestAttachment = (requestId: string, attachmentId: string) => {
    setAttachmentRequests((current) =>
      current.map((request) => {
        if (request.id !== requestId || request.status !== "asking") return request;
        const removed = request.attachments.find((attachment) => attachment.id === attachmentId);
        if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
        const nextAttachments = request.attachments.filter((attachment) => attachment.id !== attachmentId);
        return {
          ...request,
          attachments: nextAttachments,
          status: nextAttachments.length ? request.status : "ignored",
        };
      }),
    );
  };

  const discardRequestAttachment = (requestId: string, attachmentId: string) => {
    setAttachmentRequests((current) =>
      current.map((request) => {
        if (request.id !== requestId) return request;
        const removed = request.attachments.find((attachment) => attachment.id === attachmentId);
        if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
        const nextAttachments = request.attachments.filter((attachment) => attachment.id !== attachmentId);
        return {
          ...request,
          attachments: nextAttachments,
          status: nextAttachments.length ? request.status : "ignored",
        };
      }),
    );
  };

  const cancelRequestAttachment = async (requestId: string, attachmentId: string) => {
    const request = attachmentRequests.find((item) => item.id === requestId);
    const attachment = request?.attachments.find((item) => item.id === attachmentId);
    if (!attachment?.jobId) return;
    try {
      await cancelImportJob(attachment.jobId);
      discardRequestAttachment(requestId, attachmentId);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "取消导入失败", { duration: 3000, closeButton: true });
      throw cause;
    }
  };

  const uploadAttachmentRequest = async (requestId: string, targetAttachments: ImportAttachmentView[]) => {
    if (!bookId) {
      toast.error("请先选择账本再上传附件", { duration: 3000, closeButton: true });
      return;
    }
    const uploadIds = new Set(targetAttachments.map((attachment) => attachment.id));
    try {
      setUploading(true);
      setAttachmentRequests((current) =>
        current.map((request) =>
          request.id === requestId
            ? {
                ...request,
                status: "uploading",
                attachments: request.attachments.map((attachment) =>
                  uploadIds.has(attachment.id) ? { ...attachment, status: "uploading" } : attachment,
                ),
              }
            : request,
        ),
      );
      const { jobs } = await uploadImportFiles(
        bookId,
        targetAttachments.map((attachment) => attachment.file),
      );
      const jobToAttachment = new Map<string, string>();
      jobs.forEach((job, index) => {
        const attachment = targetAttachments[index];
        if (attachment) jobToAttachment.set(job.id, attachment.id);
      });
      setAttachmentRequests((current) =>
        current.map((request) =>
          request.id === requestId
            ? {
                ...request,
                status: "processing",
                attachments: request.attachments.map((attachment) => {
                  const job = jobs.find((item) => jobToAttachment.get(item.id) === attachment.id);
                  return job
                    ? {
                        ...attachment,
                        status: "processing",
                        jobId: job.id,
                        progress: job.progress,
                        stage: job.stage,
                        currentPage: job.currentPage,
                        totalPages: job.totalPages,
                        retryable: job.retryable,
                        cancelable: job.cancelable,
                      }
                    : attachment;
                }),
              }
            : request,
        ),
      );
      stopWatchingRef.current?.();
      const ocrJobIds = jobs
        .filter((job, index) => {
          const attachment = targetAttachments[index];
          return Boolean(attachment && isOcrAttachment(attachment.file));
        })
        .map((job) => job.id);
      if (ocrJobIds.length) {
        stopWatchingRef.current = watchImportJobs(
          ocrJobIds,
          (job) => {
            const attachmentId = jobToAttachment.get(job.id);
            if (!attachmentId) return;
            if (job.status === "cancelled") {
              discardRequestAttachment(requestId, attachmentId);
              return;
            }
            setAttachmentRequests((current) =>
              current.map((request) => {
                if (request.id !== requestId) return request;
                const nextStatus: ImportAttachmentView["status"] =
                  job.status === "failed"
                    ? "failed"
                    : job.status === "completed" || job.status === "pending_confirmation"
                      ? "completed"
                      : "processing";
                const nextAttachments = request.attachments.map((attachment) =>
                  attachment.id === attachmentId
                    ? {
                        ...attachment,
                        status: nextStatus,
                        errorMessage: job.errorMessage,
                        retryable: job.retryable,
                        cancelable: job.cancelable,
                        progress: job.progress,
                        stage: job.stage ?? job.status,
                        currentPage: job.currentPage,
                        totalPages: job.totalPages,
                      }
                    : attachment,
                );
                const allFinished = nextAttachments.every(
                  (attachment) => attachment.status === "completed" || attachment.status === "failed",
                );
                const hasFailed = nextAttachments.some((attachment) => attachment.status === "failed");
                return {
                  ...request,
                  attachments: nextAttachments,
                  status: allFinished ? (hasFailed ? "failed" : "completed") : "processing",
                };
              }),
            );
          },
          {
            onError: (message) => toast.warning(message, { duration: 3000, closeButton: true }),
          },
        );
      }
      toast.success(`已提交 ${jobs.length} 个附件，正在 OCR 和 AI 分析`, {
        description: "完成后会进入当前账本的真实导入处理流程。",
        duration: 3000,
        closeButton: true,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "附件上传失败";
      toast.error(message, { duration: 3000, closeButton: true });
      setAttachmentRequests((current) =>
        current.map((request) =>
          request.id === requestId
            ? {
                ...request,
                status: "failed",
                errorMessage: message,
                attachments: request.attachments.map((attachment) =>
                  uploadIds.has(attachment.id) ? { ...attachment, status: "failed", errorMessage: message } : attachment,
                ),
              }
            : request,
        ),
      );
    } finally {
      setUploading(false);
    }
  };

  const retryRequestAttachment = async (requestId: string, attachmentId: string) => {
    const request = attachmentRequests.find((item) => item.id === requestId);
    const attachment = request?.attachments.find((item) => item.id === attachmentId);
    if (!attachment?.jobId) return;
    try {
      const { job } = await retryImportJob(attachment.jobId);
      setAttachmentRequests((current) =>
        current.map((item) =>
          item.id === requestId
            ? {
                ...item,
                status: "processing",
                attachments: item.attachments.map((candidate) =>
                  candidate.id === attachmentId
                    ? {
                        ...candidate,
                        status: "processing",
                        errorMessage: undefined,
                        retryable: job.retryable,
                        cancelable: job.cancelable,
                        progress: job.progress,
                        stage: job.stage,
                        currentPage: job.currentPage,
                        totalPages: job.totalPages,
                      }
                    : candidate,
                ),
              }
            : item,
        ),
      );
      stopWatchingRef.current?.();
      stopWatchingRef.current = watchImportJobs(
        [attachment.jobId],
        (next) => {
          if (next.status === "cancelled") {
            discardRequestAttachment(requestId, attachmentId);
            return;
          }
          setAttachmentRequests((current) =>
            current.map((item) => {
              if (item.id !== requestId) return item;
              const nextStatus: ImportAttachmentView["status"] =
                next.status === "failed"
                  ? "failed"
                  : next.status === "completed" || next.status === "pending_confirmation"
                    ? "completed"
                    : "processing";
              const nextAttachments = item.attachments.map((candidate) =>
                candidate.id === attachmentId
                  ? {
                      ...candidate,
                      status: nextStatus,
                      errorMessage: next.errorMessage,
                      retryable: next.retryable,
                      cancelable: next.cancelable,
                      progress: next.progress,
                      stage: next.stage ?? next.status,
                      currentPage: next.currentPage,
                      totalPages: next.totalPages,
                    }
                  : candidate,
              );
              const allFinished = nextAttachments.every(
                (candidate) => candidate.status === "completed" || candidate.status === "failed",
              );
              const hasFailed = nextAttachments.some((candidate) => candidate.status === "failed");
              return {
                ...item,
                attachments: nextAttachments,
                status: allFinished ? (hasFailed ? "failed" : "completed") : "processing",
              };
            }),
          );
        },
        { onError: (message) => toast.warning(message, { duration: 3000, closeButton: true }) },
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "重试导入失败", { duration: 3000, closeButton: true });
      throw cause;
    }
  };

  const renderMessageText = (message: (typeof messages)[number]) =>
    message.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");

  const hasConversation = messages.length > 0 || attachmentRequests.length > 0;

  return (
    <div className={compact ? "ai-content" : "ai-page"}>
      {!hasConversation ? (
        <div className="ai-empty">
          <SparkleIcon size={33} weight="fill" />
          <h2>你好，我是你的 AI 助手 👋</h2>
          <p>我可以帮你记录、查询、分析你的收支，也能处理文件和邀请成员。</p>
          <div className="ai-suggestions" aria-label="你可以试试">
            <button type="button" onClick={() => setInput("记录昨天午饭 38")}>
              记录昨天午饭 38
            </button>
            <button type="button" onClick={() => setInput("今年大于100的支出")}>
              今年大于100的支出
            </button>
            <button type="button" onClick={() => setInput("邀请成员")}>
              邀请成员
            </button>
          </div>
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
          {attachmentRequests.map((request) => (
            <section className="ai-attachment-thread" key={request.id} aria-label="附件保存确认">
              <article className="ai-message ai-user">
                <p>{request.text || `上传${request.attachments.length > 1 ? "这些" : "这个"}文件`}</p>
              </article>
              <article className="ai-message ai-assistant">
                <p>{attachmentAssistantText(request)}</p>
                <div className="ai-result-card">
                  <ImportAttachmentCards
                    attachments={request.attachments}
                    onRemove={
                      request.status === "asking"
                        ? (id) => removeRequestAttachment(request.id, id)
                        : undefined
                    }
                    onCancel={
                      request.status === "processing"
                        ? (id) => cancelRequestAttachment(request.id, id)
                        : undefined
                    }
                    onRetry={(id) => retryRequestAttachment(request.id, id)}
                  />
                  {request.status === "asking" && (
                    <div className="ai-confirm-actions">
                      <Button type="button" size="sm" onClick={() => uploadAttachmentRequest(request.id, request.attachments)}>
                        保存并识别
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setAttachmentRequests((current) =>
                            current.map((item) => (item.id === request.id ? { ...item, status: "ignored" } : item)),
                          )
                        }
                      >
                        忽略
                      </Button>
                    </div>
                  )}
                  {request.status === "completed" && (
                    <p className="ai-status success">
                      <CheckCircleIcon size={18} weight="fill" />
                      文件已进入真实导入流程，可在待确认记录中继续处理。
                    </p>
                  )}
                  {request.status === "failed" && (
                    <p className="ai-status failed">
                      <WarningCircleIcon size={18} weight="fill" />
                      {request.errorMessage ?? "附件上传或处理失败，请重试。"}
                    </p>
                  )}
                  {request.status === "ignored" && <p className="ai-status">已忽略这些附件，未保存到当前账本。</p>}
                </div>
              </article>
            </section>
          ))}
        </div>
      )}
      <form className={`ai-composer ${composerExpanded ? "expanded" : ""}`} onSubmit={submit}>
        <ImportAttachmentCards attachments={attachments} onRemove={(id) => clearAttachments([id])} />
        {attachmentError && <p className="ai-composer-notice">{attachmentError}</p>}
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
          placeholder="输入消息..."
          disabled={busy}
          rows={1}
        />
        {status === "streaming" || status === "submitted" ? (
          <Button className="ai-composer-send" type="button" size="icon" aria-label="停止" onClick={stop}>
            <XIcon />
          </Button>
        ) : (
          <Button className="ai-composer-send" aria-label="发送" size="icon" disabled={isUploading || (!input.trim() && attachments.length === 0)}>
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

function hasAttachmentDismissIntent(text: string) {
  return /忽略|不用|不要|取消|不保存/.test(text);
}

function attachmentAssistantText(request: AttachmentRequest) {
  if (request.status === "uploading") return "正在上传到当前账本的导入流程。";
  if (request.status === "processing") return "文件已提交，正在等待真实处理状态。";
  if (request.status === "completed") return "处理任务已创建并返回完成状态。";
  if (request.status === "failed") return "附件没有保存成功。";
  if (request.status === "ignored") return "好的，我不会保存这些附件。";
  return `我已收到 ${request.attachments.length} 个文件。需要保存到当前账本吗？`;
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
