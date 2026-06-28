import { ArrowDownIcon, ListNumbersIcon, SparkleIcon } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ImportAttachmentView } from "../imports/ImportAttachmentCards";
import {
  AiAnalysisCard,
  AiConfirmation,
  AiConversation,
  AiImportJobCard,
  AiInviteCard,
  AiMarkdownText,
  AiMemberCard,
  AiMessage,
  AiNavigationCard,
  AiPendingConfirmationBar,
  AiProfileCard,
  AiPromptInput,
  AiRecordCard,
  AiSearchResultCard,
  AiThinkingMessage,
  AiToolStatus,
} from "./AiElements";
import { maximumAttachmentFiles, supportedImportAccept } from "../../features/imports/upload";
import { isSupportedAttachment, supportedFileDescription } from "../../features/imports/files";
import { normalizeAiPart, type AiRenderableMessage, type AiStructuredPart } from "../../features/ai/types";
import { api, apiFetchWithRefresh } from "../../lib";
import { invalidateLedgerData } from "../../features/data/invalidations";

type AiChatResponse = {
  sessionId?: string;
  message?: AiRenderableMessage;
  parts?: unknown[];
};

type AiSessionResponse = {
  session: {
    id: string;
    title: string;
    bookId?: string;
    messages?: Array<{
      id: string;
      role: "user" | "assistant" | "system" | "tool";
      content: string;
      parts?: string | unknown[];
      attachments?: string | unknown[];
      createdAt?: string;
    }>;
  };
};

type AiSessionMessage = NonNullable<AiSessionResponse["session"]["messages"]>[number];

type PendingAiConfirmation = {
  confirmationId: string;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  expiresAt: number;
  busy?: boolean;
};

const confirmationTimeoutMs = 10 * 60_000;

