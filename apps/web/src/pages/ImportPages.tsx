import {
  CheckCircleIcon,
  CircleNotchIcon,
  ImageSquareIcon,
  ShoppingCartIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { IconTile, IosButton, IosCard, IosField, IosSegment, IosSheet } from "../components/ios/IosDesign";
import { yuan } from "../features/formatting/money";
import { createPreviewThumbnail } from "../features/imports/preview-thumbnail";
import { terminalImportStatuses, watchImportJobs, type ImportJobStatus } from "../features/imports/status";
import { cancelImportJob, retryImportJob } from "../features/imports/upload";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api, apiFetchWithRefresh } from "../lib";

type Job = ImportJobStatus & {
  fileType?: string;
  createdAt?: string;
  updatedAt?: string;
};
type JobIcon = typeof ImageSquareIcon;
type JobFilter = "all" | "processing" | "success" | "failed";
type PendingRecord = {
  id: string;
  importJobId: string;
  suggestedTransaction: {
    type?: "income" | "expense";
    note?: string;
    amount: number;
    occurredAt?: string;
    categoryName?: string;
    confidence: number;
    warnings: string[];
  };
  status: string;
};
type PendingEditDraft = {
  type: "income" | "expense";
  note: string;
  amount: string;
  occurredAt: string;
  categoryName: string;
};
type PendingRecordsState = { records: PendingRecord[]; error: string };
type PendingRecordsAction =
  | { type: "reset" }
  | { type: "success"; records: PendingRecord[] }
  | { type: "error"; error: string };

const jobFilters: { value: JobFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "processing", label: "处理中" },
  { value: "success", label: "成功" },
  { value: "failed", label: "失败" },
];
const successStatuses = new Set(["completed", "pending_confirmation"]);
const failedStatuses = new Set(["failed"]);
const imageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif"];
const emptyJobs: Job[] = [];
const importDayFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "short",
});
const thumbnailBlobCache = new Map<string, Blob>();
const maxThumbnailCacheSize = 48;
let activeThumbnailLoads = 0;
const thumbnailQueue: (() => void)[] = [];

function pendingRecordsReducer(_: PendingRecordsState, action: PendingRecordsAction): PendingRecordsState {
  switch (action.type) {
    case "reset":
      return { records: [], error: "" };
    case "success":
      return { records: action.records, error: "" };
    case "error":
      return { records: [], error: action.error };
  }
}

