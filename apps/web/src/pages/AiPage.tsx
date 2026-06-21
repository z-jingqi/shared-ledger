import { Robot } from "@phosphor-icons/react";
import { useState } from "react";
import { Page } from "../components/layout/Page";
import { useActiveBook } from "../hooks/useActiveBook";
import { api } from "../lib";
import { useAuth } from "../features/auth/AuthProvider";

export function AiPage() {
  const { user } = useAuth();
  const { book } = useActiveBook();
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const ask = async (question: string) => {
    try {
      const result = await api<{ message: string }>("/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: question, bookId: book?.id, page: "AI 助手" }),
      });
      setAnswer(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 请求失败");
    }
  };
  return (
    <>
      <Page title="AI 助手" />
      <div className="ai-page">
        <Robot size={42} weight="fill" />
        <h2>你好，{user?.name ?? "用户"}</h2>
        <p>我已准备好帮你理解这个账本。</p>
        {answer && <p>{answer}</p>}
        <div className="prompt-grid">
          {["本月花在哪了？", "帮我总结最近记录", "有什么节省建议？"].map((prompt) => (
            <button key={prompt} onClick={() => void ask(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            if (message.trim()) void ask(message);
          }}
        >
          <input
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="问问你的账本…"
          />
          {error && <p className="field-error">{error}</p>}
          <button type="submit">发送</button>
        </form>
      </div>
    </>
  );
}
