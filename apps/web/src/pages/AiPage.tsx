import { Robot } from "@phosphor-icons/react";
import { Page } from "../components/layout/Page";

export function AiPage() {
  return (
    <>
      <Page title="AI 助手" />
      <div className="ai-page">
        <Robot size={42} weight="fill" />
        <h2>你好，张三</h2>
        <p>我已准备好帮你理解这个账本。</p>
        <div className="prompt-grid">
          <button>本月花在哪了？</button>
          <button>帮我总结最近记录</button>
          <button>有什么节省建议？</button>
        </div>
      </div>
    </>
  );
}
