import { type FormEvent, useEffect, useMemo, useReducer, useRef } from "react";
import { toast } from "sonner";
import type { ImportAttachmentView } from "../imports/ImportAttachmentCards";
import { AiPendingConfirmationBar, AiPromptInput } from "./AiElements";
import { AiMessageList, type AiMessageIndexItem } from "./AiMessageList";
import { maximumAttachmentFiles, supportedImportAccept } from "../../features/imports/upload";
import { isSupportedAttachment, unsupportedFileMessage } from "../../features/imports/files";
import { normalizeAiPart, type AiRenderableMessage, type AiStructuredPart } from "../../features/ai/types";
import { useAuth } from "../../features/auth/AuthProvider";
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
type AiChatState = {
  aiError: string;
  attachmentError: string;
  attachments: ImportAttachmentView[];
  indexOpen: boolean;
  indexVisible: boolean;
  input: string;
  isStreaming: boolean;
  loadingSession: boolean;
  messages: AiRenderableMessage[];
  pendingAiConfirmation?: PendingAiConfirmation;
  showJumpToBottom: boolean;
  thinkingAssistantId?: string;
};
type AiChatAction =
  | { type: "input"; value: string }
  | { type: "attachments-added"; attachments: ImportAttachmentView[]; error?: string }
  | { type: "attachments-cleared"; ids: string[] }
  | { type: "attachment-error"; error: string }
  | { type: "session-load-start" }
  | { type: "session-loaded"; messages: AiRenderableMessage[] }
  | { type: "session-load-error"; error: string }
  | { type: "submit-start"; userMessage: AiRenderableMessage; assistantId: string }
  | { type: "assistant-delta"; assistantId: string; delta: string }
  | { type: "stream-finished"; assistantId: string; assistantMessage: AiRenderableMessage; pending?: PendingAiConfirmation }
  | { type: "stream-aborted"; assistantId: string }
  | { type: "stream-error"; assistantId: string; error: string }
  | { type: "stream-stop" }
  | { type: "confirmation-busy"; pending: PendingAiConfirmation }
  | { type: "confirmation-clear" }
  | { type: "confirmation-failed"; pending: PendingAiConfirmation }
  | { type: "confirmation-message"; message: AiRenderableMessage }
  | { type: "jump-visible"; visible: boolean }
  | { type: "index-reveal" }
  | { type: "index-toggle" }
  | { type: "index-hide" };

function initialAiChatState(sessionId?: string): AiChatState {
  return {
    aiError: "",
    attachmentError: "",
    attachments: [],
    indexOpen: false,
    indexVisible: false,
    input: "",
    isStreaming: false,
    loadingSession: Boolean(sessionId),
    messages: [],
    pendingAiConfirmation: undefined,
    showJumpToBottom: false,
    thinkingAssistantId: undefined,
  };
}

