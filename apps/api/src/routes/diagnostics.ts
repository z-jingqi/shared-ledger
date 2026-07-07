import type { Hono } from "hono";
import { jsonError } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { requireUser } from "../services/access";
import { AlephToolsError, runtimeOcrClient } from "../services/ocr";
import type { MemoryLedgerStore } from "../store";
import type { Env, LedgerUser } from "../types";

const internalAlephToolsOrigin = "https://aleph-tools.internal";

export function registerDiagnosticRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  app.get("/diagnostics/aleph-tools", async (context) => {
    if (context.env.APP_ENV === "prod") return jsonError(context, "诊断接口不可用", 404);

    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    if (!context.env.ALEPH_TOOLS) return jsonError(context, "ALEPH_TOOLS service binding 未配置", 503);
    if (!context.env.ALEPH_TOOLS_API_KEY) return jsonError(context, "ALEPH_TOOLS_API_KEY 未配置", 503);

    const target = new URL("/v1/platform/check", internalAlephToolsOrigin);
    if (context.req.query("jobId")?.trim()) {
      return jsonError(context, "请使用 importJobId 诊断导入任务", 400);
    }
    const importJobId = context.req.query("importJobId")?.trim();
    const includeOcrRaw = context.req.query("includeOcrRaw") === "1";
    let resolvedJobId: string | undefined;

    if (importJobId) {
      const resolved = await resolveImportOcrJobId(context.env, store, user, importJobId);
      if (resolved instanceof Response) return resolved;
      resolvedJobId = resolved;
      target.searchParams.set("jobId", resolved);
    }

    const response = await context.env.ALEPH_TOOLS.fetch(
      new Request(target.toString(), {
        headers: {
          Authorization: `Bearer ${context.env.ALEPH_TOOLS_API_KEY}`,
        },
      }),
    );

    const responseText = await response.text();
    const payload = parseJsonResponse(responseText);
    if (payload) {
      const enriched = await maybeAttachOcrRawDebugData(context.env, payload, {
        importJobId,
        ocrJobId: resolvedJobId,
        includeOcrRaw,
      });
      return context.json(enriched, response.status as never);
    }
    return context.text(responseText, response.status as never);
  });
}

async function maybeAttachOcrRawDebugData(
  env: Env,
  payload: unknown,
  input: { importJobId?: string; ocrJobId?: string; includeOcrRaw: boolean },
) {
  if (!input.includeOcrRaw || !input.importJobId || !input.ocrJobId) return payload;
  const base = isRecord(payload) ? payload : { value: payload };
  const debugBase = {
    importJobId: input.importJobId,
    ocrJobId: input.ocrJobId,
    capturedAt: new Date().toISOString(),
  };
  try {
    return {
      ...base,
      sharedLedgerDebug: {
        ...debugBase,
        ocrRawResult: await runtimeOcrClient(env).getResult(input.ocrJobId),
      },
    };
  } catch (error) {
    return {
      ...base,
      sharedLedgerDebug: {
        ...debugBase,
        ocrRawError: normalizeOcrRawDebugError(error),
      },
    };
  }
}

function normalizeOcrRawDebugError(error: unknown) {
  if (error instanceof AlephToolsError) {
    return {
      code: error.code,
      message: error.message,
      requestId: error.requestId,
      status: error.jobStatus,
      stage: error.stage,
    };
  }
  return { message: error instanceof Error ? error.message : "OCR raw result unavailable" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function resolveImportOcrJobId(
  env: Env,
  store: MemoryLedgerStore | undefined,
  user: LedgerUser,
  importJobId: string,
) {
  const job = env.DB
    ? await new D1LedgerRepository(env.DB).getImportJob(importJobId)
    : store?.imports.find((item) => item.id === importJobId && !item.deletedAt);
  if (!job) return jsonErrorResponse("导入任务不存在", 404);
  if (job.userId !== user.id) return jsonErrorResponse("不能诊断其他用户的导入任务", 403);
  if (!job.ocrJobId) return jsonErrorResponse("导入任务未关联 Aleph OCR 任务", 409);
  return job.ocrJobId;
}

function jsonErrorResponse(error: string, status: number) {
  return Response.json({ error }, { status });
}

function parseJsonResponse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
