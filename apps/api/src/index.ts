import { createApp } from "./app";
import { D1LedgerRepository } from "./repository";
import type { Env } from "./types";
import { processImportJob, type ImportQueueMessage } from "./services/imports";

export { createApp } from "./app";

const app = createApp();

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>, env: Env) {
    for (const message of batch.messages) {
      try {
        const body = message.body as ImportQueueMessage;
        if (!body?.jobId) throw new Error("无效的导入队列消息");
        await processImportJob(env, body.jobId);
        message.ack();
      } catch (error) {
        console.error("Import job failed", error);
        message.retry({ delaySeconds: 60 });
      }
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    if (!env.DB) return;
    context.waitUntil(new D1LedgerRepository(env.DB).cleanupExpiredImportJobs());
  },
} satisfies ExportedHandler<Env>;