function aiChatReducer(state: AiChatState, action: AiChatAction): AiChatState {
  switch (action.type) {
    case "input":
      return { ...state, input: action.value };
    case "attachments-added":
      return { ...state, attachments: action.attachments, attachmentError: action.error ?? "" };
    case "attachments-cleared": {
      const removing = new Set(action.ids);
      return { ...state, attachments: state.attachments.filter((attachment) => !removing.has(attachment.id)) };
    }
    case "attachment-error":
      return { ...state, attachmentError: action.error };
    case "session-load-start":
      return { ...state, loadingSession: true };
    case "session-loaded":
      return { ...state, aiError: "", loadingSession: false, messages: action.messages };
    case "session-load-error":
      return { ...state, aiError: action.error, loadingSession: false };
    case "submit-start":
      return {
        ...state,
        aiError: "",
        attachments: [],
        input: "",
        isStreaming: true,
        messages: [...state.messages, action.userMessage],
        thinkingAssistantId: action.assistantId,
      };
    case "assistant-delta":
      return {
        ...state,
        messages: appendAssistantDelta(state.messages, action.assistantId, action.delta),
        thinkingAssistantId: undefined,
      };
    case "stream-finished": {
      const messages = hasRenderableMessageContent(action.assistantMessage)
        ? finalizeAssistantMessage(state.messages, action.assistantId, action.assistantMessage)
        : state.messages.some((message) => message.id === action.assistantId)
          ? state.messages
          : removeEmptyAssistant(state.messages, action.assistantId);
      return {
        ...state,
        isStreaming: false,
        messages,
        pendingAiConfirmation: action.pending,
        thinkingAssistantId: undefined,
      };
    }
    case "stream-aborted":
      return {
        ...state,
        isStreaming: false,
        messages: removeEmptyAssistant(state.messages, action.assistantId),
        thinkingAssistantId: undefined,
      };
    case "stream-error":
      return {
        ...state,
        aiError: action.error,
        isStreaming: false,
        messages: removeEmptyAssistant(state.messages, action.assistantId),
        thinkingAssistantId: undefined,
      };
    case "stream-stop":
      return { ...state, isStreaming: false, thinkingAssistantId: undefined };
    case "confirmation-busy":
      return { ...state, pendingAiConfirmation: { ...action.pending, busy: true } };
    case "confirmation-clear":
      return { ...state, pendingAiConfirmation: undefined };
    case "confirmation-failed":
      return { ...state, pendingAiConfirmation: { ...action.pending, busy: false } };
    case "confirmation-message":
      return { ...state, messages: [...state.messages, action.message] };
    case "jump-visible":
      return { ...state, showJumpToBottom: action.visible };
    case "index-reveal":
      return { ...state, indexVisible: true };
    case "index-toggle":
      return { ...state, indexOpen: !state.indexOpen };
    case "index-hide":
      return { ...state, indexOpen: false, indexVisible: false };
  }
}

type AiChatProps = {
  bookId?: string;
  page: string;
  compact?: boolean;
  sessionId?: string;
  onSessionActivity?: (detail: { title?: string; hasMessages?: boolean }) => void;
};

