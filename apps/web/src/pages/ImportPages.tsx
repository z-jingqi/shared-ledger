import {
  CheckCircleIcon,
  ImageSquareIcon,
  ShoppingCartIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  IconTile,
  IosButton,
  IosCard,
  IosDialog,
  IosField,
  IosListSkeleton,
  IosSegment,
  IosSheet,
} from "../components/ios/IosDesign";
import { useAuth } from "../features/auth/AuthProvider";
import { yuan } from "../features/formatting/money";
import {
  mergeLocalImportPlaceholders,
  patchImportJobInCache,
  removeImportJobFromCache,
  replaceImportJobInCache,
  upsertImportJobsInCache,
} from "../features/imports/cache";
import { invalidateLedgerData } from "../features/data/invalidations";
import { createPreviewThumbnail } from "../features/imports/preview-thumbnail";
import {
  inactiveImportStatuses,
  terminalImportStatuses,
  watchImportJobs,
  type ImportJobStatus,
} from "../features/imports/status";
import {
  abortLocalImportUpload,
  cancelImportJob,
  continueDuplicateImportJob,
  deleteImportJob,
  retryImportJob,
  revokeUploadPlaceholderUrls,
} from "../features/imports/upload";
import { useAppSheetActions } from "../features/sheets/SheetContext";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api, ApiError, apiFetchWithRefresh } from "../lib";

type Job = ImportJobStatus & {
  fileType?: string;
  createdAt?: string;
  updatedAt?: string;
};
type JobIcon = typeof ImageSquareIcon;
type JobFilter = "all" | "review" | "processing" | "success" | "failed";
type PendingRecord = {
  id: string;
  importJobId: string;
  suggestedTransaction: {
    type?: "income" | "expense";
    note?: string;
    amount: number;
    occurredAt?: string;
    categoryName?: string;
    items?: Array<{ name: string; amount: number; categoryName?: string; note?: string }>;
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
  items: Array<{ name: string; amount: string; categoryName: string; note: string }>;
};
type PendingRecordsState = { records: PendingRecord[]; error: string; loading: boolean };
type PendingRecordsAction =
  | { type: "loading" }
  | { type: "reset" }
  | { type: "success"; records: PendingRecord[] }
  | { type: "error"; error: string };

const jobFilters: { value: JobFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "review", label: "待核对" },
  { value: "processing", label: "处理中" },
  { value: "success", label: "成功" },
  { value: "failed", label: "失败" },
];
const successStatuses = new Set(["completed", "pending_confirmation"]);
const failedStatuses = new Set(["failed"]);
const imageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif", ".avif"];
const emptyJobs: Job[] = [];
const importDayFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "short",
});
const thumbnailBlobCache = new Map<string, Blob>();
const thumbnailFailureCache = new Set<string>();
const maxThumbnailCacheSize = 48;
let activeThumbnailLoads = 0;
const thumbnailQueue: (() => void)[] = [];
function pendingRecordsReducer(_: PendingRecordsState, action: PendingRecordsAction): PendingRecordsState {
  switch (action.type) {
    case "loading":
      return { records: [], error: "", loading: true };
    case "reset":
      return { records: [], error: "", loading: false };
    case "success":
      return { records: action.records, error: "", loading: false };
    case "error":
      return { records: [], error: action.error, loading: false };
  }
}

function usePendingRecords(jobId?: string) {
  const { user } = useAuth();
  const { book } = useActiveBook();
  const {
    data: jobs,
    loading: jobsLoading,
    reload: reloadJobs,
  } = useApi<{ imports: Job[] }>(book ? `/books/${book.id}/imports` : undefined);
  const [{ records, error, loading }, dispatchRecords] = useReducer(pendingRecordsReducer, {
    records: [],
    error: "",
    loading: true,
  });
  const imports = jobs?.imports ?? emptyJobs;
  const pendingJobs = useMemo(
    () => imports.filter((job) => job.status === "pending_confirmation" && (!jobId || job.id === jobId)),
    [imports, jobId],
  );
  const hasDuplicateRecords = pendingJobs.some((job) => Boolean(job.duplicateOfJobId));

  useEffect(() => {
    let cancelled = false;
    if (!pendingJobs.length) {
      dispatchRecords(jobsLoading ? { type: "loading" } : { type: "reset" });
      return undefined;
    }
    dispatchRecords({ type: "loading" });
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
  }, [jobsLoading, pendingJobs]);

  return {
    bookId: book?.id,
    records,
    error,
    hasDuplicateRecords,
    loading,
    reload: reloadJobs,
    userId: user?.id,
  };
}

