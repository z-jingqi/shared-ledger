import { aiImportRecordSchema } from "@shared-ledger/shared";
import { z } from "zod";

export type AiContext = { bookId: string; userId: string; page?: string; text: string };
export type AiProvider = {
  structureImport(input: AiContext): Promise<z.infer<typeof aiImportRecordSchema>[]>;
  chat(input: AiContext): Promise<string>;
};

export class MockAiProvider implements AiProvider {
  async structureImport(input: AiContext) {
    const amount = Number(input.text.match(/[￥¥]\s?([\d,.]+)/)?.[1]?.replace(",", "")) || 0;
    return [
      aiImportRecordSchema.parse({
        type: "expense",
        amount: amount || 38.5,
        occurredAt: new Date().toISOString(),
        note: "由导入文件识别",
        categoryName: "日常",
        confidence: amount ? 0.93 : 0.65,
        warnings: amount ? [] : ["未能完全确认金额"],
      }),
    ];
  }
  async chat(input: AiContext) {
    return `我已结合当前${input.page ?? "账本"}上下文分析：${input.text.slice(0, 80)}。建议先确认待入账记录，再查看分类趋势。`;
  }
}

export class UnavailableAiProvider implements AiProvider {
  async structureImport(_input: AiContext): Promise<z.infer<typeof aiImportRecordSchema>[]> {
    throw new Error("AI 服务尚未配置，请联系管理员。");
  }
  async chat(_input: AiContext): Promise<string> {
    throw new Error("AI 服务尚未配置，请联系管理员。");
  }
}

export function createAiProvider(provider = "mock"): AiProvider {
  return provider === "mock" ? new MockAiProvider() : new UnavailableAiProvider();
}
