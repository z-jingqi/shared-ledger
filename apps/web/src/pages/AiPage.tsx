import { Robot } from "@phosphor-icons/react";
import { Page } from "../components/layout/Page";
import { AiChat } from "../components/ai/AiChat";
import { useAuth } from "../features/auth/AuthProvider";
import { useActiveBook } from "../hooks/useActiveBook";
export function AiPage() {
  const { user } = useAuth();
  const { book } = useActiveBook();
  return (
    <>
      <Page title="AI 助手" />
      <div className="ai-page-shell">
        <Robot size={42} weight="fill" />
        <h2>你好，{user?.name ?? "用户"}</h2>
        <p>我已准备好帮你理解这个账本。</p>
        <AiChat bookId={book?.id} page="AI 助手" />
      </div>
    </>
  );
}
