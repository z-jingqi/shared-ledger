import { RobotIcon, SparkleIcon } from "@phosphor-icons/react";
import { useActiveBook } from "../../hooks/useActiveBook";
import { AiChat } from "./AiChat";
export function AiDrawer({ close }: { close: () => void }) {
  const { book } = useActiveBook();
  return (
    <aside className="ai-drawer">
      <header>
        <div>
          <RobotIcon size={25} weight="fill" />
          <b>一起记 AI</b>
        </div>
        <button onClick={close}>×</button>
      </header>
      <SparkleIcon size={33} weight="fill" />
      <h2>今天想聊聊账本的什么？</h2>
      <p>我可以分析趋势、解释图表或整理记录。</p>
      <AiChat bookId={book?.id} page="浮窗" compact />
    </aside>
  );
}
