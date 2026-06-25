import { XIcon } from "@phosphor-icons/react";
import { Button } from "@shared-ledger/ui";
import { useNavigate } from "react-router-dom";
import { AiChat } from "../components/ai/AiChat";
import { useActiveBook } from "../hooks/useActiveBook";
export function AiPage() {
  const navigate = useNavigate();
  const { book } = useActiveBook();
  return (
    <div className="ai-standalone-workspace">
      <header className="ai-workspace-header">
        <h1>AI 助手</h1>
        <span className="ai-book-pill" aria-label={`当前账本 ${book?.name ?? "未选择账本"}`}>
          {book?.name ?? "未选择账本"}
        </span>
        <Button type="button" variant="ghost" size="icon" aria-label="关闭 AI 助手" onClick={() => navigate(-1)}>
          <XIcon size={20} />
        </Button>
      </header>
      <AiChat bookId={book?.id} page="AI 助手" />
    </div>
  );
}
