import {
  AlephAIError,
  createAlephAIClient,
  type AlephAIClient,
  type ChatMessage,
  type ErrorCode,
  type InvokeRequest,
  type JsonObject,
  type StreamEvent,
  type UserUsageResponse,
} from "./platform-client";
import {
  ledgerSkillNames,
  ledgerSkillSelectionSchema,
  ledgerToolStepSchema,
  type LedgerSkillDefinition,
  type LedgerSkillSelection,
  type LedgerToolStep,
} from "@shared-ledger/ledger-skills";
import { aiImportRecordSchema } from "@shared-ledger/shared";
import { z } from "zod";

export { AlephAIError, createAlephAIClient };
export type { AlephAIClient, ErrorCode, InvokeRequest, JsonObject, StreamEvent, UserUsageResponse };

export type AiContext = { bookId: string; userId: string; page?: string; text: string };
export type AiChatMessage = { role: "system" | "user" | "assistant" | "tool"; content?: string };
export type AiTextStream = { textStream: AsyncIterable<string> };
export type LedgerAiUser = { id: string; plan: string };
export type LedgerAiRuntime = {
  client: AlephAIClient;
  env: string;
  user: LedgerAiUser;
  project?: string;
};

export interface AiProvider {
  structureImport(input: AiContext): Promise<z.infer<typeof aiImportRecordSchema>[]>;
  streamChat(messages: AiChatMessage[], context: Pick<AiContext, "bookId" | "page">): AiTextStream;
  selectSkill(input: AiSkillSelectionInput): Promise<LedgerSkillSelection>;
  planSkillStep(input: AiSkillStepInput): Promise<LedgerToolStep>;
  chat(input: AiContext): Promise<string>;
}

const projectId = "shared-ledger";
const chatTask = "ledger.chat";
const skillSelectTask = "ledger.skill_select";
const skillStepTask = "ledger.skill_step";

const importSystemPrompt =
  "You extract bookkeeping entries. Return only JSON matching the supplied schema. Do not invent records unsupported by the supplied text.";
const chatSystemPrompt = [
  "你是一个正常、友好、可靠的通用聊天机器人，同时也是一起记应用的智能助手。",
  "用户可以聊任何话题；和账本无关的问题也要自然回答，不要强行转回记账。",
  "如果回答涉及当前账本数据，只能基于工具或上下文提供的真实数据，不要编造记录、成员、余额或文件状态。",
].join("\n");
const skillSelectSystemPrompt = [
  "你是一起记应用的通用智能助手。你可以正常聊天，也可以操作应用数据。",
  "用户输入可能有错别字、口语、省略、多意图或附件；不要依赖关键词，要理解语义。",
  "先选择最合适的 Skill：普通聊天选择 general.chat；真实账本查询/分析/写入/附件处理选择对应 ledger.* Skill。",
  "不要因为用户话题和账本无关就拒绝；普通聊天应自然回答。",
  "输出必须符合 schema。",
].join("\n");
const skillStepSystemPrompt = [
  "你是一起记应用的 Skill 执行规划器。",
  "只能从当前 Skill 提供的 tools 中选择一个 toolName。",
  "如果需要真实账本数据，必须选择查询/分析工具，不要编造数据。",
  "如果用户要修改应用数据，选择最小必要工具，并把参数放入 args。",
  "金额筛选中，“大于/超过”使用 minAmount 且 minStrict=true；“至少/不低于”使用 minAmount 且 minStrict=false；“小于/低于”使用 maxAmount 且 maxStrict=true；“不超过/最多”使用 maxAmount 且 maxStrict=false。",
  "附件会在 attachments 中提供元数据；图片可用于头像或视觉问题，文件可用于导入或分析。用户没要求保存/导入时不要选择 save-attachments。",
  "删除、移除成员、删除账本、批量修改、发送邀请、导出等高影响动作必须 requiresConfirmation=true。",
  "如果一次工具结果已经足够回答用户，把 isFinal 设为 true；只有确实需要基于观察结果继续第二步时才设为 false。",
  "普通聊天选择 chat，并在 userMessage 中给出自然回复要点。",
  "输出必须符合 schema。",
].join("\n");

