import {
  CaretRightIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
  FileArrowUpIcon,
  FilePdfIcon,
  ImageSquareIcon,
  ScanIcon,
  ShoppingCartIcon,
} from "@phosphor-icons/react";
import { Panel } from "@shared-ledger/ui";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Page } from "../components/layout/Page";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api, money } from "../lib";

type Job = { id: string; fileName: string; fileType: string; status: string; createdAt: string };
type Record = {
  id: string;
  importJobId: string;
  suggestedTransaction: { note?: string; amount: number; confidence: number; warnings: string[] };
  status: string;
};
export function ImportsPage() {
  const input = useRef<HTMLInputElement>(null);
  const { book } = useActiveBook();
  const { data, reload } = useApi<{ imports: Job[] }>(book ? `/books/${book.id}/imports` : undefined);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const upload = async (file?: File) => {
    if (!file || !book) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api(`/books/${book.id}/imports`, { method: "POST", body: form });
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };
  const pending = data?.imports.filter((item) => item.status === "pending_confirmation").length ?? 0;
  const recent = data?.imports.slice(0, 3) ?? [];
  return (
    <>
      <Page title="导入" back={false} />
      <Panel className="upload-zone">
        <FileArrowUpIcon size={58} weight="duotone" />
        <h2>上传账单或图片</h2>
        <p>图片 / PDF / Excel / CSV</p>
        <input
          ref={input}
          type="file"
          hidden
          accept="image/jpeg,image/png,image/webp,image/heic,application/pdf,text/csv,.xlsx,.xls"
          onChange={(event) => void upload(event.target.files?.[0])}
        />
      </Panel>
      {error && <p className="field-error">{error}</p>}
      <section className="import-steps">
        <h2>导入说明</h2>
        <ImportStep index={1} Icon={CloudArrowUpIcon} title="上传文件" desc="支持图片、PDF、Excel、CSV 格式" />
        <ImportStep index={2} Icon={ScanIcon} title="智能识别" desc="自动识别账单信息并分类" />
        <ImportStep index={3} Icon={CheckCircleIcon} title="确认入账" desc="核对信息后，确认导入账本" />
      </section>
      <Link className="sub-action" to="/imports/pending">
        待确认记录 <b>{pending}</b>
        <CaretRightIcon />
      </Link>
      <section className="recent-imports">
        <header className="section-header">
          <h2>最近导入</h2>
          <Link to="/imports/history">
            全部记录 <CaretRightIcon />
          </Link>
        </header>
        <Panel>
          {recent.map((job) => (
            <div className="history-row" key={job.id}>
              {job.fileType.includes("pdf") ? <FilePdfIcon size={27} /> : <ImageSquareIcon size={27} />}
              <div>
                <strong>{job.fileName}</strong>
                <small>{new Date(job.createdAt).toLocaleString("zh-CN")}</small>
              </div>
              <span className={job.status === "completed" ? "status success" : "status"}>{job.status}</span>
              <CaretRightIcon />
            </div>
          ))}
          {!recent.length && <p className="muted">还没有导入记录</p>}
        </Panel>
      </section>
      <button className="primary-wide" disabled={uploading || !book} onClick={() => input.current?.click()}>
        {uploading ? "正在上传…" : "选择文件"}
      </button>
    </>
  );
}
function ImportStep({
  index,
  Icon,
  title,
  desc,
}: {
  index: number;
  Icon: typeof CloudArrowUpIcon;
  title: string;
  desc: string;
}) {
  return (
    <div>
      <em>{index}</em>
      <Icon size={28} />
      <span>
        <strong>{title}</strong>
        <small>{desc}</small>
      </span>
    </div>
  );
}
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
          <button className="text-action" disabled={busy} onClick={() => void confirmAll()}>
            全部确认
          </button>
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
            <button disabled={busy} onClick={() => void confirm(record.id)}>
              确认
            </button>
          </div>
        ))}
        {!records.length && <p className="muted">没有待确认记录</p>}
      </Panel>
    </>
  );
}
export function ImportHistoryPage() {
  const { book } = useActiveBook();
  const { data, error } = useApi<{ imports: Job[] }>(book ? `/books/${book.id}/imports` : undefined);
  return (
    <>
      <Page title="导入历史" />
      <Panel>
        {error && <p className="field-error">{error}</p>}
        {data?.imports.map((job) => (
          <div className="history-row" key={job.id}>
            <FileArrowUpIcon size={25} />
            <div>
              <strong>{job.fileName}</strong>
              <small>{new Date(job.createdAt).toLocaleString("zh-CN")}</small>
            </div>
            <span className={job.status === "completed" ? "status success" : "status"}>{job.status}</span>
          </div>
        ))}
        {!data?.imports.length && <p className="muted">还没有导入记录</p>}
      </Panel>
    </>
  );
}
