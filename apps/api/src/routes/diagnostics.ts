import type { Hono } from "hono";
import { jsonError } from "../lib/http";
import { D1LedgerRepository } from "../repository";
import { requireUser } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env, LedgerUser } from "../types";

export function registerDiagnosticRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  app.get("/diagnostics/ocr", async (context) => {
    if (context.env.APP_ENV === "prod") return jsonError(context, "诊断接口不可用", 404);

    const user = await requireUser(context, store);
    if (user instanceof Response) return user;
    const importJobId = context.req.query("importJobId")?.trim();
    const payload: Record<string, unknown> = {
      ok: Boolean(context.env.GOOGLE_VISION_API_KEY),
      checks: {
        googleVision: {
          ok: Boolean(context.env.GOOGLE_VISION_API_KEY),
          configured: Boolean(context.env.GOOGLE_VISION_API_KEY),
        },
      },
    };

    if (importJobId) {
      const resolved = await resolveImportJob(context.env, store, user, importJobId);
      if (resolved instanceof Response) return resolved;
      payload.importJob = {
        id: resolved.job.id,
        status: resolved.job.status,
        stage: resolved.job.ocrStage,
        ocrJobId: resolved.job.ocrJobId,
      };
    }

    return context.json(payload);
  });
}

async function resolveImportJob(
  env: Env,
  store: MemoryLedgerStore | undefined,
  user: LedgerUser,
  importJobId: string,
) {
  if (env.DB) {
    const repository = new D1LedgerRepository(env.DB);
    const job = await repository.getImportJob(importJobId);
    if (!job) return jsonErrorResponse("导入任务不存在", 404);
    if (job.userId !== user.id) return jsonErrorResponse("不能诊断其他用户的导入任务", 403);
    return { job };
  }
  const job = store?.imports.find((item) => item.id === importJobId && !item.deletedAt);
  if (!job) return jsonErrorResponse("导入任务不存在", 404);
  if (job.userId !== user.id) return jsonErrorResponse("不能诊断其他用户的导入任务", 403);
  return { job };
}

function jsonErrorResponse(error: string, status: number) {
  return Response.json({ error }, { status });
}
