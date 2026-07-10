import { createApp } from "./app";
import { D1LedgerRepository } from "./repository";
import { cleanupExpiredImportArtifacts, processImportPipelineBatch } from "./services/imports";
import type { Env, ImportPipelineMessage } from "./types";

export { createApp } from "./app";

const app = createApp();

function stripApiPrefix(request: Request) {
  const url = new URL(request.url);
  if (url.pathname === "/api") url.pathname = "/";
  else if (url.pathname.startsWith("/api/")) url.pathname = url.pathname.slice(4);
  else return request;
  return new Request(url.toString(), request);
}

export default {
  fetch(request, env, context) {
    return app.fetch(stripApiPrefix(request), env, context);
  },
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    if (!env.DB) return;
    context.waitUntil(cleanupExpiredImportArtifacts(env, new D1LedgerRepository(env.DB)));
  },
  async queue(batch, env) {
    await processImportPipelineBatch(env, batch as MessageBatch<ImportPipelineMessage>);
  },
} satisfies ExportedHandler<Env>;