export type AiSkillSelectionInput = {
  text: string;
  userId?: string;
  bookId?: string;
  page: string;
  today: string;
  timeZone: string;
  skills: LedgerSkillDefinition[];
  context?: Record<string, unknown>;
  attachments?: Array<Record<string, unknown>>;
};
export type AiSkillStepInput = AiSkillSelectionInput & {
  selectedSkill: LedgerSkillDefinition;
  observations?: Array<Record<string, unknown>>;
  stepIndex: number;
  maxSteps: number;
};

export function createAlephAiProvider(runtime: LedgerAiRuntime): AiProvider {
  const project = runtime.project ?? projectId;

  function invokeRequest(input: {
    task: string;
    mode: "object" | "stream";
    messages: ChatMessage[];
    responseFormat?: JsonObject;
    temperature?: number;
    maxTokens?: number;
  }) {
    return {
      project,
      env: runtime.env,
      task: input.task,
      user: runtime.user,
      mode: input.mode,
      input: {
        messages: input.messages,
        ...(input.responseFormat ? { response_format: input.responseFormat } : {}),
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        ...(input.maxTokens === undefined ? {} : { max_tokens: input.maxTokens }),
      },
    };
  }

  return {
    streamChat(messages: AiChatMessage[], context: Pick<AiContext, "bookId" | "page">) {
      const alephMessages: ChatMessage[] = [
        {
          role: "system",
          content: `${chatSystemPrompt}\n页面：${context.page ?? "账本"}\n账本：${context.bookId}`,
        },
        ...messages.map(toAlephMessage),
      ];
      return {
        textStream: streamDeltas(
          runtime.client.stream(
            invokeRequest({
              task: chatTask,
              mode: "stream",
              messages: alephMessages,
              temperature: 0.4,
              maxTokens: 1400,
            }),
          ),
        ),
      };
    },
    async chat(input: AiContext) {
      let text = "";
      for await (const delta of this.streamChat([{ role: "user", content: input.text }], input).textStream) {
        text += delta;
      }
      return text;
    },
    async selectSkill(input: AiSkillSelectionInput): Promise<LedgerSkillSelection> {
      const response = await runtime.client.invoke<unknown>(
        invokeRequest({
          task: skillSelectTask,
          mode: "object",
          messages: [
            { role: "system", content: skillSelectSystemPrompt },
            { role: "user", content: JSON.stringify(skillSelectionPayload(input), null, 2) },
          ],
          responseFormat: responseFormat("ledger_skill_selection", skillSelectionJsonSchema),
          temperature: 0.1,
          maxTokens: 900,
        }),
      );
      return ledgerSkillSelectionSchema.parse(response.output);
    },
    async planSkillStep(input: AiSkillStepInput): Promise<LedgerToolStep> {
      const response = await runtime.client.invoke<unknown>(
        invokeRequest({
          task: skillStepTask,
          mode: "object",
          messages: [
            { role: "system", content: skillStepSystemPrompt },
            { role: "user", content: JSON.stringify(skillStepPayload(input), null, 2) },
          ],
          responseFormat: responseFormat("ledger_skill_step", skillStepJsonSchema(input.selectedSkill)),
          temperature: 0.1,
          maxTokens: 1800,
        }),
      );
      const step = ledgerToolStepSchema.parse(response.output);
      if (step.skillName !== input.selectedSkill.name) {
        throw new AlephAIError("validation_failed", `AI selected mismatched skill: ${step.skillName}`);
      }
      if (!input.selectedSkill.tools.some((tool) => tool.name === step.toolName)) {
        throw new AlephAIError("validation_failed", `AI selected unavailable tool: ${step.toolName}`);
      }
      return step;
    },
    async structureImport(input: AiContext): Promise<z.infer<typeof aiImportRecordSchema>[]> {
      const response = await runtime.client.invoke<unknown>(
        invokeRequest({
          task: skillStepTask,
          mode: "object",
          messages: [
            { role: "system", content: importSystemPrompt },
            {
              role: "user",
              content: JSON.stringify(
                {
                  bookId: input.bookId,
                  userId: input.userId,
                  page: input.page ?? "导入",
                  text: input.text,
                },
                null,
                2,
              ),
            },
          ],
          responseFormat: responseFormat("ledger_import_records", importRecordsJsonSchema),
          temperature: 0,
          maxTokens: 2400,
        }),
      );
      return importRecordsOutputSchema
        .parse(response.output)
        .records.map((record) => aiImportRecordSchema.parse(record));
    },
  };
}

