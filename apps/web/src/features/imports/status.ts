import { API } from "../../lib";
import { rememberOcrRawDataFromStatusStream } from "./ocr-raw-debug";

export const terminalImportStatuses = new Set(["completed", "pending_confirmation", "failed", "cancelled"]);

export type ImportJobStatus = {
  id: string;
  bookId?: string;
  fileName: string;
  fileType?: string;
  status: string;
  localOnly?: boolean;
  localPreviewUrl?: string;
  errorMessage?: string;
  errorCode?: string;
  errorRequestId?: string;
  errorStage?: string;
  retryable?: boolean;
  cancelable?: boolean;
  progress?: number;
  progressText?: string;
  stage?: string;
  currentPage?: number;
  totalPages?: number;
  createdAt?: string;
  updatedAt?: string;
};

export function watchImportJobs(
  jobIds: string[],
  onJob: (job: ImportJobStatus) => void,
  options: { onDone?: () => void; onError?: (message: string) => void } = {},
) {
  const ids = [...new Set(jobIds)].filter(Boolean);
  if (!ids.length) {
    options.onDone?.();
    return () => {};
  }

  const pending = new Set(ids);
  const lastSignatures = new Map<string, string>();
  const mark = (job: ImportJobStatus) => {
    const signature = jobSignature(job);
    if (lastSignatures.get(job.id) !== signature) {
      lastSignatures.set(job.id, signature);
      onJob(job);
    }
    if (terminalImportStatuses.has(job.status)) pending.delete(job.id);
    if (pending.size === 0) options.onDone?.();
  };

  const notifyDisconnected = (message = "进度连接已断开，可刷新恢复") => {
    if (pending.size === 0) return;
    options.onError?.(message);
  };

  if (typeof EventSource === "undefined") {
    notifyDisconnected("当前环境不支持实时进度连接，可刷新恢复");
    return () => {};
  }

  let source: EventSource | undefined;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let suppressNextError = false;
  const connect = () => {
    if (stopped || pending.size === 0) return;
    const url = `${API}/imports/status-stream?ids=${encodeURIComponent([...pending].join(","))}`;
    source = new EventSource(url, { withCredentials: true });

    source.addEventListener("job", (event) => {
      try {
        mark(JSON.parse((event as MessageEvent).data) as ImportJobStatus);
        if (pending.size === 0) {
          stopped = true;
          source?.close();
        }
      } catch {
        notifyDisconnected();
        stopped = true;
        source?.close();
      }
    });
    source.addEventListener("ocr-result", (event) => {
      try {
        rememberOcrRawDataFromStatusStream(JSON.parse((event as MessageEvent).data || "{}"));
      } catch {
        // Debug-only payload; ignore malformed raw OCR snapshots.
      }
    });
    source.addEventListener("stream-idle", (event) => {
      suppressNextError = true;
      source?.close();
      const payload = parseStreamIdlePayload((event as MessageEvent).data);
      if (!stopped && pending.size > 0 && payload.retryAfterMs > 0) {
        reconnectTimer = setTimeout(connect, payload.retryAfterMs);
      }
    });
    source.addEventListener("stream-error", (event) => {
      const payload = JSON.parse((event as MessageEvent).data || "{}") as { message?: string };
      notifyDisconnected(payload.message);
      stopped = true;
      source?.close();
    });
    source.onerror = () => {
      source?.close();
      if (suppressNextError) {
        suppressNextError = false;
        return;
      }
      notifyDisconnected();
      stopped = true;
    };
  };
  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    source?.close();
  };
}

function jobSignature(job: ImportJobStatus) {
  return [
    job.status,
    job.stage ?? "",
    job.progress ?? "",
    job.progressText ?? "",
    job.currentPage ?? "",
    job.totalPages ?? "",
    job.updatedAt ?? "",
    job.errorMessage ?? "",
    job.errorCode ?? "",
  ].join(":");
}

function parseStreamIdlePayload(data: string) {
  try {
    const payload = JSON.parse(data || "{}") as { retryAfterMs?: unknown };
    const retryAfterMs = Number(payload.retryAfterMs);
    return { retryAfterMs: Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? retryAfterMs : 10_000 };
  } catch {
    return { retryAfterMs: 10_000 };
  }
}
