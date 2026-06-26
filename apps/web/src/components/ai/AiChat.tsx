import { CheckCircleIcon, SparkleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ImportAttachmentCards, type ImportAttachmentView } from "../imports/ImportAttachmentCards";
import {
  AiAnalysisCard,
  AiConfirmation,
  AiConversation,
  AiImportJobCard,
  AiInviteCard,
  AiMarkdownText,
  AiMessage,
  AiNavigationCard,
  AiPendingConfirmationBar,
  AiPromptInput,
  AiRecordCard,
  AiSearchResultCard,
  AiToolStatus,
} from "./AiElements";
import {
  cancelImportJob,
  maximumAttachmentFiles,
  retryImportJob,
  supportedImportAccept,
  uploadImportFiles,
} from "../../features/imports/upload";
import { isOcrAttachment, isSupportedAttachment, supportedFileDescription } from "../../features/imports/files";
import { watchImportJobs } from "../../features/imports/status";
import { normalizeAiPart, type AiRenderableMessage, type AiStructuredPart } from "../../features/ai/types";
import { API, api } from "../../lib";

type AttachmentRequestStatus = "asking" | "uploading" | "processing" | "completed" | "failed" | "ignored";

type AttachmentRequest = {
  id: string;
  text: string;
  attachments: ImportAttachmentView[];
  status: AttachmentRequestStatus;
  confirmationExpiresAt?: number;
  errorMessage?: string;
};

type PendingAiConfirmation = {
  confirmationId: string;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  expiresAt: number;
  busy?: boolean;
};

type AiChatResponse = {
  conversationId?: string;
  message?: AiRenderableMessage;
  parts?: unknown[];
  intent?: unknown;
  action?: unknown;
  attachmentIntent?: unknown;
  attachmentAction?: unknown;
  ingestion?: unknown;
  importIntent?: unknown;
};

type AiConfirmationResponse = {
  conversationId?: string;
  message?: AiRenderableMessage;
  parts?: unknown[];
};

type AttachmentDecision = "save" | "ignore" | "confirm";