function toAlephMessage(message: AiChatMessage): ChatMessage {
  return {
    role: message.role,
    content: message.content ?? "",
  };
}

async function* streamDeltas(events: AsyncIterable<StreamEvent>) {
  for await (const event of events) {
    if (event.type === "delta") yield event.delta;
    if (event.type === "error")
      throw new AlephAIError(event.error.code, event.error.message, {
        requestId: event.requestId,
        details: event.error.details,
      });
  }
}

function skillSelectionPayload(input: AiSkillSelectionInput) {
  return {
    text: input.text,
    userId: input.userId,
    bookId: input.bookId,
    page: input.page,
    today: input.today,
    timeZone: input.timeZone,
    skills: input.skills.map((skill) => ({
      name: skill.name,
      title: skill.title,
      description: skill.description,
      useWhen: skill.useWhen,
      tools: skill.tools.map((tool) => tool.name),
    })),
    context: input.context ?? {},
    attachments: input.attachments ?? [],
  };
}

function skillStepPayload(input: AiSkillStepInput) {
  return {
    ...skillSelectionPayload(input),
    selectedSkill: input.selectedSkill,
    observations: input.observations ?? [],
    stepIndex: input.stepIndex,
    maxSteps: input.maxSteps,
  };
}

function responseFormat(name: string, schema: JsonObject): JsonObject {
  return {
    type: "json_schema",
    json_schema: {
      name,
      strict: false,
      schema,
    },
  };
}

const moneyJsonSchema = {
  type: "number",
  exclusiveMinimum: 0,
  multipleOf: 0.01,
} as unknown as JsonObject;

const importRecordJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "amount", "occurredAt", "confidence", "warnings"],
  properties: {
    type: { type: "string", enum: ["income", "expense"] },
    amount: moneyJsonSchema,
    occurredAt: { type: "string" },
    note: { type: "string", maxLength: 500 },
    categoryName: { type: "string", maxLength: 30 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    warnings: { type: "array", items: { type: "string" } },
  },
} as unknown as JsonObject;

const importRecordsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["records"],
  properties: {
    records: {
      type: "array",
      items: importRecordJsonSchema,
    },
  },
} as unknown as JsonObject;

const skillSelectionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["skillName", "confidence"],
  properties: {
    skillName: { type: "string", enum: ledgerSkillNames },
    reason: { type: "string", maxLength: 500 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as unknown as JsonObject;

function skillStepJsonSchema(skill: LedgerSkillDefinition) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["skillName", "toolName", "args", "requiresConfirmation", "confidence"],
    properties: {
      skillName: { type: "string", enum: [skill.name] },
      toolName: { type: "string", enum: skill.tools.map((tool) => tool.name) },
      args: { type: "object" },
      userMessage: { type: "string", maxLength: 2000 },
      requiresConfirmation: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      isFinal: { type: "boolean" },
    },
  } as unknown as JsonObject;
}

const importRecordsOutputSchema = z.object({
  records: z.array(aiImportRecordSchema),
});