function usePendingRecords() {
  const { book } = useActiveBook();
  const { data: jobs, reload: reloadJobs } = useApi<{ imports: Job[] }>(
    book ? `/books/${book.id}/imports` : undefined,
  );
  const [{ records, error }, dispatchRecords] = useReducer(pendingRecordsReducer, { records: [], error: "" });
  const imports = jobs?.imports ?? emptyJobs;
  const pendingJobs = useMemo(
    () => imports.filter((job) => job.status === "pending_confirmation"),
    [imports],
  );

  useEffect(() => {
    let cancelled = false;
    if (!pendingJobs.length) {
      dispatchRecords({ type: "reset" });
      return undefined;
    }
    void Promise.all(
      pendingJobs.map((job) => api<{ records: PendingRecord[] }>(`/imports/${job.id}/records`)),
    )
      .then((results) => {
        if (!cancelled)
          dispatchRecords({
            type: "success",
            records: results.flatMap((item) => item.records.filter((record) => record.status === "pending")),
          });
      })
      .catch((cause) => {
        if (!cancelled)
          dispatchRecords({
            type: "error",
            error: cause instanceof Error ? cause.message : "读取待确认记录失败",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [pendingJobs]);

  return { records, error, reload: reloadJobs };
}

export function PendingImportsPage() {
  return <LegacyRecordsRedirect />;
}

export function PendingImportsSheet({ onClose }: { onClose: () => void }) {
  const { records, error, reload } = usePendingRecords();
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<PendingRecord | undefined>();
  const close = onClose;
  const confirm = async (recordId: string) => {
    setBusy(recordId);
    try {
      await api(`/imported-records/${recordId}/confirm`, { method: "POST" });
      toast.success("已确认入账", { duration: 2600, closeButton: true });
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "确认失败", { duration: 3000, closeButton: true });
    } finally {
      setBusy("");
    }
  };
  const ignore = async (recordId: string) => {
    setBusy(recordId);
    try {
      await api(`/imported-records/${recordId}/ignore`, { method: "POST" });
      toast.success("已忽略该记录", { duration: 2600, closeButton: true });
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "忽略失败", { duration: 3000, closeButton: true });
    } finally {
      setBusy("");
    }
  };
  const confirmAll = async () => {
    setBusy("all");
    try {
      const jobIds = [...new Set(records.map((item) => item.importJobId))];
      await Promise.all(jobIds.map((jobId) => api(`/imports/${jobId}/confirm-all`, { method: "POST" })));
      toast.success("已全部确认", { duration: 2600, closeButton: true });
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "全部确认失败", {
        duration: 3000,
        closeButton: true,
      });
    } finally {
      setBusy("");
    }
  };
  const updateRecord = async (record: PendingRecord, draft: PendingEditDraft) => {
    setBusy(record.id);
    try {
      await api(`/imported-records/${record.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          type: draft.type,
          note: draft.note.trim() || undefined,
          amount: Number(draft.amount),
          occurredAt: draft.occurredAt,
          categoryName: draft.categoryName.trim() || undefined,
          confidence: record.suggestedTransaction.confidence,
          warnings: record.suggestedTransaction.warnings,
        }),
      });
      setEditing(undefined);
      toast.success("识别记录已更新", { duration: 2600, closeButton: true });
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "保存失败", { duration: 3000, closeButton: true });
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <IosSheet
        title="待确认记录"
        onClose={close}
        right={
          records.length ? (
            <button
              className="ios-sheet-text-action"
              type="button"
              disabled={busy === "all"}
              onClick={() => void confirmAll()}
            >
              全部确认
            </button>
          ) : null
        }
      >
        <div className="ios-pending-sheet">
          <p className="ios-sheet-note">
            以下记录由图片识别或 AI 生成，确认后才会正式入账。低置信度字段已标记，请核对。
          </p>
          {error && <p className="field-error">{error}</p>}
          {!records.length && (
            <div className="ios-empty">
              <b>没有待确认记录</b>
              <p>所有识别结果都已处理。</p>
            </div>
          )}
          {records.map((record) => (
            <PendingRecordCard
              record={record}
              disabled={Boolean(busy)}
              onConfirm={() => void confirm(record.id)}
              onIgnore={() => void ignore(record.id)}
              onEdit={() => setEditing(record)}
              key={record.id}
            />
          ))}
        </div>
      </IosSheet>
      {editing && (
        <PendingEditSheet
          record={editing}
          busy={busy === editing.id}
          onClose={() => setEditing(undefined)}
          onSave={(draft) => void updateRecord(editing, draft)}
        />
      )}
    </>
  );
}

export function ImportHistoryPage() {
  return <LegacyRecordsRedirect />;
}

export function ImportHistorySheet({ onClose }: { onClose: () => void }) {
  const { book } = useActiveBook();
  const { data, error, reload } = useApi<{ imports: Job[]; retentionDays?: number }>(
    book ? `/books/${book.id}/imports` : undefined,
  );
  const [filter, setFilter] = useState<JobFilter>("all");
  const [busyJobId, setBusyJobId] = useState("");
  const stopWatchingRef = useRef<(() => void) | undefined>(undefined);
  const close = onClose;
  const imports = data?.imports ?? emptyJobs;
  const filteredImports = useMemo(
    () => imports.filter((job) => matchesJobFilter(job, filter)),
    [filter, imports],
  );
  const groupedImports = useMemo(() => groupJobsByDay(filteredImports), [filteredImports]);
  const activeImports = useMemo(() => {
    const ids: string[] = [];
    const keyParts: string[] = [];
    for (const job of imports) {
      if (terminalImportStatuses.has(job.status)) continue;
      ids.push(job.id);
      keyParts.push(`${job.id}:${job.status}`);
    }
    return { ids, key: keyParts.join(",") };
  }, [imports]);
  const activeImportIds = activeImports.ids;
  const activeImportKey = activeImports.key;
  const counts = useMemo(() => {
    const next = { all: imports.length, processing: 0, success: 0, failed: 0 };
    for (const job of imports) {
      if (matchesJobFilter(job, "processing")) next.processing += 1;
      if (matchesJobFilter(job, "success")) next.success += 1;
      if (matchesJobFilter(job, "failed")) next.failed += 1;
    }
    return next;
  }, [imports]);

  useEffect(() => {
    stopWatchingRef.current?.();
    if (!activeImportIds.length) return undefined;
    stopWatchingRef.current = watchImportJobs(activeImportIds, () => void reload(), {
      onDone: () => void reload(),
      onError: (message) => toast.warning(message, { duration: 3000, closeButton: true }),
    });
    return () => {
      stopWatchingRef.current?.();
      stopWatchingRef.current = undefined;
    };
  }, [activeImportIds, activeImportKey, reload]);

  const retry = async (jobId: string) => {
    setBusyJobId(jobId);
    try {
      await retryImportJob(jobId);
      toast.success("已重新开始识别", { duration: 2600, closeButton: true });
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "重试失败", { duration: 3000, closeButton: true });
    } finally {
      setBusyJobId("");
    }
  };
  const cancel = async (jobId: string) => {
    setBusyJobId(jobId);
    try {
      await cancelImportJob(jobId);
      toast.success("已取消导入", { duration: 2600, closeButton: true });
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "取消失败", { duration: 3000, closeButton: true });
    } finally {
      setBusyJobId("");
    }
  };

  return (
    <IosSheet title="识别进度" onClose={close}>
      <div className="ios-import-sheet">
        <section className="ios-import-hero">
          <p>
            图片会在后台异步识别，完成后进入「待确认」，不会直接入账。这里只保留最近{" "}
            {data?.retentionDays ?? 7} 天任务。
          </p>
          <div className="ios-import-stats" aria-label="识别任务统计">
            <span>
              <b>{counts.processing}</b>
              处理中
            </span>
            <span>
              <b>{counts.success}</b>
              成功
            </span>
            <span>
              <b>{counts.failed}</b>
              失败
            </span>
          </div>
        </section>
        <div className="ios-import-filter" role="tablist" aria-label="识别状态筛选">
          {jobFilters.map((item) => (
            <button
              className={filter === item.value ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={filter === item.value}
              onClick={() => setFilter(item.value)}
              key={item.value}
            >
              {item.label}
              <em>{counts[item.value]}</em>
            </button>
          ))}
        </div>
        {error && <p className="field-error">{error}</p>}
        <section className="ios-import-jobs">
          {groupedImports.map((group) => (
            <div className="ios-import-day" key={group.key}>
              <h3>{group.label}</h3>
              {group.jobs.map((job) => (
                <ImportJobCard
                  job={job}
                  busy={busyJobId === job.id}
                  onRetry={() => void retry(job.id)}
                  onCancel={() => void cancel(job.id)}
                  key={job.id}
                />
              ))}
            </div>
          ))}
          {!imports.length && (
            <div className="ios-empty">
              <b>还没有图片识别记录</b>
              <p>从底部加号上传图片后会显示识别进度。</p>
            </div>
          )}
          {imports.length > 0 && !filteredImports.length && (
            <div className="ios-empty">
              <b>没有{jobFilters.find((item) => item.value === filter)?.label}任务</b>
              <p>切换其它状态查看最近 7 天的识别任务。</p>
            </div>
          )}
        </section>
      </div>
    </IosSheet>
  );
}

function PendingRecordCard({
  record,
  disabled,
  onConfirm,
  onIgnore,
  onEdit,
}: {
  record: PendingRecord;
  disabled: boolean;
  onConfirm: () => void;
  onIgnore: () => void;
  onEdit: () => void;
}) {
  const tx = record.suggestedTransaction;
  const type = tx.type ?? "expense";
  const warning = tx.warnings.length > 0 || tx.confidence < 0.75;
  return (
    <IosCard className="ios-pending-card">
      <div className="ios-pending-main">
        <IconTile
          tint={type === "income" ? "#e8f7ef" : "#fff0e8"}
          color={type === "income" ? "#1f9d57" : "#ff681c"}
        >
          <ShoppingCartIcon size={18} weight="fill" />
        </IconTile>
        <span>
          <b>{tx.note || "待确认记录"}</b>
          <small>
            {tx.categoryName || (type === "income" ? "收入" : "支出")}
            {warning ? <em>待核对</em> : null}
            {tx.occurredAt ? ` · ${tx.occurredAt.slice(0, 10)}` : ""}
          </small>
        </span>
        <strong className={type}>
          {type === "income" ? "+" : "-"}
          {yuan(tx.amount)}
        </strong>
      </div>
      {tx.warnings.length > 0 && <p className="ios-pending-warning">{tx.warnings.join("；")}</p>}
      <div className="ios-pending-actions">
        <button type="button" disabled={disabled} onClick={onIgnore}>
          忽略
        </button>
        <button type="button" disabled={disabled} onClick={onEdit}>
          编辑
        </button>
        <button type="button" disabled={disabled} onClick={onConfirm}>
          确认
        </button>
      </div>
    </IosCard>
  );
}

function PendingEditSheet({
  record,
  busy,
  onClose,
  onSave,
}: {
  record: PendingRecord;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: PendingEditDraft) => void;
}) {
  const tx = record.suggestedTransaction;
  const [draft, setDraft] = useState<PendingEditDraft>({
    type: tx.type ?? "expense",
    note: tx.note ?? "",
    amount: String(tx.amount ?? ""),
    occurredAt: tx.occurredAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    categoryName: tx.categoryName ?? "",
  });
  return (
    <IosSheet
      title="编辑识别记录"
      onClose={onClose}
      footer={
        <IosButton disabled={busy} onClick={() => onSave(draft)}>
          {busy ? "保存中…" : "保存修改"}
        </IosButton>
      }
    >
      <div className="ios-pending-edit">
        <IosField label="类型">
          <IosSegment
            value={draft.type}
            onChange={(value) => setDraft((current) => ({ ...current, type: value }))}
            options={[
              { value: "expense", label: "支出" },
              { value: "income", label: "收入" },
            ]}
          />
        </IosField>
        <IosField label="金额">
          <input
            aria-label="金额"
            inputMode="decimal"
            value={draft.amount}
            onChange={(event) => setDraft((current) => ({ ...current, amount: event.currentTarget.value }))}
          />
        </IosField>
        <IosField label="类别">
          <input
            aria-label="类别"
            value={draft.categoryName}
            onChange={(event) =>
              setDraft((current) => ({ ...current, categoryName: event.currentTarget.value }))
            }
          />
        </IosField>
        <IosField label="日期">
          <input
            aria-label="日期"
            type="date"
            value={draft.occurredAt}
            onChange={(event) =>
              setDraft((current) => ({ ...current, occurredAt: event.currentTarget.value }))
            }
          />
        </IosField>
        <IosField label="备注">
          <textarea
            aria-label="备注"
            value={draft.note}
            onChange={(event) => setDraft((current) => ({ ...current, note: event.currentTarget.value }))}
          />
        </IosField>
      </div>
    </IosSheet>
  );
}

function ImportJobCard({
  job,
  busy,
  onRetry,
  onCancel,
}: {
  job: Job;
  busy: boolean;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const tone =
    job.status === "failed" ? "failed" : terminalImportStatuses.has(job.status) ? "done" : "processing";
  const Icon = getJobIcon();
  const statusText = formatJobStatus(job);
  return (
    <IosCard className={`ios-import-job ${tone}`}>
      <ImportJobPreview job={job} tone={tone} fallbackIcon={Icon} />
      <span>
        <b>{job.fileName}</b>
        <small>{statusText}</small>
        {job.status === "failed" && job.errorStage && (
          <em className="ios-import-error-stage">{job.errorStage}</em>
        )}
        {job.status === "failed" && job.errorMessage && <p>{job.errorMessage}</p>}
        {!terminalImportStatuses.has(job.status) && (
          <i>
            <em style={{ width: `${job.progress ?? 18}%` }} />
          </i>
        )}
      </span>
      <div>
        {tone === "done" && <CheckCircleIcon size={22} weight="fill" />}
        {tone === "failed" && <XCircleIcon size={22} weight="fill" />}
        {tone === "processing" && <CircleNotchIcon size={22} className="ios-spin" />}
        {job.status === "failed" && job.retryable && (
          <button type="button" disabled={busy} onClick={onRetry}>
            重试
          </button>
        )}
        {!terminalImportStatuses.has(job.status) && job.cancelable && (
          <button type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
        )}
      </div>
    </IosCard>
  );
}

function ImportJobPreview({
  job,
  tone,
  fallbackIcon: FallbackIcon,
}: {
  job: Job;
  tone: "done" | "failed" | "processing";
  fallbackIcon: JobIcon;
}) {
  if (!isImageJob(job)) {
    return (
      <div className={`ios-import-preview ${tone} file`}>
        <FallbackIcon size={22} weight="fill" />
        <small>{fileExtension(job.fileName)}</small>
      </div>
    );
  }
  return <ImageJobThumbnail job={job} tone={tone} fallbackIcon={FallbackIcon} />;
}

function ImageJobThumbnail({
  job,
  tone,
  fallbackIcon: FallbackIcon,
}: {
  job: Job;
  tone: "done" | "failed" | "processing";
  fallbackIcon: JobIcon;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const cacheKey = `${job.id}:${job.updatedAt ?? job.createdAt ?? ""}`;

  useEffect(() => {
    const element = holderRef.current;
    if (!element) return undefined;
    let cancelled = false;
    let controller: AbortController | undefined;
    let objectUrl = "";
    const setBlobUrl = (blob: Blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setThumbnailUrl(objectUrl);
    };
    const load = () => {
      if (thumbnailBlobCache.has(cacheKey)) {
        setBlobUrl(thumbnailBlobCache.get(cacheKey)!);
        return;
      }
      controller = new AbortController();
      void enqueueThumbnailLoad(async () => {
        if (cancelled) return;
        const response = await apiFetchWithRefresh(`/imports/${job.id}/file`, { signal: controller?.signal });
        if (!response.ok) throw new Error("图片预览读取失败");
        const source = await response.blob();
        const thumbnail = await createPreviewThumbnail(source, {
          maxWidth: 240,
          maxHeight: 240,
          signal: controller?.signal,
        });
        if (cancelled) return;
        rememberThumbnail(cacheKey, thumbnail);
        setBlobUrl(thumbnail);
      }).catch((cause) => {
        if (!cancelled && !(cause instanceof DOMException && cause.name === "AbortError")) setFailed(true);
      });
    };

    if (typeof IntersectionObserver === "undefined") {
      load();
      return () => {
        cancelled = true;
        controller?.abort();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      controller?.abort();
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cacheKey, job.id]);

  return (
    <div className={`ios-import-preview ${tone}`} ref={holderRef}>
      {thumbnailUrl && !failed ? (
        <img src={thumbnailUrl} alt={`${job.fileName} 缩略图`} />
      ) : (
        <>
          <FallbackIcon size={22} weight="fill" />
          <small>{failed ? "预览失败" : "图片"}</small>
        </>
      )}
    </div>
  );
}

function getJobIcon() {
  return ImageSquareIcon;
}

function formatJobStatus(job: Job) {
  if (job.status === "pending_confirmation") return "已生成待确认记录";
  if (job.status === "completed") return "处理完成";
  if (job.status === "failed") return "处理失败";
  if (job.status === "ai_processing") return "AI 正在结构化…";
  if (job.status === "ocr_processing") return formatOcrProgress(job);
  return job.stage || "正在排队…";
}

function formatOcrProgress(job: Job) {
  if (job.stage === "storing_result") return "正在保存识别结果…";
  if (typeof job.currentPage === "number" && typeof job.totalPages === "number")
    return `OCR 第 ${job.currentPage}/${job.totalPages} 页`;
  if (typeof job.progress === "number") return `OCR ${job.progress}%`;
  return "OCR 正在识别…";
}

function matchesJobFilter(job: Job, filter: JobFilter) {
  if (filter === "all") return true;
  if (filter === "success") return successStatuses.has(job.status);
  if (filter === "failed") return failedStatuses.has(job.status);
  return !terminalImportStatuses.has(job.status);
}

function groupJobsByDay(jobs: Job[]) {
  const groups = new Map<string, { key: string; label: string; jobs: Job[] }>();
  jobs.forEach((job) => {
    const date = new Date(job.createdAt ?? Date.now());
    const key = Number.isNaN(date.getTime()) ? "unknown" : date.toISOString().slice(0, 10);
    const label = key === "unknown" ? "未知时间" : importDayFormatter.format(date);
    const group = groups.get(key) ?? { key, label, jobs: [] };
    group.jobs.push(job);
    groups.set(key, group);
  });
  return [...groups.values()];
}

function isImageJob(job: Job) {
  const type = `${job.fileType ?? ""}`.toLowerCase();
  const name = `${job.fileName ?? ""}`.toLowerCase();
  return type.startsWith("image/") || imageExtensions.some((extension) => name.endsWith(extension));
}

function fileExtension(fileName: string) {
  const extension = fileName.split(".").pop()?.trim().toUpperCase();
  return extension && extension !== fileName.toUpperCase() ? extension.slice(0, 5) : "FILE";
}

function rememberThumbnail(key: string, blob: Blob) {
  thumbnailBlobCache.delete(key);
  thumbnailBlobCache.set(key, blob);
  while (thumbnailBlobCache.size > maxThumbnailCacheSize) {
    const oldest = thumbnailBlobCache.keys().next().value;
    if (!oldest) break;
    thumbnailBlobCache.delete(oldest);
  }
}

function enqueueThumbnailLoad<T>(task: () => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeThumbnailLoads += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeThumbnailLoads -= 1;
          thumbnailQueue.shift()?.();
        });
    };
    if (activeThumbnailLoads < 3) run();
    else thumbnailQueue.push(run);
  });
}

function LegacyRecordsRedirect() {
  const [searchParams] = useSearchParams();
  const bookId = searchParams.get("bookId");
  return <Navigate to={`/records${bookId ? `?bookId=${encodeURIComponent(bookId)}` : ""}`} replace />;
}