const attachmentConfirmationMs = 10_000;

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
  const [isAiSending, setAiSending] = useState(false);
  const [aiError, setAiError] = useState("");
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [localMessages, setLocalMessages] = useState<AiRenderableMessage[]>([]);
  const [pendingAiConfirmation, setPendingAiConfirmation] = useState<PendingAiConfirmation | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stopWatchingRef = useRef<(() => void) | undefined>(undefined);
  const previewUrlsRef = useRef(new Set<string>());
  const transport = useMemo(
    () => new DefaultChatTransport({ api: `${API}/ai/chat`, credentials: "include", body: { bookId, page } }),
    [bookId, page],
  );
  const { messages, status, error, stop } = useChat({ transport, experimental_throttle: 50 });
  const renderedMessages = useMemo(
    () => [...(messages as AiRenderableMessage[]), ...localMessages],
    [messages, localMessages],
  );
  const busy = status === "streaming" || status === "submitted" || isUploading || isAiSending;
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
      await resolveAttachmentIntent(request, text);
      return;
    }

    if (pendingAttachmentRequest && text) {
      await resolveAttachmentIntent(pendingAttachmentRequest, text);
      return;
    }
    if (text) await sendStructuredMessage(text);
  };

  const requestAiChat = async (body: Record<string, unknown>) => {
    const result = await api<AiChatResponse>("/ai/chat", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (result.conversationId) setConversationId(result.conversationId);
    return result;
  };

  const sendStructuredMessage = async (text: string) => {
    setAiError("");
    const userMessage: AiRenderableMessage = {
      id: `ai_user_${crypto.randomUUID()}`,
      role: "user",
      parts: [{ type: "text", text }],
    };
    setLocalMessages((current) => [...current, userMessage]);
    try {
      setAiSending(true);
      const result = await requestAiChat({ message: text, bookId, page, conversationId });
      const assistantMessage = assistantMessageFromResponse(result);
      setLocalMessages((current) => [...current, assistantMessage]);
      const pending = findPendingAiConfirmation(responseParts(result));
      if (pending) setPendingAiConfirmation(pending);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "AI 助手暂时不可用";
      setAiError(message);
      setLocalMessages((current) => [
        ...current,
        {
          id: `ai_error_${crypto.randomUUID()}`,
          role: "assistant",
          parts: [{ type: "text", text: message }],
        },
      ]);
      toast.error(message, { duration: 3000, closeButton: true });
    } finally {
      setAiSending(false);
    }
  };

  const resolveAttachmentIntent = async (request: AttachmentRequest, text: string) => {
    setAiError("");
    try {
      setAiSending(true);
      const result = await requestAiChat({
        message: text || "上传附件",
        bookId,
        page,
        conversationId,
        attachmentRequestId: request.id,
        attachments: request.attachments.map(attachmentMetadata),
      });
      const parts = responseParts(result);
      const decision = findAttachmentDecision(result, parts) ?? "confirm";
      if (decision === "save") {
        await uploadAttachmentRequest(request.id, request.attachments);
        return;
      }
      if (decision === "ignore") {
        dismissAttachmentRequest(request.id);
        return;
      }
      setAttachmentRequests((current) =>
        current.map((item) =>
          item.id === request.id
            ? { ...item, confirmationExpiresAt: Date.now() + attachmentConfirmationMs }
            : item,
        ),
      );
      const pending = findPendingAiConfirmation(parts);
      if (pending) setPendingAiConfirmation(pending);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "AI 助手暂时不可用";
      setAiError(message);
      setAttachmentRequests((current) =>
        current.map((item) =>
          item.id === request.id
            ? { ...item, confirmationExpiresAt: Date.now() + attachmentConfirmationMs }
            : item,
        ),
      );
      toast.error(message, { duration: 3000, closeButton: true });
    } finally {
      setAiSending(false);
    }
  };

  const confirmPendingAiAction = async () => {
    const pending = pendingAiConfirmation;
    if (!pending) return;
    try {
      setPendingAiConfirmation({ ...pending, busy: true });
      const result = await api<AiConfirmationResponse>(`/ai/confirmations/${pending.confirmationId}/confirm`, {
        method: "POST",
      });
      setPendingAiConfirmation(undefined);
      if (result.conversationId) setConversationId(result.conversationId);
      const parts = responseParts(result);
      if (parts.length) setLocalMessages((current) => [...current, assistantMessageFromResponse(result, "ai_confirmed")]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "确认操作失败";
      setPendingAiConfirmation({ ...pending, busy: false });
      toast.error(message, { duration: 3000, closeButton: true });
    }
  };

  const cancelPendingAiAction = async () => {
    const pending = pendingAiConfirmation;
    if (!pending) return;
    setPendingAiConfirmation(undefined);
    try {
      await api(`/ai/confirmations/${pending.confirmationId}/cancel`, { method: "POST" });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "取消确认失败", { duration: 3000, closeButton: true });
    }
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

  const dismissAttachmentRequest = (requestId: string) => {
    setAttachmentRequests((current) => {
      current
        .find((request) => request.id === requestId)
        ?.attachments.forEach((attachment) => {
          if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
        });
      return current.filter((request) => request.id !== requestId);
    });
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
                confirmationExpiresAt: undefined,
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
          return Boolean(job && attachment && isOcrAttachment(attachment.file));
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
                confirmationExpiresAt: undefined,
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

  const visibleAttachmentRequests = attachmentRequests.filter((request) => request.status !== "asking");
  const hasConversation = renderedMessages.length > 0 || visibleAttachmentRequests.length > 0;

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
        <AiConversation>
          {renderedMessages.map((message, index) => (
            <RenderedAiMessage
              key={message.id}
              message={message as AiRenderableMessage}
              streaming={status === "streaming" && index === renderedMessages.length - 1}
            />
          ))}
          {visibleAttachmentRequests.map((request) => (
            <section className="ai-attachment-thread" key={request.id} aria-label="附件导入状态">
              <AiMessage role="user">
                <p>{request.text || `上传${request.attachments.length > 1 ? "这些" : "这个"}文件`}</p>
              </AiMessage>
              <AiMessage role="assistant">
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
              </AiMessage>
            </section>
          ))}
        </AiConversation>
      )}
      {pendingAttachmentRequest?.confirmationExpiresAt && (
        <AiPendingConfirmationBar
          attachments={pendingAttachmentRequest.attachments}
          expiresAt={pendingAttachmentRequest.confirmationExpiresAt}
          onCancel={() => dismissAttachmentRequest(pendingAttachmentRequest.id)}
          onConfirm={() => void uploadAttachmentRequest(pendingAttachmentRequest.id, pendingAttachmentRequest.attachments)}
        />
      )}
      {!pendingAttachmentRequest && pendingAiConfirmation && (
        <AiPendingConfirmationBar
          title={pendingAiConfirmation.title}
          description={pendingAiConfirmation.description}
          confirmLabel={pendingAiConfirmation.confirmLabel}
          cancelLabel={pendingAiConfirmation.cancelLabel}
          expiresAt={pendingAiConfirmation.expiresAt}
          busy={pendingAiConfirmation.busy}
          onCancel={() => void cancelPendingAiAction()}
          onConfirm={() => void confirmPendingAiAction()}
        />
      )}
      <AiPromptInput
        attachments={attachments}
        attachmentError={attachmentError}
        busy={busy}
        canAttach={attachments.length < maximumAttachmentFiles}
        accept={supportedImportAccept}
        input={input}
        textareaRef={textareaRef}
        fileInputRef={fileInputRef}
        isStreaming={status === "streaming" || status === "submitted"}
        onAddAttachments={addAttachments}
        onClearAttachment={(id) => clearAttachments([id])}
        onInputChange={setInput}
        onStop={stop}
        onSubmit={submit}
      />
      {(error || aiError) && <p className="field-error">{error?.message ?? aiError}</p>}
    </div>
  );
}

