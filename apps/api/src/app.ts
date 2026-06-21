import { Hono } from "hono";
import { cors } from "hono/cors";
import { persistStore } from "./middleware/persistence";
import { registerAiRoutes } from "./routes/ai";
import { registerAuthRoutes } from "./routes/auth";
import { registerBookRoutes } from "./routes/books";
import { registerImportRoutes } from "./routes/imports";
import { registerInvitationRoutes } from "./routes/invitations";
import { registerMemberRoutes } from "./routes/members";
import { registerResourceRoutes } from "./routes/resources";
import { registerTransactionRoutes } from "./routes/transactions";
import { MemoryLedgerStore } from "./store";
import type { Env } from "./types";

export function createApp(store = new MemoryLedgerStore()) {
  const app = new Hono<{ Bindings: Env }>();

  app.use("/*", persistStore(store));
  app.use(
    "/*",
    cors({
      origin: (origin, context) => origin || context.env?.WEB_ORIGIN || "*",
      allowHeaders: ["Content-Type", "X-User-Id", "X-Plan"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.get("/health", (context) => context.json({ ok: true, environment: context.env.APP_ENV ?? "test" }));
  registerAuthRoutes(app, store);
  registerBookRoutes(app, store);
  registerMemberRoutes(app, store);
  registerInvitationRoutes(app, store);
  registerTransactionRoutes(app, store);
  registerResourceRoutes(app, store);
  registerImportRoutes(app, store);
  registerAiRoutes(app, store);

  return app;
}
