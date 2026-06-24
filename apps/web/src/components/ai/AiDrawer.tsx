import { RobotIcon, SparkleIcon } from "@phosphor-icons/react";
import { Button } from "@shared-ledger/ui";
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
        <Button type="button" variant="ghost" size="icon" onClick={close} aria-label="关闭 AI 助手">
          ×
        </Button>
      </header>
      <SparkleIcon size={33} weight="fill" />
      <h2>今天想聊聊账本的什么？</h2>
      <p>我可以分析趋势、解释图表或整理记录。</p>
      <AiChat bookId={book?.id} page="浮窗" compact />
    </aside>
  );
}
