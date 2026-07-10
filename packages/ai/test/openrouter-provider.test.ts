import { generateObject } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLedgerLanguageModel } from "../src/index";

describe("OpenRouter language model configuration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests strict structured output with response healing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "generation_test",
          model: "deepseek/deepseek-v4-flash",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: '{"value":"ok"}' },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const model = createLedgerLanguageModel({
      provider: "openrouter",
      model: "deepseek/deepseek-v4-flash",
      apiKey: "test-key",
    });

    const result = await generateObject({
      model,
      output: "object",
      schemaName: "test_output",
      schema: z.object({ value: z.string() }),
      prompt: "Return the test value.",
    });

    expect(result.object).toEqual({ value: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.plugins).toEqual([{ id: "response-healing" }]);
    expect(body.provider).toMatchObject({ require_parameters: true });
    expect(body.reasoning).toMatchObject({ enabled: false, exclude: true, effort: "none" });
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "test_output", strict: true },
    });
  });
});
