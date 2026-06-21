import { createApp } from "./app";
import type { Env } from "./types";

export { createApp } from "./app";

const app = createApp();

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>) {
    batch.ackAll();
  },
} satisfies ExportedHandler<Env>;
