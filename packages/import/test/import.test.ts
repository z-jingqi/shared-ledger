import { describe, expect, it } from "vitest";
import { structureForConfirmation } from "../src/index";

describe("image OCR import workflow", () => {
  it("structures OCR text for pending confirmation records", async () => {
    const records = await structureForConfirmation({
      bookId: "book_1",
      userId: "user_1",
      normalized: { rawText: "超市购物 ¥38.50", warnings: ["OCR 置信度较低"] },
      ai: {
        streamChat() {
          return { textStream: (async function* () {})() };
        },
        async selectSkill() {
          return { skillName: "ledger.imports", confidence: 1 };
        },
        async planSkillStep() {
          return {
            skillName: "ledger.imports",
            toolName: "chat",
            args: {},
            confidence: 1,
            requiresConfirmation: false,
            isFinal: true,
          };
        },
        async chat() {
          return "ok";
        },
        async structureImport() {
          return [
            {
              type: "expense",
              amount: 38.5,
              occurredAt: "2026-06-28",
              note: "超市购物",
              confidence: 0.9,
              warnings: [],
            },
          ];
        },
      },
    });

    expect(records).toEqual([
      expect.objectContaining({
        type: "expense",
        amount: 38.5,
        warnings: ["OCR 置信度较低"],
      }),
    ]);
  });
});
