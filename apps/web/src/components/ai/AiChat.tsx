import { CaretRightIcon } from "@phosphor-icons/react";
import { useChat } from "@ai-sdk/react";
import { Button, Input } from "@shared-ledger/ui";
import { DefaultChatTransport } from "ai";
import { useMemo, useState } from "react";
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
  const transport = useMemo(
    () => new DefaultChatTransport({ api: `${API}/ai/chat`, credentials: "include", body: { bookId, page } }),
    [bookId, page],
  );
  const { messages, sendMessage, status, error, stop } = useChat({ transport, experimental_throttle: 50 });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    void sendMessage({ text });
  };
  return (
    <div className={compact ? "ai-content" : "ai-page"}>
      {messages.length > 0 && (
        <div className="ai-messages">
          {messages.map((message) => (
            <p key={message.id} className={message.role === "user" ? "ai-user" : "ai-assistant"}>
              {message.parts
                .filter((part) => part.type === "text")
                .map((part) => (part.type === "text" ? part.text : ""))
                .join("")}
            </p>
          ))}
        </div>
      )}
      <form onSubmit={submit}>
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="问问你的账本…"
          disabled={status === "streaming" || status === "submitted"}
        />
        {status === "streaming" || status === "submitted" ? (
          <Button type="button" onClick={stop}>
            停止
          </Button>
        ) : (
          <Button aria-label="发送" size="icon">
            <CaretRightIcon />
          </Button>
        )}
      </form>
      {error && <p className="field-error">{error.message}</p>}
    </div>
  );
}
