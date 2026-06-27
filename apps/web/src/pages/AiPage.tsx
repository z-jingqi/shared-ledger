import { SparkleIcon } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { AiChat } from "../components/ai/AiChat";
import { FullScreenPanel } from "../components/ios/IosDesign";
import { useActiveBook } from "../hooks/useActiveBook";
export function AiPage() {
  const navigate = useNavigate();
  const { book } = useActiveBook();
  return (
    <FullScreenPanel
      className="ios-ai-workspace"
      title="账本助手"
      subtitle={`${book?.name ?? "未选择账本"} · AI 助手`}
      icon={<SparkleIcon size={18} weight="fill" />}
      onClose={() => navigate(-1)}
    >
      <AiChat bookId={book?.id} page="AI 助手" />
    </FullScreenPanel>
  );
}