function RenderedAiMessage({ message, streaming }: { message: AiRenderableMessage; streaming: boolean }) {
  const role = message.role === "user" ? "user" : "assistant";
  const parts = (message.parts ?? []).map(normalizeAiPart).filter((part): part is AiStructuredPart => Boolean(part));
  const text = parts
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");

  if (role === "user") {
    return (
      <AiMessage role="user">
        <p>{text}</p>
      </AiMessage>
    );
  }

  return (
    <AiMessage role="assistant">
      <div className="ai-part-stack">
        {parts.map((part, index) => (
          <RenderedAiPart key={`${part.type}_${index}`} part={part} streaming={streaming && index === parts.length - 1} />
        ))}
      </div>
    </AiMessage>
  );
}

function RenderedAiPart({ part, streaming }: { part: AiStructuredPart; streaming: boolean }) {
  switch (part.type) {
    case "text":
      return <AiMarkdownText streaming={streaming}>{part.text}</AiMarkdownText>;
    case "tool-status":
      return <AiToolStatus part={part} />;
    case "record-card":
      return <AiRecordCard part={part} />;
    case "search-result-card":
      return <AiSearchResultCard part={part} />;
    case "analysis-card":
      return <AiAnalysisCard part={part} />;
    case "import-job-card":
      return <AiImportJobCard part={part} />;
    case "invite-card":
      return <AiInviteCard part={part} />;
    case "navigation-card":
      return <AiNavigationCard part={part} />;
    case "confirmation":
      return <AiConfirmation part={part} />;
    default:
      return null;
  }
}

function findPendingAiConfirmation(parts: unknown[]): PendingAiConfirmation | undefined {
  const confirmation = parts.map(normalizeAiPart).find(
    (part): part is Extract<AiStructuredPart, { type: "confirmation" }> =>
      Boolean(part && part.type === "confirmation" && part.confirmationId),
  );
  if (!confirmation?.confirmationId) return undefined;
  const parsedExpiresAt = confirmation.expiresAt ? Date.parse(confirmation.expiresAt) : Number.NaN;
  return {
    confirmationId: confirmation.confirmationId,
    title: confirmation.title ?? "需要确认",
    ...(confirmation.message ? { description: confirmation.message } : {}),
    confirmLabel: confirmation.confirmLabel ?? "确认",
    cancelLabel: confirmation.cancelLabel ?? "取消",
    expiresAt: Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : Date.now() + attachmentConfirmationMs,
  };
}

