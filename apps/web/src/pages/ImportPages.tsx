import {
  CameraIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  FileArrowUpIcon,
  FileCsvIcon,
  FilePdfIcon,
  ImageSquareIcon,
  ShoppingCartIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  IconTile,
  IosButton,
  IosCard,
  IosField,
  IosPage,
  IosSegment,
  IosSheet,
  yuan,
} from "../components/ios/IosDesign";
import {
  isSupportedAttachment,
  maxAttachmentFiles,
  supportedFileAccept,
  supportedFileDescription,
} from "../features/imports/files";
import { terminalImportStatuses, watchImportJobs, type ImportJobStatus } from "../features/imports/status";
import { cancelImportJob, retryImportJob, uploadImportFiles } from "../features/imports/upload";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api } from "../lib";

type Job = ImportJobStatus & {
  fileType?: string;
  createdAt?: string;
};
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

function usePendingRecords() {
  const { book } = useActiveBook();
  const { data: jobs, reload: reloadJobs } = useApi<{ imports: Job[] }>(book ? `/books/${book.id}/imports` : undefined);
  const [records, setRecords] = useState<PendingRecord[]>([]);
  const [error, setError] = useState("");
  const pendingJobs = useMemo(() => jobs?.imports.filter((job) => job.status === "pending_confirmation") ?? [], [jobs?.imports]);

  useEffect(() => {
    let cancelled = false;
    if (!pendingJobs.length) {
      setRecords([]);
      return undefined;
    }
    void Promise.all(pendingJobs.map((job) => api<{ records: PendingRecord[] }>(`/imports/${job.id}/records`)))
      .then((results) => {
        if (!cancelled) setRecords(results.flatMap((item) => item.records.filter((record) => record.status === "pending")));
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "读取待确认记录失败");
      });
    return () => {
      cancelled = true;
    };
  }, [pendingJobs]);

  return { records, error, reload: reloadJobs };
}

export function PendingImportsPage() {
  const navigate = useNavigate();
  const { book } = useActiveBook();
  const { records, error, reload } = usePendingRecords();
  const [busy, setBusy] = useState("");
  const [editing, setEditing] = useState<PendingRecord | undefined>();
  const close = () => navigate(book ? `/records?bookId=${book.id}` : "/records");
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
      toast.error(cause instanceof Error ? cause.message : "全部确认失败", { duration: 3000, closeButton: true });
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
    <IosPage>
      <IosSheet
        title="待确认记录"
        onClose={close}
        right={
          records.length ? (
            <button className="ios-sheet-text-action" type="button" disabled={busy === "all"} onClick={() => void confirmAll()}>
              全部确认
            </button>
          ) : null
        }
      >
        <div className="ios-pending-sheet">
          <p className="ios-sheet-note">以下记录由文件识别或 AI 生成，确认后才会正式入账。低置信度字段已标记，请核对。</p>
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
    </IosPage>
  );
}

