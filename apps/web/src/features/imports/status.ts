import { API, apiFetchWithRefresh } from "../../lib";

export const terminalImportStatuses = new Set(["completed", "pending_confirmation", "failed", "cancelled"]);
const loggedOcrResultJobIds = new Set<string>();

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
  duplicateOfJobId?: string;
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
      void logOcrResultForDebug(job);
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

async function logOcrResultForDebug(job: ImportJobStatus) {
  if (!canLogOcrResult()) return;
  if (loggedOcrResultJobIds.has(job.id)) return;
  if (!hasCompletedOcr(job)) return;
  loggedOcrResultJobIds.add(job.id);
  try {
    const response = await apiFetchWithRefresh(`/imports/${job.id}/ocr-result`);
    if (!response.ok) return;
    console.log("[shared-ledger:ocr]", await response.json());
  } catch {
    loggedOcrResultJobIds.delete(job.id);
  }
}

function hasCompletedOcr(job: ImportJobStatus) {
  return (
    job.stage === "ready" ||
    job.status === "ai_processing" ||
    job.status === "pending_confirmation" ||
    job.status === "completed" ||
    (job.status === "failed" && job.errorStage === "ai")
  );
}

function canLogOcrResult() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return (
    import.meta.env.DEV ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.startsWith("dev.") ||
    host.includes("preview")
  );
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