export function PendingImportsPage() {
  return <LegacyRecordsRedirect />;
}

export function PendingImportsSheet({ jobId, onClose }: { jobId?: string; onClose: () => void }) {
  const { bookId, records, error, hasDuplicateRecords, loading, reload, userId } = usePendingRecords(jobId);
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<PendingRecord | undefined>();
  const [duplicateConfirmation, setDuplicateConfirmation] = useState<
    { type: "record"; recordId: string } | { type: "all" } | undefined
  >();
  const close = onClose;
  const refreshAfterRecordChange = async (nextRecordsLength: number) => {
    invalidateLedgerData({
      bookId,
      scopes: ["imports", "transactions", "categories"],
    });
    await reload();
    if (nextRecordsLength <= 0) close();
  };
  const confirm = async (recordId: string, allowDuplicate = false) => {
    setBusy(recordId);
    try {
      const result = await api<{ job?: Job }>(`/imported-records/${recordId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ allowDuplicate }),
      });
      setDuplicateConfirmation(undefined);
      if (result.job) replaceImportJobInCache(bookId, userId, result.job);
      await refreshAfterRecordChange(records.filter((record) => record.id !== recordId).length);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "DUPLICATE_CONFIRMATION_REQUIRED") {
        setDuplicateConfirmation({ type: "record", recordId });
        return;
      }
      toast.error(cause instanceof Error ? cause.message : "确认失败", { duration: 3000, closeButton: true });
    } finally {
      setBusy("");
    }
  };
  const ignore = async (recordId: string) => {
    setBusy(recordId);
    try {
      const result = await api<{ job?: Job }>(`/imported-records/${recordId}/ignore`, { method: "POST" });
      if (result.job) replaceImportJobInCache(bookId, userId, result.job);
      await refreshAfterRecordChange(records.filter((record) => record.id !== recordId).length);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "忽略失败", { duration: 3000, closeButton: true });
    } finally {
      setBusy("");
    }
  };
  const confirmAll = async (allowDuplicate = false) => {
    if (hasDuplicateRecords && !allowDuplicate) {
      setDuplicateConfirmation({ type: "all" });
      return;
    }
    setBusy("all");
    try {
      const jobIds = [...new Set(records.map((item) => item.importJobId))];
      const results = await Promise.all(
        jobIds.map((jobId) =>
          api<{ job?: Job }>(`/imports/${jobId}/confirm-all`, {
            method: "POST",
            body: JSON.stringify({ allowDuplicate }),
          }),
        ),
      );
      setDuplicateConfirmation(undefined);
      results.forEach((result) => {
        if (result.job) replaceImportJobInCache(bookId, userId, result.job);
      });
      await refreshAfterRecordChange(0);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "DUPLICATE_CONFIRMATION_REQUIRED") {
        setDuplicateConfirmation({ type: "all" });
        return;
      }
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
          items: draft.items
            .map((item) => ({
              name: item.name.trim(),
              amount: Number(item.amount),
              categoryName: item.categoryName.trim() || undefined,
              note: item.note.trim() || undefined,
            }))
            .filter((item) => item.name && Number.isFinite(item.amount) && item.amount > 0),
          confidence: record.suggestedTransaction.confidence,
          warnings: record.suggestedTransaction.warnings,
        }),
      });
      setEditing(undefined);
      invalidateLedgerData({ bookId, scopes: ["imports"] });
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
        height="large"
        className="ios-pending-review-sheet"
        right={
          records.length > 1 ? (
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
          {loading && (
            <IosCard className="ios-pending-card">
              <IosListSkeleton rows={3} />
            </IosCard>
          )}
          {!loading && !records.length && (
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
              full={records.length === 1}
              key={record.id}
            />
          ))}
        </div>
      </IosSheet>
      {editing && (
        <PendingEditSheet
          record={editing}
          busy={busy === editing.id}
          onBack={() => setEditing(undefined)}
          onClose={() => setEditing(undefined)}
          onSave={(draft) => void updateRecord(editing, draft)}
        />
      )}
      {duplicateConfirmation && (
        <IosDialog
          title="可能是重复小票"
          message="系统发现相同图片或相同票据内容。请先核对已有记录；确认不是重复后，仍可继续入账。"
          confirmText="仍然入账"
          onCancel={() => setDuplicateConfirmation(undefined)}
          onConfirm={() => {
            if (duplicateConfirmation.type === "all") void confirmAll(true);
            else void confirm(duplicateConfirmation.recordId, true);
          }}
        />
      )}
    </>
  );
}

export function ImportHistoryPage() {
  return <LegacyRecordsRedirect />;
}

export function ImportHistorySheet({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { book } = useActiveBook();
  const { openSheet } = useAppSheetActions();
  const { data, error, reload } = useApi<{ imports: Job[]; retentionDays?: number }>(
    book ? `/books/${book.id}/imports` : undefined,
  );
  const [filter, setFilter] = useState<JobFilter>("all");
  const [busyJobId, setBusyJobId] = useState("");
  const stopWatchingRef = useRef<(() => void) | undefined>(undefined);
  const close = onClose;
  const imports = mergeLocalImportPlaceholders(book?.id, user?.id, data?.imports ?? emptyJobs);
  const filteredImports = useMemo(
    () => imports.filter((job) => matchesJobFilter(job, filter)),
    [filter, imports],
  );
  const groupedImports = useMemo(() => groupJobsByDay(filteredImports), [filteredImports]);
  const activeImports = useMemo(() => {
    const ids: string[] = [];
    const keyParts: string[] = [];
    for (const job of imports) {
      if (job.localOnly) continue;
      if (inactiveImportStatuses.has(job.status)) continue;
      ids.push(job.id);
      keyParts.push(`${job.id}:${job.status}`);
    }
    return { ids, key: keyParts.join(",") };
  }, [imports]);
  const activeImportIds = activeImports.ids;
  const activeImportKey = activeImports.key;
  const counts = useMemo(() => {
    const next = { all: imports.length, review: 0, processing: 0, success: 0, failed: 0 };
    for (const job of imports) {
      if (matchesJobFilter(job, "review")) next.review += 1;
      if (matchesJobFilter(job, "processing")) next.processing += 1;
      if (matchesJobFilter(job, "success")) next.success += 1;
      if (matchesJobFilter(job, "failed")) next.failed += 1;
    }
    return next;
  }, [imports]);

  useEffect(() => {
    stopWatchingRef.current?.();
    if (!activeImportIds.length) return undefined;
    stopWatchingRef.current = watchImportJobs(
      activeImportIds,
      (job) => {
        upsertImportJobsInCache(book?.id, user?.id, [job]);
      },
      {
        onDone: () => void reload(),
        onError: (message) => {
          toast.warning(message, { duration: 3000, closeButton: true });
          void reload();
        },
      },
    );
    return () => {
      stopWatchingRef.current?.();
      stopWatchingRef.current = undefined;
    };
  }, [activeImportKey, book?.id, reload, user?.id]);

  const retry = async (jobId: string) => {
    setBusyJobId(jobId);
    try {
      const { job } = await retryImportJob(jobId);
      if (job) replaceImportJobInCache(book?.id, user?.id, job);
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "重试失败", { duration: 3000, closeButton: true });
    } finally {
      setBusyJobId("");
    }
  };
  const continueDuplicate = async (jobId: string) => {
    setBusyJobId(jobId);
    try {
      const { job } = await continueDuplicateImportJob(jobId);
      if (job) replaceImportJobInCache(book?.id, user?.id, job);
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "继续识别失败", {
        duration: 3000,
        closeButton: true,
      });
    } finally {
      setBusyJobId("");
    }
  };
  const cancel = async (jobId: string) => {
    const localJob = imports.find((job) => job.id === jobId && job.localOnly);
    if (localJob) {
      abortLocalImportUpload(jobId);
      const removed = removeImportJobFromCache(book?.id, user?.id, jobId);
      if (removed) revokeUploadPlaceholderUrls([removed]);
      return;
    }
    setBusyJobId(jobId);
    const previous = patchImportJobInCache(book?.id, user?.id, jobId, {
      status: "cancel_requested",
      stage: "cancel_requested",
      cancelable: false,
      retryable: false,
    });
    try {
      const { job } = await cancelImportJob(jobId);
      if (job) replaceImportJobInCache(book?.id, user?.id, job);
    } catch (cause) {
      if (previous) replaceImportJobInCache(book?.id, user?.id, previous);
      toast.error(cause instanceof Error ? cause.message : "取消失败", { duration: 3000, closeButton: true });
    } finally {
      setBusyJobId("");
    }
  };
  const remove = async (jobId: string) => {
    const localJob = imports.find((job) => job.id === jobId && job.localOnly);
    if (localJob) {
      const removed = removeImportJobFromCache(book?.id, user?.id, jobId);
      if (removed) revokeUploadPlaceholderUrls([removed]);
      return;
    }
    setBusyJobId(jobId);
    const previous = removeImportJobFromCache(book?.id, user?.id, jobId);
    try {
      await deleteImportJob(jobId);
    } catch (cause) {
      if (previous) replaceImportJobInCache(book?.id, user?.id, previous);
      toast.error(cause instanceof Error ? cause.message : "删除失败", { duration: 3000, closeButton: true });
    } finally {
      setBusyJobId("");
    }
  };
  const removeMissing = useCallback(
    (jobId: string) => {
      removeImportJobFromCache(book?.id, user?.id, jobId);
    },
    [book?.id, user?.id],
  );
  const openPendingJob = async (jobId: string) => {
    setBusyJobId(jobId);
    try {
      const result = await api<{ records: PendingRecord[] }>(`/imports/${jobId}/records`);
      const pending = result.records.filter((record) => record.status === "pending");
      if (!pending.length) {
        toast.info("识别结果已处理", { duration: 2600, closeButton: true });
        await reload();
        return;
      }
      openSheet({ type: "pending-imports", jobId });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "读取待确认记录失败", {
        duration: 3000,
        closeButton: true,
      });
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
              <b>{counts.review}</b>
              待核对
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
                  onContinue={() => void continueDuplicate(job.id)}
                  onCancel={() => void cancel(job.id)}
                  onDelete={() => void remove(job.id)}
                  onConfirm={() => void openPendingJob(job.id)}
                  onMissing={removeMissing}
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
  full = false,
}: {
  record: PendingRecord;
  disabled: boolean;
  onConfirm: () => void;
  onIgnore: () => void;
  onEdit: () => void;
  full?: boolean;
}) {
  const tx = record.suggestedTransaction;
  const type = tx.type ?? "expense";
  const warning = tx.warnings.length > 0 || tx.confidence < 0.75;
  const warningText = tx.warnings.join("；");
  return (
    <IosCard className={`ios-pending-card${full ? " full" : ""}`}>
      <div className="ios-pending-fixed">
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
        {warningText ? <PendingWarning text={warningText} /> : null}
      </div>
      <div className="ios-pending-items-scroll" data-sheet-scroll="true">
        {tx.items?.length ? (
          <ul className="ios-pending-items">
            {tx.items.map((item, index) => (
              <li key={`${item.name}-${index}`}>
                <span>{item.name}</span>
                <b>{yuan(item.amount)}</b>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="ios-pending-actions">
        <button className="danger" type="button" disabled={disabled} onClick={onIgnore}>
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

function PendingWarning({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`ios-pending-warning-wrap${expanded ? " expanded" : ""}`}>
      <button
        className="ios-pending-warning"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>{text}</span>
        <em>{expanded ? "收起" : "展开"}</em>
      </button>
      {expanded ? (
        <>
          <button
            className="ios-pending-warning-backdrop"
            type="button"
            aria-label="收起警告"
            onClick={() => setExpanded(false)}
          />
          <div className="ios-pending-warning-popover">{text}</div>
        </>
      ) : null}
    </div>
  );
}

function PendingEditSheet({
  record,
  busy,
  onBack,
  onClose,
  onSave,
}: {
  record: PendingRecord;
  busy: boolean;
  onBack: () => void;
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
    items: (tx.items ?? []).map((item) => ({
      name: item.name,
      amount: String(item.amount),
      categoryName: item.categoryName ?? "",
      note: item.note ?? "",
    })),
  });
  const updateItem = (
    index: number,
    patch: Partial<{ name: string; amount: string; categoryName: string; note: string }>,
  ) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }));
  };
  const removeItem = (index: number) => {
    setDraft((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  };
  return (
    <IosSheet
      title="编辑识别记录"
      back
      onBack={onBack}
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
        <IosField label="明细">
          <div className="ios-pending-item-editor">
            {draft.items.map((item, index) => (
              <div className="ios-pending-item-edit-row" key={index}>
                <input
                  aria-label={`明细 ${index + 1} 名称`}
                  placeholder="名称"
                  value={item.name}
                  onChange={(event) => updateItem(index, { name: event.currentTarget.value })}
                />
                <input
                  aria-label={`明细 ${index + 1} 金额`}
                  inputMode="decimal"
                  placeholder="金额"
                  value={item.amount}
                  onChange={(event) => updateItem(index, { amount: event.currentTarget.value })}
                />
                <input
                  aria-label={`明细 ${index + 1} 分类`}
                  placeholder="分类"
                  value={item.categoryName}
                  onChange={(event) => updateItem(index, { categoryName: event.currentTarget.value })}
                />
                <button type="button" onClick={() => removeItem(index)}>
                  删除
                </button>
              </div>
            ))}
            <button
              className="ios-pending-add-item"
              type="button"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  items: [...current.items, { name: "", amount: "", categoryName: "", note: "" }],
                }))
              }
            >
              添加明细
            </button>
          </div>
        </IosField>
      </div>
    </IosSheet>
  );
}

function ImportJobCard({
  job,
  busy,
  onRetry,
  onContinue,
  onCancel,
  onDelete,
  onConfirm,
  onMissing,
}: {
  job: Job;
  busy: boolean;
  onRetry: () => void;
  onContinue: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onConfirm: () => void;
  onMissing?: (jobId: string) => void;
}) {
  const tone =
    job.status === "duplicate_review"
      ? "warning"
      : job.status === "failed"
        ? "failed"
        : terminalImportStatuses.has(job.status)
          ? "done"
          : "processing";
  const Icon = getJobIcon();
  const statusText = formatJobStatus(job);
  return (
    <IosCard className={`ios-import-job ${tone}`}>
      <ImportJobPreview job={job} tone={tone} fallbackIcon={Icon} onMissing={onMissing} />
      <span>
        <b>{job.fileName}</b>
        {job.status === "ai_processing" ? <AiProgressText job={job} /> : <small>{statusText}</small>}
        {job.status === "failed" && job.errorStage && (
          <em className="ios-import-error-stage">{job.errorStage}</em>
        )}
        {job.status === "failed" && job.errorMessage && <p>{job.errorMessage}</p>}
        {!inactiveImportStatuses.has(job.status) && job.status !== "ai_processing" && (
          <i>
            <em style={{ width: `${job.progress ?? 18}%` }} />
          </i>
        )}
      </span>
      <div>
        {tone === "done" && <CheckCircleIcon size={22} weight="fill" />}
        {tone === "failed" && <XCircleIcon size={22} weight="fill" />}
        {tone === "warning" && <WarningCircleIcon size={22} weight="fill" />}
        {job.status === "failed" && job.retryable && (
          <button type="button" disabled={busy} onClick={onRetry}>
            重试
          </button>
        )}
        {job.status === "pending_confirmation" && (
          <button type="button" disabled={busy} onClick={onConfirm}>
            去确认
          </button>
        )}
        {job.status === "duplicate_review" && (
          <button className="primary" type="button" disabled={busy} onClick={onContinue}>
            仍然识别
          </button>
        )}
        {!job.localOnly && !terminalImportStatuses.has(job.status) && job.status !== "duplicate_review" && (
          <button type="button" disabled={busy || job.status === "cancel_requested"} onClick={onCancel}>
            {job.status === "cancel_requested" ? "取消中" : "取消"}
          </button>
        )}
        {job.localOnly && !terminalImportStatuses.has(job.status) && (
          <button type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
        )}
        {canDeleteImportJob(job) && (
          <button type="button" disabled={busy} onClick={onDelete}>
            删除
          </button>
        )}
      </div>
    </IosCard>
  );
}

function AiProgressText({ job }: { job: Job }) {
  return <small className="ios-import-ai-progress">{job.progressText || formatJobStatus(job)}</small>;
}

function ImportJobPreview({
  job,
  tone,
  fallbackIcon: FallbackIcon,
  onMissing,
}: {
  job: Job;
  tone: "done" | "failed" | "processing" | "warning";
  fallbackIcon: JobIcon;
  onMissing?: (jobId: string) => void;
}) {
  if (!isImageJob(job)) {
    return (
      <div className={`ios-import-preview ${tone} file`}>
        <FallbackIcon size={22} weight="fill" />
        <small>{fileExtension(job.fileName)}</small>
      </div>
    );
  }
  return <ImageJobThumbnail job={job} tone={tone} fallbackIcon={FallbackIcon} onMissing={onMissing} />;
}

function ImageJobThumbnail({
  job,
  tone,
  fallbackIcon: FallbackIcon,
  onMissing,
}: {
  job: Job;
  tone: "done" | "failed" | "processing" | "warning";
  fallbackIcon: JobIcon;
  onMissing?: (jobId: string) => void;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const cacheKey = job.id;
  const unsupportedPreview = job.localOnly && !job.localPreviewUrl ? true : !canBrowserPreviewImage(job);

  useEffect(() => {
    if (job.localPreviewUrl || unsupportedPreview) return undefined;
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
      if (thumbnailFailureCache.has(cacheKey)) {
        setFailed(true);
        return;
      }
      if (thumbnailBlobCache.has(cacheKey)) {
        setBlobUrl(thumbnailBlobCache.get(cacheKey)!);
        return;
      }
      controller = new AbortController();
      void enqueueThumbnailLoad(async () => {
        if (cancelled) return;
        const response = await apiFetchWithRefresh(`/imports/${job.id}/file`, { signal: controller?.signal });
        if (response.status === 404) {
          onMissing?.(job.id);
          throw new Error("导入原文件不存在");
        }
        if (response.status === 415) {
          throw new Error("该文件类型没有图片预览");
        }
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
        if (!cancelled && !(cause instanceof DOMException && cause.name === "AbortError")) {
          thumbnailFailureCache.add(cacheKey);
          setFailed(true);
        }
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
  }, [cacheKey, job.id, job.localPreviewUrl, onMissing, unsupportedPreview]);

  return (
    <div className={`ios-import-preview ${tone}`} ref={holderRef}>
      {(job.localPreviewUrl || thumbnailUrl) && !failed && !unsupportedPreview ? (
        <img src={job.localPreviewUrl || thumbnailUrl} alt={`${job.fileName} 缩略图`} />
      ) : (
        <>
          <FallbackIcon size={22} weight="fill" />
          <small>{unsupportedPreview ? fileExtension(job.fileName) : failed ? "预览失败" : "图片"}</small>
        </>
      )}
    </div>
  );
}

function canBrowserPreviewImage(job: Job) {
  return isImageJob(job);
}

function getJobIcon() {
  return ImageSquareIcon;
}

function formatJobStatus(job: Job) {
  if (job.status === "pending_confirmation") return "已生成待确认记录";
  if (job.status === "completed") return "处理完成";
  if (job.status === "duplicate_review") return "发现相同小票，确认后可继续识别";
  if (job.status === "failed") return "处理失败";
  if (job.status === "cancel_requested") return "取消中…";
  if (job.status === "cancelled") return "已取消";
  if (job.status === "uploading") return job.progressText || "正在上传…";
  if (job.status === "uploaded") return "已上传，等待识别…";
  if (job.status === "converting") return job.progressText || "正在准备图片…";
  if (job.status === "ai_processing") return job.progressText || "AI 分析中";
  if (job.status === "ocr_processing") return formatOcrProgress(job);
  return job.stage || "处理中…";
}

function formatOcrProgress(job: Job) {
  if (job.stage === "cancel_requested") return "取消中…";
  if (job.stage === "queued") return "OCR 正在排队…";
  if (job.stage === "storing_result") return "正在保存识别结果…";
  if (typeof job.currentPage === "number" && typeof job.totalPages === "number")
    return `OCR 第 ${job.currentPage}/${job.totalPages} 页`;
  if (typeof job.progress === "number") return `OCR ${job.progress}%`;
  return "OCR 正在识别…";
}

function canDeleteImportJob(job: Job) {
  return terminalImportStatuses.has(job.status) || job.status === "duplicate_review";
}

function matchesJobFilter(job: Job, filter: JobFilter) {
  if (filter === "all") return true;
  if (filter === "review") return job.status === "duplicate_review";
  if (filter === "success") return successStatuses.has(job.status);
  if (filter === "failed") return failedStatuses.has(job.status);
  return !inactiveImportStatuses.has(job.status);
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
