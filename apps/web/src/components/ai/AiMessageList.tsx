import { ArrowDownIcon, ListNumbersIcon, SparkleIcon } from "@phosphor-icons/react";
import type { RefObject } from "react";
import { normalizeAiPart, type AiRenderableMessage, type AiStructuredPart } from "../../features/ai/types";
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
  AiProfileCard,
  AiRecordCard,
  AiSearchResultCard,
  AiThinkingMessage,
  AiToolStatus,
} from "./AiElements";

export type AiMessageIndexItem = { id: string; label: string };

export function AiMessageList({
  indexOpen,
  indexVisible,
  isStreaming,
  messages,
  messagesRef,
  onMessagesScroll,
  onScrollBottom,
  onScrollToMessage,
  onToggleIndex,
  onUserScrollIntent,
  showJumpToBottom,
  thinkingAssistantId,
  userMessageIndex,
}: {
  indexOpen: boolean;
  indexVisible: boolean;
  isStreaming: boolean;
  messages: AiRenderableMessage[];
  messagesRef: RefObject<HTMLDivElement | null>;
  onMessagesScroll: () => void;
  onScrollBottom: () => void;
  onScrollToMessage: (messageId: string) => void;
  onToggleIndex: () => void;
  onUserScrollIntent: () => void;
  showJumpToBottom: boolean;
  thinkingAssistantId?: string;
  userMessageIndex: AiMessageIndexItem[];
}) {
  const hasConversation = messages.length > 0;
  return (
    <>
      {userMessageIndex.length > 0 && (
        <div className={`ai-message-index ${indexVisible || indexOpen ? "visible" : ""}`}>
          <button type="button" aria-label="打开会话目录" onClick={onToggleIndex}>
            <ListNumbersIcon size={18} weight="bold" />
          </button>
          {indexOpen && (
            <div className="ai-message-index-panel" role="menu" aria-label="当前会话目录">
              <strong>当前会话</strong>
              {userMessageIndex.map((item, index) => (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => onScrollToMessage(item.id)}
                  key={item.id}
                >
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
        <AiConversation ref={messagesRef} onScroll={onMessagesScroll} onUserScrollIntent={onUserScrollIntent}>
          {messages.map((message, index) => (
            <RenderedAiMessage
              key={message.id}
              message={message}
              streaming={isStreaming && index === messages.length - 1}
            />
          ))}
          {thinkingAssistantId ? <AiThinkingMessage /> : null}
        </AiConversation>
      )}
      {showJumpToBottom && (
        <button
          className="ai-scroll-bottom-button icon-only"
          type="button"
          aria-label="回到底部"
          onClick={onScrollBottom}
        >
          <ArrowDownIcon size={18} weight="bold" />
        </button>
      )}
    </>
  );
}

function RenderedAiMessage({ message, streaming }: { message: AiRenderableMessage; streaming: boolean }) {
  const role = message.role === "user" ? "user" : "assistant";
  const parts: AiStructuredPart[] = [];
  const textParts: string[] = [];
  for (const rawPart of message.parts ?? []) {
    const part = normalizeAiPart(rawPart);
    if (!part) continue;
    parts.push(part);
    if (part.type === "text") textParts.push(part.text);
  }
  const text = textParts.join("");

  if (role === "user") {
    return (
      <AiMessage messageRole="user" messageId={message.id}>
        <p>{text}</p>
      </AiMessage>
    );
  }

  return (
    <AiMessage messageRole="assistant" messageId={message.id}>
      <div className="ai-part-stack">
        {parts.map((part, index) => (
          <RenderedAiPart
            key={`${part.type}_${index}`}
            part={part}
            streaming={streaming && index === parts.length - 1}
          />
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