function attachmentAssistantText(request: AttachmentRequest) {
  if (request.status === "uploading") return "正在上传到当前账本的导入流程。";
  if (request.status === "processing") return "文件已提交，正在等待真实处理状态。";
  if (request.status === "completed") return "处理任务已创建并返回完成状态。";
  if (request.status === "failed") return "附件没有保存成功。";
  if (request.status === "ignored") return "好的，我不会保存这些附件。";
  return "";
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

function assistantMessageFromResponse(result: AiChatResponse | AiConfirmationResponse, idPrefix = "ai_assistant"): AiRenderableMessage {
  return (
    result.message ?? {
      id: `${idPrefix}_${crypto.randomUUID()}`,
      role: "assistant",
      parts: result.parts ?? [],
    }
  );
}

function responseParts(result: AiChatResponse | AiConfirmationResponse) {
  return result.message?.parts ?? result.parts ?? [];
}

function attachmentMetadata(attachment: ImportAttachmentView) {
  return {
    id: attachment.id,
    name: attachment.file.name,
    type: attachment.file.type,
    size: attachment.file.size,
    lastModified: attachment.file.lastModified,
  };
}

function findAttachmentDecision(result: AiChatResponse, parts: unknown[]): AttachmentDecision | undefined {
  const topLevel = [
    result.attachmentAction,
    result.attachmentIntent,
    result.ingestion,
    result.importIntent,
    result.intent,
    result.action,
  ];
  for (const candidate of topLevel) {
    const decision = attachmentDecisionFromValue(candidate);
    if (decision) return decision;
  }
  for (const part of parts) {
    const payload = dataPayload(part);
    const type = stringValue(payload?.type)?.replace(/^data-/, "");
    const isAttachmentPart = Boolean(type && /(attachment|file|import|ingestion|upload)/i.test(type));
    if (isAttachmentPart) {
      const decision = attachmentDecisionFromValue(payload);
      if (decision) return decision;
      if (type && /confirm|pending/i.test(type)) return "confirm";
    }
    const confirmation = objectValue(payload?.confirmation);
    const confirmationAction = stringValue(confirmation?.action);
    if (confirmationAction && /(attachment|file|import|ingestion|upload)/i.test(confirmationAction)) {
      return "confirm";
    }
  }
  return undefined;
}

function attachmentDecisionFromValue(value: unknown): AttachmentDecision | undefined {
  const direct = attachmentDecisionFromString(stringValue(value));
  if (direct) return direct;
  const object = objectValue(value);
  if (!object) return undefined;
  if (object.shouldSave === true || object.save === true) return "save";
  if (object.shouldIgnore === true || object.ignore === true) return "ignore";
  if (object.requiresConfirmation === true || object.confirmationRequired === true) return "confirm";
  for (const key of ["action", "decision", "behavior", "intent", "name", "status", "type"]) {
    const decision = attachmentDecisionFromString(stringValue(object[key]));
    if (decision) return decision;
  }
  for (const key of ["attachmentAction", "attachmentIntent", "ingestion", "importIntent"]) {
    const decision = attachmentDecisionFromValue(object[key]);
    if (decision) return decision;
  }
  return undefined;
}

function attachmentDecisionFromString(value?: string): AttachmentDecision | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replaceAll(/[\s_.:]+/g, "-");
  if (!normalized) return undefined;
  if (/(ignore|dismiss|discard|skip|do-not-save|dont-save|cancel-upload|cancel-import)/.test(normalized)) return "ignore";
  if (/(confirm|confirmation|pending-confirmation|ask|require-confirmation|needs-confirmation)/.test(normalized)) return "confirm";
  if (/^(save|upload|ingest|import|start-import|create-import|save-attachments?|upload-attachments?|ingest-attachments?)$/.test(normalized)) {
    return "save";
  }
  if (
    /(save-attachment|upload-attachment|ingest-attachment|import-attachment|save-file|upload-file|import-file)/.test(normalized) ||
    /(attachment-save|attachments-save|file-save|import-save|ingestion-save|save-import)/.test(normalized)
  ) {
    return "save";
  }
  return undefined;
}

function dataPayload(value: unknown): Record<string, unknown> | undefined {
  const object = objectValue(value);
  if (!object) return undefined;
  const data = objectValue(object.data);
  return data ? { ...object, ...data } : object;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length ? value : undefined;
}