function useAiChatController({
  bookId,
  page,
  sessionId,
  onSessionActivity,
}: Omit<AiChatProps, "compact">) {
  const [state, dispatch] = useReducer(aiChatReducer, sessionId, initialAiChatState);
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const indexHideTimerRef = useRef<number | undefined>(undefined);
  const userScrollIntentRef = useRef(false);
  const autoScrollRef = useRef(true);
  const previewUrlsRef = useRef<Set<string> | null>(null);
  if (previewUrlsRef.current === null) previewUrlsRef.current = new Set<string>();
  const {
    aiError,
    attachmentError,
    attachments,
    indexOpen,
    indexVisible,
    input,
    isStreaming,
    loadingSession,
    messages,
    pendingAiConfirmation,
    showJumpToBottom,
    thinkingAssistantId,
  } = state;
  const busy = isStreaming || loadingSession;
  const canUseImageRecognition = user?.plan === "pro";

  const userMessageIndex = useMemo<AiMessageIndexItem[]>(
    () => {
      const index: Array<{ id: string; label: string }> = [];
      for (const message of messages) {
        if (message.role === "user") {
          index.push({
            id: message.id,
            label: userMessageLabel(message) || `第 ${index.length + 1} 条消息`,
          });
        }
      }
      return index;
    },
    [messages],
  );

  useEffect(() => {
    if (!sessionId) return;
    abortControllerRef.current?.abort();
    dispatch({ type: "session-load-start" });
    api<AiSessionResponse>(`/ai/sessions/${sessionId}`)
      .then((result) => {
        dispatch({ type: "session-loaded", messages: (result.session.messages ?? []).map(serverMessageToRenderable) });
        onSessionActivity?.({ title: result.session.title, hasMessages: Boolean(result.session.messages?.length) });
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : "读取 AI 会话失败";
        dispatch({ type: "session-load-error", error: message });
        toast.error(message, { duration: 3000, closeButton: true });
      });
  }, [onSessionActivity, sessionId]);

  useEffect(() => {
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) previewUrlsRef.current?.add(attachment.previewUrl);
    });
  }, [attachments]);

  useEffect(() => () => {
    abortControllerRef.current?.abort();
    if (indexHideTimerRef.current) window.clearTimeout(indexHideTimerRef.current);
    previewUrlsRef.current?.forEach((url) => URL.revokeObjectURL(url));
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
    if (!autoScrollRef.current) return;
    scrollMessagesToBottom("auto");
  }, [messages, thinkingAssistantId]);

  const handleMessagesScroll = () => {
    const container = messagesRef.current;
    if (!container) return;
    if (userScrollIntentRef.current) revealMessageIndex();
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distanceToBottom < 72;
    autoScrollRef.current = nearBottom;
    dispatch({ type: "jump-visible", visible: !nearBottom });
  };

  const handleUserScrollIntent = () => {
    userScrollIntentRef.current = true;
    revealMessageIndex();
  };

  const revealMessageIndex = () => {
    if (!userMessageIndex.length) return;
    dispatch({ type: "index-reveal" });
    if (indexHideTimerRef.current) window.clearTimeout(indexHideTimerRef.current);
    indexHideTimerRef.current = window.setTimeout(() => {
      userScrollIntentRef.current = false;
      dispatch({ type: "index-hide" });
    }, 3000);
  };

  const scrollMessagesToBottom = (behavior: ScrollBehavior = "smooth") => {
    const container = messagesRef.current;
    if (!container) return;
    scrollContainerTo(container, container.scrollHeight, behavior);
    autoScrollRef.current = true;
    dispatch({ type: "jump-visible", visible: false });
  };

  const scrollToMessage = (messageId: string) => {
    const container = messagesRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-ai-message-id="${messageId}"]`);
    if (!container || !target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = targetRect.top - containerRect.top + container.scrollTop - 14;
    autoScrollRef.current = false;
    dispatch({ type: "jump-visible", visible: true });
    scrollContainerTo(container, Math.max(0, top), "smooth");
    dispatch({ type: "index-hide" });
  };

  const addAttachments = (files: FileList | null) => {
    if (!canUseImageRecognition) return;
    if (!files?.length) return;
    const incoming = Array.from(files);
    const unsupported = incoming.find((file) => !isSupportedAttachment(file));
    if (unsupported) {
      const message = unsupportedFileMessage;
      dispatch({ type: "attachment-error", error: message });
      toast.error(message, { description: unsupported.name, duration: 3000, closeButton: true });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const next = [...attachments, ...incoming.map(createAttachment)].slice(0, maximumAttachmentFiles);
    if (attachments.length + incoming.length > maximumAttachmentFiles) {
      toast.warning(`一次最多添加 ${maximumAttachmentFiles} 个附件`, { duration: 3000, closeButton: true });
    }
    dispatch({ type: "attachments-added", attachments: next });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const clearAttachments = (ids: string[]) => {
    const removing = new Set(ids);
    attachments.forEach((attachment) => {
      if (removing.has(attachment.id) && attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    });
    dispatch({ type: "attachments-cleared", ids });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sessionId) return;
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    const outgoingAttachments = attachments;
    const userMessage: AiRenderableMessage = {
      id: `ai_user_${crypto.randomUUID()}`,
      role: "user",
      parts: [{ type: "text", text: text || `上传 ${outgoingAttachments.length} 个附件` }],
    };
    const assistantId = `ai_assistant_${crypto.randomUUID()}`;
    dispatch({ type: "submit-start", userMessage, assistantId });
    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const result = await requestAiStream(sessionId, {
        message: text,
        bookId,
        page,
        signal: controller.signal,
        timeZone: getClientTimeZone(),
        attachments: outgoingAttachments.map((attachment) => attachment.file),
        onDelta: (delta) => {
          dispatch({ type: "assistant-delta", assistantId, delta });
        },
      });
      const assistantMessage = assistantMessageFromResponse(result, assistantId);
      const pending = findPendingAiConfirmation(responseParts(result));
      dispatch({ type: "stream-finished", assistantId, assistantMessage, pending });
      onSessionActivity?.({ title: aiSessionTitle([...messages, userMessage]), hasMessages: true });
      if (bookId) invalidateLedgerData({ bookId, scopes: ["all"] });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        dispatch({ type: "stream-aborted", assistantId });
        return;
      }
      const message = cause instanceof Error ? cause.message : "AI 助手暂时不可用";
      dispatch({ type: "stream-error", assistantId, error: message });
      toast.error(message, { duration: 3000, closeButton: true });
    } finally {
      abortControllerRef.current = undefined;
      outgoingAttachments.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
    }
  };

  const stopStreamingResponse = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = undefined;
    dispatch({ type: "stream-stop" });
  };

  const confirmPendingAiAction = async () => {
    const pending = pendingAiConfirmation;
    if (!pending) return;
    try {
      dispatch({ type: "confirmation-busy", pending });
      const result = await api<AiChatResponse>(`/ai/confirmations/${pending.confirmationId}/confirm`, { method: "POST" });
      dispatch({ type: "confirmation-clear" });
      const parts = responseParts(result);
      if (parts.length) dispatch({ type: "confirmation-message", message: assistantMessageFromResponse(result, `ai_confirmed_${crypto.randomUUID()}`) });
      if (bookId) invalidateLedgerData({ bookId, scopes: ["all"] });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "确认操作失败";
      dispatch({ type: "confirmation-failed", pending });
      toast.error(message, { duration: 3000, closeButton: true });
    }
  };

  const cancelPendingAiAction = async () => {
    const pending = pendingAiConfirmation;
    if (!pending) return;
    dispatch({ type: "confirmation-clear" });
    try {
      await api(`/ai/confirmations/${pending.confirmationId}/cancel`, { method: "POST" });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "取消确认失败", { duration: 3000, closeButton: true });
    }
  };

  return {
    addAttachments,
    aiError,
    attachmentError,
    attachments,
    busy,
    cancelPendingAiAction,
    canUseImageRecognition,
    clearAttachments,
    confirmPendingAiAction,
    fileInputRef,
    handleMessagesScroll,
    handleUserScrollIntent,
    indexOpen,
    indexVisible,
    input,
    isStreaming,
    messages,
    messagesRef,
    pendingAiConfirmation,
    scrollMessagesToBottom,
    scrollToMessage,
    setInput: (value: string) => dispatch({ type: "input", value }),
    showJumpToBottom,
    stopStreamingResponse,
    submit,
    textareaRef,
    thinkingAssistantId,
    toggleIndex: () => dispatch({ type: "index-toggle" }),
    userMessageIndex,
  };
}

export function AiChat({ compact = false, ...controllerProps }: AiChatProps) {
  const controller = useAiChatController(controllerProps);
  return (
    <div className={compact ? "ai-content" : "ai-page"}>
      <AiMessageList
        indexOpen={controller.indexOpen}
        indexVisible={controller.indexVisible}
        isStreaming={controller.isStreaming}
        messages={controller.messages}
        messagesRef={controller.messagesRef}
        onMessagesScroll={controller.handleMessagesScroll}
        onScrollBottom={() => controller.scrollMessagesToBottom()}
        onScrollToMessage={controller.scrollToMessage}
        onToggleIndex={controller.toggleIndex}
        onUserScrollIntent={controller.handleUserScrollIntent}
        showJumpToBottom={controller.showJumpToBottom}
        thinkingAssistantId={controller.thinkingAssistantId}
        userMessageIndex={controller.userMessageIndex}
      />
      {controller.pendingAiConfirmation && (
        <AiPendingConfirmationBar
          title={controller.pendingAiConfirmation.title}
          description={controller.pendingAiConfirmation.description}
          confirmLabel={controller.pendingAiConfirmation.confirmLabel}
          cancelLabel={controller.pendingAiConfirmation.cancelLabel}
          expiresAt={controller.pendingAiConfirmation.expiresAt}
          progressDurationMs={confirmationTimeoutMs}
          busy={controller.pendingAiConfirmation.busy}
          onCancel={() => void controller.cancelPendingAiAction()}
          onConfirm={() => void controller.confirmPendingAiAction()}
        />
      )}
      <AiPromptInput
        attachments={controller.attachments}
        attachmentError={controller.attachmentError}
        busy={controller.busy}
        canAttach={controller.attachments.length < maximumAttachmentFiles}
        showAttachmentButton={controller.canUseImageRecognition}
        accept={supportedImportAccept}
        input={controller.input}
        textareaRef={controller.textareaRef}
        fileInputRef={controller.fileInputRef}
        isStreaming={controller.isStreaming}
        onAddAttachments={controller.addAttachments}
        onClearAttachment={(id) => controller.clearAttachments([id])}
        onInputChange={controller.setInput}
        onStop={controller.stopStreamingResponse}
        onSubmit={controller.submit}
      />
      {controller.aiError && <p className="field-error">{controller.aiError}</p>}
    </div>
  );
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

async function requestAiStream(
  targetSessionId: string,
  input: {
    message: string;
    bookId?: string;
    page: string;
    signal: AbortSignal;
    timeZone: string;
    attachments: File[];
    onDelta: (delta: string) => void;
  },
) {
  const body = new FormData();
  body.set("message", input.message);
  body.set("page", input.page);
  body.set("timeZone", input.timeZone);
  if (input.bookId) body.set("bookId", input.bookId);
  input.attachments.forEach((file) => body.append("files", file, file.name));
  const response = await apiFetchWithRefresh(`/ai/sessions/${targetSessionId}/messages/stream`, {
    method: "POST",
    body,
    signal: input.signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "AI 助手暂时不可用" }));
    throw new Error(String(payload.error ?? "AI 助手暂时不可用"));
  }
  if (!response.body) throw new Error("AI 响应为空");
  return readAiEventStream(response.body, { signal: input.signal, onDelta: input.onDelta });
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

function finalizeAssistantMessage(
  messages: AiRenderableMessage[],
  streamingAssistantId: string,
  assistantMessage: AiRenderableMessage,
): AiRenderableMessage[] {
  if (assistantMessage.id === streamingAssistantId) return upsertAssistantMessage(messages, assistantMessage);
  let replacedStreamingMessage = false;
  const next = messages.map((message) => {
    if (message.id !== streamingAssistantId) return message;
    replacedStreamingMessage = true;
    return assistantMessage;
  });
  if (replacedStreamingMessage) return next;
  return upsertAssistantMessage(messages, assistantMessage);
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

  return new Promise((resolve, reject) => {
    const pump = () => {
      if (handlers.signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      reader.read().then(({ value, done }) => {
        if (done) {
          resolve(donePayload ?? { parts: [] });
          return;
        }
        buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const raw of events) {
          const event = parseSseEvent(raw);
          if (event?.name === "message_delta") handlers.onDelta(String(event.data.text ?? ""));
          if (event?.name === "done") donePayload = event.data as AiChatResponse;
          if (event?.name === "error") {
            reject(new Error(String(event.data.message ?? "AI 助手暂时不可用")));
            return;
          }
        }
        pump();
      }, reject);
    };
    pump();
  });
}

function parseSseEvent(raw: string): { name: string; data: Record<string, unknown> } | undefined {
  const lines = raw.split("\n");
  let eventName = "";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!eventName || !dataLines.length) return undefined;
  try {
    return {
      name: eventName,
      data: JSON.parse(dataLines.join("\n")) as Record<string, unknown>,
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
  const text: string[] = [];
  for (const rawPart of message.parts ?? []) {
    const part = normalizeAiPart(rawPart);
    if (part?.type === "text") text.push(part.text);
  }
  return text.join(" ").trim();
}

function aiSessionTitle(messages: AiRenderableMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const firstUserText = firstUserMessage ? userMessageLabel(firstUserMessage) : "";
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
