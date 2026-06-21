import { createAiProvider, defaultAiConfig, type LedgerAiConfig } from "@shared-ledger/ai";
import type { Env } from "../types";

export function parseProviderKeys(value?: string) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed ? (parsed as Record<string, string>) : {};
  } catch {
    throw new Error("AI_PROVIDER_KEYS 必须是 JSON 对象");
  }
}

export function runtimeAiProvider(env: Env, config?: Partial<LedgerAiConfig>) {
  return createAiProvider(
    { ...defaultAiConfig, ...config },
    { ai: env.AI, providerKeys: parseProviderKeys(env.AI_PROVIDER_KEYS) },
  );
}
