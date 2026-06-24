import { API, api } from "../../lib";

export const terminalImportStatuses = new Set(["completed", "pending_confirmation", "failed"]);

export type ImportJobStatus = {
  id: string;
  fileName: string;
  status: string;
  errorMessage?: string;
};

export function watchImportJobs(
  jobIds: string[],
  onJob: (job: ImportJobStatus) => void,
  options: { onDone?: () => void } = {},
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

  if (typeof EventSource === "undefined") return pollImportJobs(ids, mark, options.onDone);

  const url = `${API}/imports/status-stream?ids=${encodeURIComponent(ids.join(","))}`;
  const source = new EventSource(url, { withCredentials: true });
  let fallbackStarted = false;
  let pollingStop: (() => void) | undefined;
  const startFallback = () => {
    if (fallbackStarted || pending.size === 0) return;
    fallbackStarted = true;
    source.close();
    pollingStop = pollImportJobs([...pending], mark, options.onDone);
  };

  source.addEventListener("job", (event) => {
    try {
      mark(JSON.parse((event as MessageEvent).data) as ImportJobStatus);
      if (pending.size === 0) source.close();
    } catch {
      startFallback();
    }
  });
  source.onerror = startFallback;

  return () => {
    source.close();
    pollingStop?.();
  };
}

function pollImportJobs(
  ids: string[],
  onJob: (job: ImportJobStatus) => void,
  onDone?: () => void,
) {
  let stopped = false;
  let timer: number | undefined;
  const pending = new Set(ids);
  const tick = async () => {
    if (stopped) return;
    await Promise.all(
      [...pending].map(async (id) => {
        try {
          const { job } = await api<{ job: ImportJobStatus }>(`/imports/${id}`);
          onJob(job);
          if (terminalImportStatuses.has(job.status)) pending.delete(id);
        } catch {
          pending.delete(id);
        }
      }),
    );
    if (pending.size === 0) {
      onDone?.();
      return;
    }
    timer = window.setTimeout(() => void tick(), 3000);
  };
  void tick();
  return () => {
    stopped = true;
    if (timer) window.clearTimeout(timer);
  };
}