export function ImportHistoryPage() {
  const navigate = useNavigate();
  const { book } = useActiveBook();
  const { data, error, reload } = useApi<{ imports: Job[] }>(book ? `/books/${book.id}/imports` : undefined);
  const [uploading, setUploading] = useState(false);
  const [busyJobId, setBusyJobId] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const stopWatchingRef = useRef<(() => void) | undefined>(undefined);
  const close = () => navigate(book ? `/records?bookId=${book.id}` : "/records");

  useEffect(() => {
    const active = (data?.imports ?? []).filter((job) => !terminalImportStatuses.has(job.status)).map((job) => job.id);
    stopWatchingRef.current?.();
    if (!active.length) return undefined;
    stopWatchingRef.current = watchImportJobs(active, () => void reload(), {
      onDone: () => void reload(),
      onError: (message) => toast.warning(message, { duration: 3000, closeButton: true }),
    });
    return () => {
      stopWatchingRef.current?.();
      stopWatchingRef.current = undefined;
    };
  }, [data?.imports?.map((job) => `${job.id}:${job.status}`).join(","), reload]);

  const upload = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    if (!book) {
      toast.error("请先选择账本", { duration: 3000, closeButton: true });
      return;
    }
    const unsupported = files.find((file) => !isSupportedAttachment(file));
    if (unsupported) {
      toast.error("文件格式暂不支持", {
        description: `${unsupported.name} 不是支持的 ${supportedFileDescription} 格式。`,
        duration: 3000,
        closeButton: true,
      });
      return;
    }
    if (files.length > maxAttachmentFiles) {
      toast.warning(`一次最多上传 ${maxAttachmentFiles} 个文件`, { duration: 3000, closeButton: true });
    }
    setUploading(true);
    try {
      const { jobs } = await uploadImportFiles(book.id, files.slice(0, maxAttachmentFiles));
      toast.success("文件已上传", {
        description: "识别会在后台继续，完成后进入待确认。",
        duration: 3000,
        closeButton: true,
      });
      await reload();
      stopWatchingRef.current?.();
      stopWatchingRef.current = watchImportJobs(
        jobs.map((job) => job.id),
        () => void reload(),
        { onDone: () => void reload(), onError: (message) => toast.warning(message, { duration: 3000, closeButton: true }) },
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "上传失败", { duration: 3000, closeButton: true });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
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
    <IosPage>
      <IosSheet title="导入与识别" onClose={close}>
        <div className="ios-import-sheet">
          <div className="ios-import-options">
            <button type="button" onClick={() => fileInput.current?.click()}>
              <IconTile>
                <CameraIcon size={21} weight="bold" />
              </IconTile>
              <b>拍照</b>
              <small>小票 / 发票</small>
            </button>
            <button type="button" onClick={() => fileInput.current?.click()}>
              <IconTile tint="#eaf1ff" color="#4c8dff">
                <ImageSquareIcon size={21} weight="bold" />
              </IconTile>
              <b>相册</b>
              <small>图片批量</small>
            </button>
            <button type="button" onClick={() => fileInput.current?.click()}>
              <IconTile tint="#f0f2f5" color="#5b6473">
                <FileArrowUpIcon size={21} weight="bold" />
              </IconTile>
              <b>文件</b>
              <small>PDF/CSV/Excel</small>
            </button>
          </div>
          <input ref={fileInput} className="sr-only" type="file" multiple accept={supportedFileAccept} onChange={(event) => void upload(event.currentTarget.files)} />
          <p className="ios-sheet-note">
            文件在后台异步处理，你可以离开此页面。识别完成的记录会进入「待确认」，不会直接入账。
          </p>
          {uploading && (
            <IosCard className="ios-import-uploading">
              <CircleNotchIcon size={20} className="ios-spin" />
              正在上传文件…
            </IosCard>
          )}
          {error && <p className="field-error">{error}</p>}
          <section className="ios-import-jobs">
            <h3>最近任务</h3>
            {(data?.imports ?? []).map((job) => (
              <ImportJobCard
                job={job}
                busy={busyJobId === job.id}
                onRetry={() => void retry(job.id)}
                onCancel={() => void cancel(job.id)}
                key={job.id}
              />
            ))}
            {!data?.imports.length && (
              <div className="ios-empty">
                <b>还没有导入记录</b>
                <p>上传图片、PDF、Excel 或 CSV 后会显示识别进度。</p>
              </div>
            )}
          </section>
        </div>
      </IosSheet>
    </IosPage>
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
        <IconTile tint={type === "income" ? "#e8f7ef" : "#fff0e8"} color={type === "income" ? "#1f9d57" : "#ff681c"}>
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
      footer={<IosButton disabled={busy} onClick={() => onSave(draft)}>{busy ? "保存中…" : "保存修改"}</IosButton>}
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
          <input inputMode="decimal" value={draft.amount} onChange={(event) => setDraft((current) => ({ ...current, amount: event.currentTarget.value }))} />
        </IosField>
        <IosField label="类别">
          <input value={draft.categoryName} onChange={(event) => setDraft((current) => ({ ...current, categoryName: event.currentTarget.value }))} />
        </IosField>
        <IosField label="日期">
          <input type="date" value={draft.occurredAt} onChange={(event) => setDraft((current) => ({ ...current, occurredAt: event.currentTarget.value }))} />
        </IosField>
        <IosField label="备注">
          <textarea value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.currentTarget.value }))} />
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
  const tone = job.status === "failed" ? "failed" : terminalImportStatuses.has(job.status) ? "done" : "processing";
  const Icon = getJobIcon(job);
  return (
    <IosCard className={`ios-import-job ${tone}`}>
      <IconTile tint={tone === "failed" ? "#fdeceb" : tone === "done" ? "#e8f7ef" : "#eaf1ff"} color={tone === "failed" ? "#d74035" : tone === "done" ? "#1f9d57" : "#4c8dff"}>
        <Icon size={20} weight="fill" />
      </IconTile>
      <span>
        <b>{job.fileName}</b>
        <small>{job.errorMessage || formatJobStatus(job)}</small>
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

function getJobIcon(job: Job) {
  const type = `${job.fileType ?? ""} ${job.fileName ?? ""}`.toLowerCase();
  if (type.includes("pdf")) return FilePdfIcon;
  if (type.includes("csv") || type.includes("excel") || type.includes("sheet") || type.includes(".xls")) return FileCsvIcon;
  return ImageSquareIcon;
}

function formatJobStatus(job: Job) {
  if (job.status === "pending_confirmation") return "已生成待确认记录";
  if (job.status === "completed") return "处理完成";
  if (job.status === "failed") return "处理失败";
  if (job.status === "ai_processing") return "AI 正在结构化…";
  if (job.status === "ocr_processing") return formatOcrProgress(job);
  if (job.status === "converting") return "正在转换文件…";
  if (job.status === "parsing") return "正在解析文件…";
  return job.stage || "正在排队…";
}

function formatOcrProgress(job: Job) {
  if (typeof job.currentPage === "number" && typeof job.totalPages === "number") return `OCR 第 ${job.currentPage}/${job.totalPages} 页`;
  if (typeof job.progress === "number") return `OCR ${job.progress}%`;
  return "OCR 正在识别…";
}
