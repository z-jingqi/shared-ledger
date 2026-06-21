import { CaretRightIcon, RobotIcon, SparkleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useActiveBook } from "../../hooks/useActiveBook";
import { api } from "../../lib";
export function AiDrawer({ close }: { close: () => void }) {
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const { book } = useActiveBook();
  const ask = async () => {
    if (!message.trim()) return;
    const result = await api<{ message: string }>("/ai/chat", {
      method: "POST",
      body: JSON.stringify({ message, bookId: book?.id, page: "浮窗" }),
    });
    setAnswer(result.message);
  };
  return (
    <aside className="ai-drawer">
      <header>
        <div>
          <RobotIcon size={25} weight="fill" />
          <b>一起记 AI</b>
        </div>
        <button onClick={close}>×</button>
      </header>
      <div className="ai-content">
        {answer ? (
          <p>{answer}</p>
        ) : (
          <>
            <SparkleIcon size={33} weight="fill" />
            <h2>今天想聊聊账本的什么？</h2>
            <p>我可以分析趋势、解释图表或整理记录。</p>
          </>
        )}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="问问你的账本…"
        />
        <button aria-label="发送">
          <CaretRightIcon />
        </button>
      </form>
    </aside>
  );
}
