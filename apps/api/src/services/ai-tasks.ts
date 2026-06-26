import type { AiTask } from "../store";
import { listAiTasks, type AiActionRepository } from "./ai-actions";

type AiTaskStatusStreamOptions = {
  repository: AiActionRepository;
  userId: string;
  signal?: AbortSignal;
  pollMs: number;
  heartbeatMs: number;
};

const encodeSseEvent = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export function createAiTaskStatusStream(options: AiTaskStatusStreamOptions) {
  const encoder = new TextEncoder();
  let stop: (() => void) | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let stopped = false;
      let lastSnapshot = "";
      let polling = false;
      let pollTimer: ReturnType<typeof setInterval> | undefined;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

      let close = () => {};

      const cleanup = () => {
        if (stopped) return;
        stopped = true;
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        options.signal?.removeEventListener("abort", close);
      };

      close = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // The client may have already cancelled the stream.
        }
      };

      const send = (chunk: string) => {
        if (stopped) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const sendEvent = (event: string, data: unknown) => send(encodeSseEvent(event, data));

      const loadTasks = async (): Promise<AiTask[]> => listAiTasks(options.repository, options.userId);

      const sendSnapshot = async (force = false) => {
        if (stopped || polling) return;
        polling = true;
        try {
          const tasks = await loadTasks();
          const snapshot = JSON.stringify({ tasks });
          if (force || snapshot !== lastSnapshot) {
            lastSnapshot = snapshot;
            sendEvent("tasks", { tasks });
          }
        } catch (error) {
          sendEvent("stream-error", {
            message: error instanceof Error ? error.message : "任务状态连接已断开，可刷新恢复",
          });
          close();
        } finally {
          polling = false;
        }
      };

      const heartbeat = () => {
        sendEvent("heartbeat", { timestamp: new Date().toISOString() });
      };

      stop = close;
      options.signal?.addEventListener("abort", close, { once: true });

      void sendSnapshot(true).then(() => {
        if (stopped) return;
        pollTimer = setInterval(() => void sendSnapshot(), options.pollMs);
        heartbeatTimer = setInterval(heartbeat, options.heartbeatMs);
      });
    },
    cancel() {
      stop?.();
    },
  });
}

export function aiTaskStatusStreamTiming(appEnv?: string) {
  return appEnv === "test"
    ? { pollMs: 25, heartbeatMs: 25 }
    : { pollMs: 3000, heartbeatMs: 15000 };
}
