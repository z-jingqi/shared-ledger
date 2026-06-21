import { Button, Panel } from "@shared-ledger/ui";
import { useEffect, useState } from "react";
import { Page } from "../components/layout/Page";
import { api } from "../lib";

type Provider = "workers-ai" | "openai" | "anthropic" | "openrouter";
type Config = { provider: Provider; model: string; apiKeyRef?: string; baseUrl?: string };
const defaults: Record<Provider, string> = {
  "workers-ai": "@cf/meta/llama-3.1-8b-instruct",
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5",
  openrouter: "openai/gpt-4o-mini",
};
export function AiProviderPage() {
  const [config, setConfig] = useState<Config>({ provider: "workers-ai", model: defaults["workers-ai"] });
  const [message, setMessage] = useState("");
  useEffect(() => {
    void api<{ config: Config }>("/ai/providers")
      .then(({ config }) => setConfig(config))
      .catch((error) => setMessage(error.message));
  }, []);
  const save = async () => {
    try {
      const result = await api<{ config: Config }>("/ai/providers", {
        method: "PUT",
        body: JSON.stringify(config),
      });
      setConfig(result.config);
      setMessage("已保存；下一次对话立即使用新 Provider。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    }
  };
  return (
    <>
      <Page title="AI Provider" />
      <Panel>
        <p className="muted">
          切换保存在你的 D1 配置中，无需重启 Worker。密钥仅存于 Worker secret 的
          AI_PROVIDER_KEYS，不会写入数据库。
        </p>
        <div className="form">
          <label>
            Provider
            <select
              value={config.provider}
              onChange={(event) => {
                const provider = event.target.value as Provider;
                setConfig((current) => ({
                  ...current,
                  provider,
                  model: defaults[provider],
                  apiKeyRef: provider === "workers-ai" ? undefined : provider,
                }));
              }}
            >
              <option value="workers-ai">Workers AI</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </label>
          <label>
            模型
            <input
              value={config.model}
              onChange={(event) => setConfig((current) => ({ ...current, model: event.target.value }))}
            />
          </label>
          {config.provider !== "workers-ai" && (
            <>
              <label>
                密钥引用
                <input
                  value={config.apiKeyRef ?? config.provider}
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, apiKeyRef: event.target.value }))
                  }
                />
              </label>
              <label>
                自定义 Base URL（可选）
                <input
                  value={config.baseUrl ?? ""}
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, baseUrl: event.target.value || undefined }))
                  }
                />
              </label>
            </>
          )}
          <Button onClick={() => void save()}>保存并热切换</Button>
          {message && <p className="success-note">{message}</p>}
        </div>
      </Panel>
    </>
  );
}