export function AiChat({
  bookId,
  page,
  compact = false,
  sessionId,
  clearSignal = 0,
  onSessionActivity,
}: {
  bookId?: string;
  page: string;
  compact?: boolean;
  sessionId?: string;
  clearSignal?: number;
  onSessionActivity?: (detail: { title?: string; hasMessages?: boolean }) => void;
}) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ImportAttachmentView[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [messages, setMessages] = useState<AiRenderableMessage[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);
  const [isStreaming, setStreaming] = useState(false);
  const [thinkingAssistantId, setThinkingAssistantId] = useState<string | undefined>();
  const [aiError, setAiError] = useState("");
  const [pendingAiConfirmation, setPendingAiConfirmation] = useState<PendingAiConfirmation | undefined>();
  const [autoScroll, setAutoScroll] = useState(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [indexVisible, setIndexVisible] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const indexHideTimerRef = useRef<number | undefined>(undefined);
  const userScrollIntentRef = useRef(false);
  const previewUrlsRef = useRef(new Set<string>());
  const busy = isStreaming || loadingSession;

  const userMessageIndex = useMemo(
    () =>
      messages
        .filter((message) => message.role === "user")
        .map((message, index) => ({
          id: message.id,
          label: userMessageLabel(message) || `第 ${index + 1} 条消息`,
        })),
    [messages],
  );

  useEffect(() => {
    if (!sessionId) return;
    abortControllerRef.current?.abort();
    setInput("");
    setAttachments([]);
    setAttachmentError("");
    setAiError("");
    setPendingAiConfirmation(undefined);
    setThinkingAssistantId(undefined);
    setIndexOpen(false);
    setIndexVisible(false);
    userScrollIntentRef.current = false;
    setAutoScroll(true);
    setShowJumpToBottom(false);
    setLoadingSession(true);
    api<AiSessionResponse>(`/ai/sessions/${sessionId}`)
      .then((result) => {
        setMessages((result.session.messages ?? []).map(serverMessageToRenderable));
        onSessionActivity?.({ title: result.session.title, hasMessages: Boolean(result.session.messages?.length) });
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : "读取 AI 会话失败";
        setAiError(message);
        toast.error(message, { duration: 3000, closeButton: true });
      })
      .finally(() => setLoadingSession(false));
  }, [onSessionActivity, sessionId]);

  useEffect(() => {
    if (!sessionId || clearSignal <= 0) return;
    setMessages([]);
    setPendingAiConfirmation(undefined);
    setAiError("");
    setThinkingAssistantId(undefined);
    onSessionActivity?.({ title: "新会话", hasMessages: false });
  }, [clearSignal, onSessionActivity, sessionId]);

  useEffect(() => {
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) previewUrlsRef.current.add(attachment.previewUrl);
    });
  }, [attachments]);

  useEffect(() => () => {
    abortControllerRef.current?.abort();
    if (indexHideTimerRef.current) window.clearTimeout(indexHideTimerRef.current);
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || loadingSession) return;
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [loadingSession, sessionId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight || "22");
    const maximumHeight = lineHeight * 5;
    const nextHeight = Math.min(textarea.scrollHeight, maximumHeight);
    textarea.style.height = input || attachments.length ? `${nextHeight}px` : "";
    textarea.style.overflowY = textarea.scrollHeight > maximumHeight ? "auto" : "hidden";
  }, [input, attachments.length]);

  useEffect(() => {
    if (!autoScroll) return;
    scrollMessagesToBottom("auto");
  }, [autoScroll, messages, thinkingAssistantId]);

  const handleMessagesScroll = () => {
    const container = messagesRef.current;
    if (!container) return;
    if (userScrollIntentRef.current) revealMessageIndex();
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceToBottom < 72;
    setAutoScroll(nearBottom);
    setShowJumpToBottom(!nearBottom);
  };

  const handleUserScrollIntent = () => {
    userScrollIntentRef.current = true;
    revealMessageIndex();
  };

  const revealMessageIndex = () => {
    if (!userMessageIndex.length) return;
    setIndexVisible(true);
    if (indexHideTimerRef.current) window.clearTimeout(indexHideTimerRef.current);
    indexHideTimerRef.current = window.setTimeout(() => {
      userScrollIntentRef.current = false;
      setIndexOpen(false);
      setIndexVisible(false);
    }, 3000);
  };

  const scrollMessagesToBottom = (behavior: ScrollBehavior = "smooth") => {
    const container = messagesRef.current;
    if (!container) return;
    scrollContainerTo(container, container.scrollHeight, behavior);
    setAutoScroll(true);
    setShowJumpToBottom(false);
  };

  const scrollToMessage = (messageId: string) => {
    const container = messagesRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-ai-message-id="${messageId}"]`);
    if (!container || !target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = targetRect.top - containerRect.top + container.scrollTop - 14;
    setAutoScroll(false);
    setShowJumpToBottom(true);
    scrollContainerTo(container, Math.max(0, top), "smooth");
    setIndexOpen(false);
  };

  const addAttachments = (files: FileList | null) => {
    if (!files?.length) return;
    const incoming = Array.from(files);
    const unsupported = incoming.find((file) => !isSupportedAttachment(file));
    if (unsupported) {
      const message = `${unsupported.name} 不是支持的 ${supportedFileDescription} 格式。`;
      setAttachmentError(message);
      toast.error("附件格式暂不支持", { description: message, duration: 3000, closeButton: true });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const next = [...attachments, ...incoming.map(createAttachment)].slice(0, maximumAttachmentFiles);
    if (attachments.length + incoming.length > maximumAttachmentFiles) {
      toast.warning(`一次最多添加 ${maximumAttachmentFiles} 个附件`, { duration: 3000, closeButton: true });
    }
    setAttachmentError("");
    setAttachments(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessionId) return;
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    setInput("");
    setAiError("");
    const outgoingAttachments = attachments;
    setAttachments([]);
    const userMessage: AiRenderableMessage = {
      id: `ai_user_${crypto.randomUUID()}`,
      role: "user",
      parts: [{ type: "text", text: text || `上传 ${outgoingAttachments.length} 个附件` }],
    };
    const assistantId = `ai_assistant_${crypto.randomUUID()}`;
    setMessages((current) => [...current, userMessage]);
    setThinkingAssistantId(assistantId);
    try {
      setStreaming(true);
      const result = await requestAiStream(sessionId, {
        message: text,
        bookId,
        page,
        timeZone: getClientTimeZone(),
        attachments: outgoingAttachments.map((attachment) => attachment.file),
        onDelta: (delta) => {
          setThinkingAssistantId(undefined);
          setMessages((current) => appendAssistantDelta(current, assistantId, delta));
        },
      });
      const assistantMessage = assistantMessageFromResponse(result, assistantId);
      setThinkingAssistantId(undefined);
      setMessages((current) => {
        if (hasRenderableMessageContent(assistantMessage)) return upsertAssistantMessage(current, assistantMessage);
        const hasStreamedAssistant = current.some((message) => message.id === assistantId);
        return hasStreamedAssistant ? current : removeEmptyAssistant(current, assistantId);
      });
      const pending = findPendingAiConfirmation(responseParts(result));
      setPendingAiConfirmation(pending);
      onSessionActivity?.({ title: aiSessionTitle([...messages, userMessage]), hasMessages: true });
      if (bookId) invalidateLedgerData({ bookId, scopes: ["all"] });
    } catch (cause) {
      setThinkingAssistantId(undefined);
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setMessages((current) => removeEmptyAssistant(current, assistantId));
        return;
      }
      const message = cause instanceof Error ? cause.message : "AI 助手暂时不可用";
      setAiError(message);
      setMessages((current) => removeEmptyAssistant(current, assistantId));
      toast.error(message, { duration: 3000, closeButton: true });
    } finally {
      setStreaming(false);
      setThinkingAssistantId(undefined);
      abortControllerRef.current = undefined;
      outgoingAttachments.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
    }
  };

  const requestAiStream = async (
    targetSessionId: string,
    input: {
      message: string;
      bookId?: string;
      page: string;
      timeZone: string;
      attachments: File[];
      onDelta: (delta: string) => void;
    },
  ) => {
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const body = new FormData();
    body.set("message", input.message);
    body.set("page", input.page);
    body.set("timeZone", input.timeZone);
    if (input.bookId) body.set("bookId", input.bookId);
    input.attachments.forEach((file) => body.append("files", file, file.name));
    const response = await apiFetchWithRefresh(`/ai/sessions/${targetSessionId}/messages/stream`, {
      method: "POST",
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "AI 助手暂时不可用" }));
      throw new Error(String(payload.error ?? "AI 助手暂时不可用"));
    }
    if (!response.body) throw new Error("AI 响应为空");
    return readAiEventStream(response.body, { signal: controller.signal, onDelta: input.onDelta });
  };

  const stopStreamingResponse = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = undefined;
    setThinkingAssistantId(undefined);
    setStreaming(false);
  };

  const confirmPendingAiAction = async () => {
    const pending = pendingAiConfirmation;
    if (!pending) return;
    try {
      setPendingAiConfirmation({ ...pending, busy: true });
      const result = await api<AiChatResponse>(`/ai/confirmations/${pending.confirmationId}/confirm`, { method: "POST" });
      setPendingAiConfirmation(undefined);
      const parts = responseParts(result);
      if (parts.length) setMessages((current) => [...current, assistantMessageFromResponse(result, `ai_confirmed_${crypto.randomUUID()}`)]);
      if (bookId) invalidateLedgerData({ bookId, scopes: ["all"] });
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

  const hasConversation = messages.length > 0;

  return (
    <div className={compact ? "ai-content" : "ai-page"}>
      {userMessageIndex.length > 0 && (
        <div className={`ai-message-index ${indexVisible || indexOpen ? "visible" : ""}`}>
          <button type="button" aria-label="打开会话目录" onClick={() => setIndexOpen((value) => !value)}>
            <ListNumbersIcon size={18} weight="bold" />
          </button>
          {indexOpen && (
            <div className="ai-message-index-panel" role="menu" aria-label="当前会话目录">
              <strong>当前会话</strong>
              {userMessageIndex.map((item, index) => (
                <button type="button" role="menuitem" onClick={() => scrollToMessage(item.id)} key={item.id}>
                  <span>{index + 1}</span>
                  <b>{item.label}</b>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {!hasConversation ? (
        <div className="ai-empty">
          <SparkleIcon size={33} weight="fill" />
          <h2>你好，我是你的 AI 助手 👋</h2>
          <p>你可以随便聊，也可以让我操作账本、资料、成员、分类或文件。</p>
        </div>
      ) : (
        <AiConversation ref={messagesRef} onScroll={handleMessagesScroll} onUserScrollIntent={handleUserScrollIntent}>
          {messages.map((message, index) => (
            <RenderedAiMessage key={message.id} message={message} streaming={isStreaming && index === messages.length - 1} />
          ))}
          {thinkingAssistantId ? <AiThinkingMessage /> : null}
        </AiConversation>
      )}
      {showJumpToBottom && (
        <button className="ai-scroll-bottom-button icon-only" type="button" aria-label="回到底部" onClick={() => scrollMessagesToBottom()}>
          <ArrowDownIcon size={18} weight="bold" />
        </button>
      )}
      {pendingAiConfirmation && (
        <AiPendingConfirmationBar
          title={pendingAiConfirmation.title}
          description={pendingAiConfirmation.description}
          confirmLabel={pendingAiConfirmation.confirmLabel}
          cancelLabel={pendingAiConfirmation.cancelLabel}
          expiresAt={pendingAiConfirmation.expiresAt}
          progressDurationMs={confirmationTimeoutMs}
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
        isStreaming={isStreaming}
        onAddAttachments={addAttachments}
        onClearAttachment={(id) => clearAttachments([id])}
        onInputChange={setInput}
        onStop={stopStreamingResponse}
        onSubmit={submit}
      />
      {aiError && <p className="field-error">{aiError}</p>}
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
      <AiMessage role="user" messageId={message.id}>
        <p>{text}</p>
      </AiMessage>
    );
  }

  return (
    <AiMessage role="assistant" messageId={message.id}>
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
    case "profile-card":
      return <AiProfileCard part={part} />;
    case "member-card":
      return <AiMemberCard part={part} />;
    case "navigation-card":
      return <AiNavigationCard part={part} />;
    case "confirmation":
      return <AiConfirmation part={part} />;
    default:
      return null;
  }
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

function serverMessageToRenderable(message: AiSessionMessage): AiRenderableMessage {
  const parts = parseJsonArray(message.parts) ?? [{ type: "text", text: message.content }];
  return { id: message.id, role: message.role, parts };
}

function assistantMessageFromResponse(result: AiChatResponse, id?: string): AiRenderableMessage {
  return (
    result.message ?? {
      id: id ?? `ai_assistant_${crypto.randomUUID()}`,
      role: "assistant",
      parts: result.parts ?? [],
    }
  );
}

function responseParts(result: AiChatResponse) {
  return result.message?.parts ?? result.parts ?? [];
}

function appendAssistantDelta(messages: AiRenderableMessage[], messageId: string, delta: string): AiRenderableMessage[] {
  let found = false;
  const next = messages.map((message) => {
    if (message.id !== messageId) return message;
    found = true;
    const parts = [...(message.parts ?? [])];
    const first = normalizeAiPart(parts[0]);
    if (first?.type === "text") parts[0] = { type: "text", text: `${first.text}${delta}` };
    else parts.unshift({ type: "text", text: delta });
    return { ...message, parts };
  });
  if (found) return next;
  return [...messages, { id: messageId, role: "assistant", parts: [{ type: "text", text: delta }] }];
}

function upsertAssistantMessage(messages: AiRenderableMessage[], assistantMessage: AiRenderableMessage): AiRenderableMessage[] {
  let found = false;
  const next = messages.map((message) => {
    if (message.id !== assistantMessage.id) return message;
    found = true;
    return assistantMessage;
  });
  return found ? next : [...messages, assistantMessage];
}

function hasRenderableMessageContent(message: AiRenderableMessage) {
  return (message.parts ?? [])
    .map((part) => normalizeAiPart(part))
    .some((part) => {
      if (!part) return false;
      if (part.type !== "text") return true;
      return part.text.trim().length > 0;
    });
}

function removeEmptyAssistant(messages: AiRenderableMessage[], messageId: string) {
  return messages.filter((message) => {
    if (message.id !== messageId) return true;
    const text = userMessageLabel(message);
    return Boolean(text);
  });
}

async function readAiEventStream(
  stream: ReadableStream<Uint8Array>,
  handlers: { signal: AbortSignal; onDelta: (text: string) => void },
): Promise<AiChatResponse> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let donePayload: AiChatResponse | undefined;
  while (!handlers.signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseSseEvent(raw);
      if (event?.name === "message_delta") handlers.onDelta(String(event.data.text ?? ""));
      if (event?.name === "done") donePayload = event.data as AiChatResponse;
      if (event?.name === "error") throw new Error(String(event.data.message ?? "AI 助手暂时不可用"));
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (handlers.signal.aborted) throw new DOMException("Aborted", "AbortError");
  return donePayload ?? { parts: [] };
}

function parseSseEvent(raw: string): { name: string; data: Record<string, unknown> } | undefined {
  const lines = raw.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  if (!eventLine || !dataLines.length) return undefined;
  try {
    return {
      name: eventLine.slice(6).trim(),
      data: JSON.parse(dataLines.map((line) => line.slice(5).trim()).join("\n")) as Record<string, unknown>,
    };
  } catch {
    return undefined;
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
    expiresAt: Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : Date.now() + confirmationTimeoutMs,
  };
}

function userMessageLabel(message: AiRenderableMessage) {
  return (message.parts ?? [])
    .map((part) => normalizeAiPart(part))
    .filter((part): part is Extract<AiStructuredPart, { type: "text" }> => Boolean(part && part.type === "text"))
    .map((part) => part.text)
    .join(" ")
    .trim();
}

function aiSessionTitle(messages: AiRenderableMessage[]) {
  const firstUserText = messages.find((message) => message.role === "user") ? userMessageLabel(messages.find((message) => message.role === "user")!) : "";
  if (!firstUserText) return messages.length ? "AI 会话" : "新会话";
  return firstUserText.length > 18 ? `${firstUserText.slice(0, 18)}…` : firstUserText;
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function getClientTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
}

function scrollContainerTo(container: HTMLElement, top: number, behavior: ScrollBehavior) {
  if (typeof container.scrollTo === "function") {
    container.scrollTo({ top, behavior });
    return;
  }
  container.scrollTop = top;
}
