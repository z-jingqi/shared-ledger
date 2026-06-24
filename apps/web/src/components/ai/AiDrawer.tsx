import { RobotIcon } from "@phosphor-icons/react";
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
      <AiChat bookId={book?.id} page="浮窗" compact />
    </aside>
  );
}
