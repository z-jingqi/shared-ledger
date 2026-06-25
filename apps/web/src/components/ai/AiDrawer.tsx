import { XIcon } from "@phosphor-icons/react";
import { Button } from "@shared-ledger/ui";
import { useActiveBook } from "../../hooks/useActiveBook";
import { AiChat } from "./AiChat";
export function AiDrawer({ close }: { close: () => void }) {
  const { book } = useActiveBook();
  return (
    <>
      <button className="ai-drawer-backdrop" type="button" aria-label="关闭 AI 助手遮罩" onClick={close} />
      <aside className="ai-drawer" aria-label="AI 助手">
        <header className="ai-workspace-header">
          <h2>AI 助手</h2>
          <span className="ai-book-pill" aria-label={`当前账本 ${book?.name ?? "未选择账本"}`}>
            {book?.name ?? "未选择账本"}
          </span>
          <Button type="button" variant="ghost" size="icon" onClick={close} aria-label="关闭 AI 助手">
            <XIcon size={20} />
          </Button>
        </header>
        <AiChat bookId={book?.id} page="浮窗" compact />
      </aside>
    </>
  );
}
