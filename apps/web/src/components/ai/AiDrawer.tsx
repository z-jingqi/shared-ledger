import { CaretRightIcon, RobotIcon, SparkleIcon } from "@phosphor-icons/react";
import { useState } from "react";

export function AiDrawer({ close }: { close: () => void }) {
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");

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
          setAnswer(`关于“${message}”，本月餐饮支出占比最高，建议先确认 3 笔待入账记录。`);
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
