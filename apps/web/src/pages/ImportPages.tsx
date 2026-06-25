import {
  FilePdfIcon,
  ImageSquareIcon,
  ShoppingCartIcon,
} from "@phosphor-icons/react";
import { Button, Panel } from "@shared-ledger/ui";
import { useEffect, useState } from "react";
import { Page } from "../components/layout/Page";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api, money } from "../lib";
import { retryImportJob } from "../features/imports/upload";

type Job = {
  id: string;
  fileName: string;
  fileType: string;
  status: string;
  createdAt: string;
  errorMessage?: string;
  errorRequestId?: string;
  retryable?: boolean;
};
type Record = {
  id: string;
  importJobId: string;
  suggestedTransaction: { note?: string; amount: number; confidence: number; warnings: string[] };
  status: string;
};

function usePendingRecords() {
  const { book } = useActiveBook();
  const { data: jobs, reload: reloadJobs } = useApi<{ imports: Job[] }>(
    book ? `/books/${book.id}/imports` : undefined,
  );
  const [records, setRecords] = useState<Record[]>([]);
  const [error, setError] = useState("");
  const reload = async () => {
    await reloadJobs();
  };
  useEffect(() => {
    const pending = jobs?.imports.filter((job) => job.status === "pending_confirmation") ?? [];
    void Promise.all(pending.map((job) => api<{ records: Record[] }>(`/imports/${job.id}/records`)))
      .then((results) =>
        setRecords(results.flatMap((item) => item.records.filter((record) => record.status === "pending"))),
      )
      .catch((cause) => setError(cause instanceof Error ? cause.message : "读取待确认记录失败"));
  }, [jobs]);
  return { records, error, reload };
}
export function PendingImportsPage() {
  const { records, error, reload } = usePendingRecords();
  const [busy, setBusy] = useState(false);
  const confirm = async (recordId: string) => {
    setBusy(true);
    try {
      await api(`/imported-records/${recordId}/confirm`, { method: "POST" });
      await reload();
    } finally {
      setBusy(false);
    }
  };
  const confirmAll = async () => {
    setBusy(true);
    try {
      const jobIds = [...new Set(records.map((item) => item.importJobId))];
      await Promise.all(jobIds.map((id) => api(`/imports/${id}/confirm-all`, { method: "POST" })));
      await reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Page
        title="待确认记录"
        action={
          <Button className="text-action" variant="ghost" disabled={busy} onClick={() => void confirmAll()}>
            全部确认
          </Button>
        }
      />
      <Panel>
        <p className="muted">智能识别结果，请确认后入账</p>
        {error && <p className="field-error">{error}</p>}
        {records.map((record) => (
          <div className="pending-row" key={record.id}>
            <span className="category-icon">
              <ShoppingCartIcon size={19} weight="fill" />
            </span>
            <div>
              <strong>{record.suggestedTransaction.note || "待确认记录"}</strong>
              <small>
                {record.suggestedTransaction.warnings.join("；") ||
                  `识别置信度 ${Math.round(record.suggestedTransaction.confidence * 100)}%`}
              </small>
            </div>
            <b>{money(record.suggestedTransaction.amount)}</b>
            <Button disabled={busy} onClick={() => void confirm(record.id)}>
              确认
            </Button>
          </div>
        ))}
        {!records.length && <p className="muted">没有待确认记录</p>}
      </Panel>
    </>
  );
}
export function ImportHistoryPage() {
  const { book } = useActiveBook();
  const { data, error, reload } = useApi<{ imports: Job[] }>(book ? `/books/${book.id}/imports` : undefined);
  const [retryingId, setRetryingId] = useState("");
  const retry = async (jobId: string) => {
    setRetryingId(jobId);
    try {
      await retryImportJob(jobId);
      await reload();
    } finally {
      setRetryingId("");
    }
  };
  return (
    <>
      <Page title="导入历史" />
      <Panel>
        {error && <p className="field-error">{error}</p>}
        {data?.imports.map((job) => (
          <div className="history-row" key={job.id}>
            {job.fileType.includes("pdf") ? <FilePdfIcon size={25} /> : <ImageSquareIcon size={25} />}
            <div>
              <strong>{job.fileName}</strong>
              <small>{job.errorMessage || new Date(job.createdAt).toLocaleString("zh-CN")}</small>
            </div>
            <span className={job.status === "completed" ? "status success" : "status"}>{job.status}</span>
            {job.status === "failed" && job.retryable && (
              <Button type="button" size="sm" disabled={retryingId === job.id} onClick={() => void retry(job.id)}>
                {retryingId === job.id ? "重试中" : "重试"}
              </Button>
            )}
          </div>
        ))}
        {!data?.imports.length && <p className="muted">还没有导入记录</p>}
      </Panel>
    </>
  );
}
