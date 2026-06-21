import { aiImportRecordSchema } from "@shared-ledger/shared";
import { z } from "zod";

export type AiContext = { bookId: string; userId: string; page?: string; text: string };
export type WorkersAiBinding = { run(model: string, input: unknown): Promise<unknown> };

export interface AiProvider {
  structureImport(input: AiContext): Promise<z.infer<typeof aiImportRecordSchema>[]>;
  chat(input: AiContext): Promise<string>;
}

const importSystemPrompt = `You are a bookkeeping extraction service. Return JSON only, matching this schema:
[{"type":"income|expense","amount":number,"occurredAt":"ISO date","note":"string","categoryName":"string","confidence":0..1,"warnings":["string"]}].
Infer nothing that is not supported by the supplied parsed text.`;

function extractJson(value: unknown) {
  if (typeof value === "object" && value && "response" in value && typeof value.response === "string") {
    const response = value.response
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/```$/i, "");
    return JSON.parse(response);
  }
  throw new Error("Workers AI 未返回可解析的结构化结果");
}

export class WorkersAiProvider implements AiProvider {
  constructor(
    private readonly ai: WorkersAiBinding,
    private readonly model = "@cf/meta/llama-3.1-8b-instruct",
  ) {}

  async structureImport(input: AiContext) {
    const result = await this.ai.run(this.model, {
      messages: [
        { role: "system", content: importSystemPrompt },
        { role: "user", content: input.text },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = extractJson(result);
    const records = Array.isArray(parsed) ? parsed : parsed.records;
    if (!Array.isArray(records)) throw new Error("AI 输出不包含记录数组");
    return records.map((record) => aiImportRecordSchema.parse(record));
  }

  async chat(input: AiContext) {
    const result = await this.ai.run(this.model, {
      messages: [
        {
          role: "system",
          content: "你是一起记的账本助手。回答基于用户当前账本上下文，简洁、明确、不得编造数据。",
        },
        {
          role: "user",
          content: `页面：${input.page ?? "账本"}\n账本：${input.bookId}\n问题：${input.text}`,
        },
      ],
    });
    if (typeof result === "object" && result && "response" in result && typeof result.response === "string")
      return result.response;
    throw new Error("Workers AI 未返回文本回复");
  }
}

export function createAiProvider(ai?: WorkersAiBinding): AiProvider {
  if (!ai) throw new Error("Workers AI binding 未配置");
  return new WorkersAiProvider(ai);
}
