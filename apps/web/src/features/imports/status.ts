import { API } from "../../lib";

export const terminalImportStatuses = new Set(["completed", "pending_confirmation", "failed", "cancelled"]);

export type ImportJobStatus = {
  id: string;
  fileName: string;
  status: string;
  errorMessage?: string;
  errorCode?: string;
  errorRequestId?: string;
  errorStage?: string;
  retryable?: boolean;
  cancelable?: boolean;
  progress?: number;
  stage?: string;
  currentPage?: number;
  totalPages?: number;
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
  const mark = (job: ImportJobStatus) => {
    onJob(job);
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

  const url = `${API}/imports/status-stream?ids=${encodeURIComponent(ids.join(","))}`;
  const source = new EventSource(url, { withCredentials: true });

  source.addEventListener("job", (event) => {
    try {
      mark(JSON.parse((event as MessageEvent).data) as ImportJobStatus);
      if (pending.size === 0) source.close();
    } catch {
      notifyDisconnected();
      source.close();
    }
  });
  source.addEventListener("stream-error", (event) => {
    const payload = JSON.parse((event as MessageEvent).data || "{}") as { message?: string };
    notifyDisconnected(payload.message);
    source.close();
  });
  source.onerror = () => {
    notifyDisconnected();
    source.close();
  };

  return () => {
    source.close();
  };
}
