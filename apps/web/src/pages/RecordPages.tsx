import {
  CalendarBlankIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  CopyIcon,
  FunnelSimpleIcon,
  NotePencilIcon,
  PaperclipIcon,
  PlusCircleIcon,
  ReceiptIcon,
  SparkleIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BookSwitcherSheet } from "../components/books/BookSwitcherSheet";
import type { LedgerTransaction } from "../components/ledger/Transactions";
import {
  AiSparkButton,
  IconTile,
  IosButton,
  IosCard,
  IosDialog,
  IosField,
  IosPage,
  IosScroll,
  IosSegment,
  IosSheet,
  IosTopBar,
  yuan,
} from "../components/ios/IosDesign";
import { searchTransactionsWithAi, type AiTransactionSearchResponse } from "../features/ai/search";
import { useAuth } from "../features/auth/AuthProvider";
import {
  isSupportedAttachment,
  maxAttachmentFiles,
  supportedFileAccept,
  supportedFileDescription,
} from "../features/imports/files";
import { terminalImportStatuses, watchImportJobs, type ImportJobStatus } from "../features/imports/status";
import { uploadImportFiles } from "../features/imports/upload";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api } from "../lib";

type CategoryOption = { id: string; name: string; type?: "expense" | "income"; icon?: string };
type RecordFilterType = "all" | "expense" | "income";
type RecordSort = "latest" | "amount_desc";
type RecordFilterSource = "" | "ai";
type RecordFilters = {
  q: string;
  type: RecordFilterType;
  sort: RecordSort;
  start: string;
  end: string;
  min: string;
  max: string;
  category: string;
  source: RecordFilterSource;
  chips: string[];
  minStrict: boolean;
  maxStrict: boolean;
};
type LineItemValue = { name: string; amount: number; categoryId?: string; note?: string };
type RecordDraft = {
  type: "income" | "expense";
  amount?: number | "";
  occurredAt: string;
  note?: string;
  categoryId?: string;
  items: LineItemValue[];
};
type FormAttachment = {
  id: string;
  file: File;
  previewUrl?: string;
  status: "idle" | "uploading" | "processing" | "completed" | "failed";
  jobId?: string;
  errorMessage?: string;
  progress?: number;
};

const recordTypeFilterOptions: Array<{ label: string; value: RecordFilterType }> = [
  { label: "全部", value: "all" },
  { label: "支出", value: "expense" },
  { label: "收入", value: "income" },
];

const recordSortOptions: Array<{ label: string; value: RecordSort }> = [
  { label: "最新优先", value: "latest" },
  { label: "金额最高", value: "amount_desc" },
];

export function RecordsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readRecordFilters(searchParams);
  const [searchText, setSearchText] = useState(filters.q);
  const [aiSearching, setAiSearching] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [bookSwitcherOpen, setBookSwitcherOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState(filters);
  const { user } = useAuth();
  const { book, books, setActiveBook } = useActiveBook();
  const { data } = useApi<{ transactions: LedgerTransaction[] }>(book ? `/books/${book.id}/transactions` : undefined);
  const { data: categories } = useApi<{ categories: CategoryOption[] }>(book ? `/books/${book.id}/categories` : undefined);
  const { data: imports, reload: reloadImports } = useApi<{ imports: ImportJobStatus[] }>(book ? `/books/${book.id}/imports` : undefined);

  const categoryNames = useMemo(
    () => Object.fromEntries((categories?.categories ?? []).map((item) => [item.id, item.name])),
    [categories?.categories],
  );
  const activeImports = (imports?.imports ?? []).filter(isActiveImport);
  const pendingCount = (imports?.imports ?? []).filter((item) => item.status === "pending_confirmation").length;
  const failedCount = (imports?.imports ?? []).filter((item) => item.status === "failed").length;
  const visibleTransactions = useMemo(
    () =>
      (data?.transactions ?? [])
        .filter((item) => matchesRecordFilters(item, filters, categoryNames))
        .sort((a, b) => compareRecordTransactions(a, b, filters.sort)),
    [categoryNames, data?.transactions, filters],
  );
  const groups = useMemo(() => groupTransactions(visibleTransactions), [visibleTransactions]);
  const canUseAiSearch = user?.plan === "pro";

  useEffect(() => setSearchText(filters.q), [filters.q]);
  useEffect(() => {
    const ids = activeImports.map((job) => job.id);
    if (!ids.length) return undefined;
    return watchImportJobs(
      ids,
      (job) => {
        if (terminalImportStatuses.has(job.status)) void reloadImports();
      },
      { onDone: () => void reloadImports() },
    );
  }, [activeImports.map((job) => `${job.id}:${job.status}`).join(","), reloadImports]);

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) {
      resetFilters();
      return;
    }
    if (!canUseAiSearch) {
      setSearchParams(writeRecordFilters(searchParams, { ...filters, q: query, source: "", chips: [] }));
      return;
    }
    if (!book) {
      toast.error("请先选择账本", { duration: 3000, closeButton: true });
      return;
    }
    setAiSearching(true);
    try {
      const result = await searchTransactionsWithAi({
        bookId: book.id,
        query,
        baseFilters: buildAiBaseFilters(filters),
        timeZone: getClientTimeZone(),
      });
      setSearchParams(writeRecordFilters(searchParams, mergeAiSearchResult(filters, query, result)));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "AI 搜索失败", { duration: 3000, closeButton: true });
    } finally {
      setAiSearching(false);
    }
  };
  const openFilters = () => {
    setDraftFilters(filters);
    setFilterOpen(true);
  };
  const resetFilters = () => {
    setSearchText("");
    setSearchParams(clearRecordFilterParams(searchParams));
  };
  const applyFilters = () => {
    setSearchParams(writeRecordFilters(searchParams, draftFilters));
    setFilterOpen(false);
  };
  const switchBook = (bookId: string) => {
    setActiveBook(bookId);
    setBookSwitcherOpen(false);
  };

  return (
    <IosPage className="ios-records-page">
      <IosTopBar
        book={book}
        onLedgerClick={() => setBookSwitcherOpen(true)}
        action={
          <div className="ios-top-actions">
            <button type="button" aria-label="筛选记录" onClick={openFilters}>
              <FunnelSimpleIcon size={21} weight="bold" />
            </button>
            {canUseAiSearch && <AiSparkButton onClick={() => navigate(book ? `/ai?bookId=${book.id}` : "/ai")} />}
          </div>
        }
      />
      <IosScroll className="ios-record-scroll">
        <form className={`ios-record-search${canUseAiSearch ? " has-ai" : ""}`} onSubmit={(event) => void submitSearch(event)}>
          <input
            aria-label="搜索流水"
            placeholder={canUseAiSearch ? "搜索记录，或用 AI 说：上月餐饮大于 100" : "搜索记录"}
            value={searchText}
            onChange={(event) => {
              const { value } = event.currentTarget;
              setSearchText(value);
            }}
          />
          {canUseAiSearch && (
            <button type="submit" disabled={aiSearching || !book} aria-label="开始搜索">
              {aiSearching ? <CircleNotchIcon size={18} className="ios-spin" /> : <SparkleIcon size={17} weight="fill" />}
            </button>
          )}
        </form>

        <div className="ios-filter-chips" aria-label="记录类型筛选">
          {recordTypeFilterOptions.map((option) => (
            <button
              className={filters.type === option.value ? "active" : ""}
              type="button"
              onClick={() => setSearchParams(writeRecordFilters(searchParams, { ...filters, type: option.value }))}
              key={option.value}
            >
              {option.label}
            </button>
          ))}
        </div>

        {(activeImports.length > 0 || pendingCount > 0 || failedCount > 0) && (
          <section className="ios-section">
            <h2>待处理</h2>
            <div className="ios-reminder-list">
              {activeImports.length > 0 && (
                <Link className="ios-reminder-row" to={`/records/imports${book ? `?bookId=${book.id}` : ""}`}>
                  <IconTile tint="#eaf1ff" color="#4c8dff">
                    {activeImports.length}
                  </IconTile>
                  <span>
                    <b>{activeImports.length} 个文件正在识别</b>
                    <small>{formatActiveImportSummary(activeImports)}</small>
                  </span>
                  <CaretRightIcon size={18} />
                </Link>
              )}
              {pendingCount > 0 && (
                <Link className="ios-reminder-row" to={`/records/pending${book ? `?bookId=${book.id}` : ""}`}>
                  <IconTile>{pendingCount}</IconTile>
                  <span>
                    <b>{pendingCount} 条待确认记录</b>
                    <small>来自文件识别与 AI — 需你审核入账</small>
                  </span>
                  <CaretRightIcon size={18} />
                </Link>
              )}
              {failedCount > 0 && (
                <Link className="ios-reminder-row danger" to={`/records/imports${book ? `?bookId=${book.id}` : ""}`}>
                  <IconTile tint="#fdeceb" color="#d74035">
                    !
                  </IconTile>
                  <span>
                    <b>{failedCount} 个文件处理失败</b>
                    <small>查看失败原因或重试</small>
                  </span>
                  <CaretRightIcon size={18} />
                </Link>
              )}
            </div>
          </section>
        )}

        <section className="ios-record-groups">
          {groups.map((group) => (
            <article key={group.key}>
              <header>
                <h2>{group.label}</h2>
                <span>
                  收入 {yuan(sum(group.items, "income"), book?.currency)}
                  <b>支出 {yuan(sum(group.items, "expense"), book?.currency)}</b>
                </span>
              </header>
              <IosCard className="ios-record-list">
                {group.items.map((transaction) => (
                  <TransactionRow transaction={transaction} categoryNames={categoryNames} currency={book?.currency} key={transaction.id} />
                ))}
              </IosCard>
            </article>
          ))}
          {!groups.length && (
            <div className="ios-empty">
              <b>没有找到记录</b>
              <p>换个筛选条件，或点底部加号记下第一笔。</p>
            </div>
          )}
        </section>
      </IosScroll>

      {filterOpen && (
        <IosSheet
          title="筛选流水"
          onClose={() => setFilterOpen(false)}
          footer={
            <div className="ios-sheet-actions">
              <IosButton variant="outline" onClick={resetFilters}>
                重置
              </IosButton>
              <IosButton onClick={applyFilters}>应用筛选</IosButton>
            </div>
          }
        >
          <div className="ios-filter-sheet">
            <IosField label="类型">
              <IosSegment
                value={draftFilters.type}
                onChange={(value) => setDraftFilters((current) => ({ ...current, type: value }))}
                options={recordTypeFilterOptions}
              />
            </IosField>
            <IosField label="排序">
              <IosSegment
                value={draftFilters.sort}
                onChange={(value) => setDraftFilters((current) => ({ ...current, sort: value }))}
                options={recordSortOptions}
              />
            </IosField>
            <div className="ios-filter-grid">
              <IosField label="开始日期">
                <input
                  type="date"
                  value={draftFilters.start}
                  onChange={(event) => {
                    const { value } = event.currentTarget;
                    setDraftFilters((current) => ({ ...current, start: value }));
                  }}
                />
              </IosField>
              <IosField label="结束日期">
                <input
                  type="date"
                  value={draftFilters.end}
                  onChange={(event) => {
                    const { value } = event.currentTarget;
                    setDraftFilters((current) => ({ ...current, end: value }));
                  }}
                />
              </IosField>
              <IosField label="最小金额">
                <input
                  inputMode="decimal"
                  value={draftFilters.min}
                  onChange={(event) => {
                    const { value } = event.currentTarget;
                    setDraftFilters((current) => ({ ...current, min: value }));
                  }}
                />
              </IosField>
              <IosField label="最大金额">
                <input
                  inputMode="decimal"
                  value={draftFilters.max}
                  onChange={(event) => {
                    const { value } = event.currentTarget;
                    setDraftFilters((current) => ({ ...current, max: value }));
                  }}
                />
              </IosField>
            </div>
            <IosField label="分类关键词">
              <input
                value={draftFilters.category}
                placeholder="餐饮 / 交通 / 工资"
                onChange={(event) => {
                  const { value } = event.currentTarget;
                  setDraftFilters((current) => ({ ...current, category: value }));
                }}
              />
            </IosField>
          </div>
        </IosSheet>
      )}
      {bookSwitcherOpen && (
        <BookSwitcherSheet
          books={books}
          currentBookId={book?.id ?? ""}
          onSelect={switchBook}
          close={() => setBookSwitcherOpen(false)}
        />
      )}
    </IosPage>
  );
}

export function TransactionFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { book } = useActiveBook();
  const { data: existing } = useApi<{ transaction: LedgerTransaction }>(id ? `/transactions/${id}` : undefined);
  const { data: categoriesData } = useApi<{ categories: CategoryOption[] }>(book ? `/books/${book.id}/categories` : undefined);
  const draftKey = searchParams.get("draft") ?? getRecordDraftKey(id, book?.id ?? searchParams.get("bookId"));
  const initialDraft = !id ? readRecordDraft(draftKey) : undefined;
  const [type, setType] = useState<"income" | "expense">((searchParams.get("type") as "income" | "expense") || initialDraft?.type || "expense");
  const [amount, setAmount] = useState(() => String(searchParams.get("amount") ?? initialDraft?.amount ?? "0"));
  const [categoryId, setCategoryId] = useState(searchParams.get("categoryId") ?? initialDraft?.categoryId ?? "");
  const [occurredAt, setOccurredAt] = useState(searchParams.get("occurredAt") ?? initialDraft?.occurredAt?.slice(0, 10) ?? toDateInputValue(new Date()));
  const [note, setNote] = useState(searchParams.get("note") ?? initialDraft?.note ?? "");
  const [items, setItems] = useState<LineItemValue[]>(() => initialDraft?.items ?? []);
  const [attachments, setAttachments] = useState<FormAttachment[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const stopWatchingRef = useRef<(() => void) | undefined>(undefined);
  const categories = (categoriesData?.categories ?? []).filter((category) => !category.type || category.type === type);
  const amountNumber = Number(amount || 0);
  const selectedCategory = categories.find((category) => category.id === categoryId);

  useEffect(() => {
    if (!existing?.transaction) return;
    setType(existing.transaction.type);
    setAmount(String(existing.transaction.amount));
    setCategoryId(existing.transaction.categoryId ?? "");
    setOccurredAt(existing.transaction.occurredAt.slice(0, 10));
    setNote(existing.transaction.note ?? "");
    setItems(existing.transaction.items ?? []);
  }, [existing?.transaction]);
  useEffect(() => () => {
    stopWatchingRef.current?.();
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    });
  }, [attachments]);

  const close = () => navigate(book ? `/records?bookId=${book.id}` : "/records");
  const appendDigit = (value: string) => {
    if (value === "del") {
      setAmount((current) => (current.length > 1 ? current.slice(0, -1) : "0"));
      return;
    }
    setAmount((current) => normalizeAmountInput(current, value));
  };
  const addFiles = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    const unsupported = files.find((file) => !isSupportedAttachment(file));
    if (unsupported) {
      toast.error("附件格式暂不支持", {
        description: `${unsupported.name} 不是支持的 ${supportedFileDescription} 格式。`,
        duration: 3000,
        closeButton: true,
      });
      return;
    }
    setAttachments((current) => {
      const merged = [...current, ...files.map(createFormAttachment)].slice(0, maxAttachmentFiles);
      if (current.length + files.length > maxAttachmentFiles) {
        toast.warning(`一次最多上传 ${maxAttachmentFiles} 个附件`, { duration: 3000, closeButton: true });
      }
      return merged;
    });
    if (fileInput.current) fileInput.current.value = "";
  };
  const removeAttachment = (idToRemove: string) => {
    setAttachments((current) => {
      current.forEach((attachment) => {
        if (attachment.id === idToRemove && attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      return current.filter((attachment) => attachment.id !== idToRemove);
    });
  };
  const uploadAttachments = async () => {
    const pending = attachments.filter((attachment) => attachment.status === "idle" || attachment.status === "failed");
    if (!book || !pending.length) return;
    const pendingIds = new Set(pending.map((item) => item.id));
    setAttachments((current) => current.map((item) => (pendingIds.has(item.id) ? { ...item, status: "uploading" } : item)));
    const { jobs } = await uploadImportFiles(book.id, pending.map((item) => item.file));
    const jobMap = new Map(jobs.map((job, index) => [pending[index]?.id, job]));
    setAttachments((current) =>
      current.map((item) => {
        const job = jobMap.get(item.id);
        return job ? { ...item, status: "processing", jobId: job.id, progress: job.progress } : item;
      }),
    );
    stopWatchingRef.current?.();
    stopWatchingRef.current = watchImportJobs(
      jobs.map((job) => job.id),
      (job) => {
        setAttachments((current) =>
          current.map((item) =>
            item.jobId === job.id
              ? {
                  ...item,
                  status: job.status === "failed" ? "failed" : terminalImportStatuses.has(job.status) ? "completed" : "processing",
                  errorMessage: job.errorMessage,
                  progress: job.progress,
                }
              : item,
          ),
        );
      },
      { onError: (message) => toast.warning(message, { duration: 3000, closeButton: true }) },
    );
  };
  const openLineItems = () => {
    if (!hasPositiveNumber(amountNumber)) {
      toast.error("请先输入总金额", { duration: 3000, closeButton: true });
      return;
    }
    writeRecordDraft(draftKey, {
      type,
      amount: amountNumber,
      occurredAt,
      note,
      categoryId: categoryId || undefined,
      items,
    });
    const params = new URLSearchParams();
    if (book?.id) params.set("bookId", book.id);
    params.set("total", String(amountNumber));
    params.set("draft", draftKey);
    navigate(`/records/new/items?${params.toString()}`);
  };
  const save = async (continueAfterSave = false) => {
    if (!book && !id) {
      setError("请先选择账本");
      return;
    }
    if (!hasPositiveNumber(amountNumber)) {
      setError("金额必须大于 0");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        type,
        amount: amountNumber,
        categoryId: categoryId || undefined,
        note: note.trim() || undefined,
        occurredAt,
        tagIds: [],
        items: normalizeLineItemPayload(items),
      };
      await api(id ? `/transactions/${id}` : `/books/${book?.id}/transactions`, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      if (attachments.length) {
        await uploadAttachments();
        toast.success("记录已保存，附件已进入识别", { duration: 3000, closeButton: true });
      } else {
        toast.success(id ? "记录已更新" : "已记一笔", { duration: 2600, closeButton: true });
      }
      clearRecordDraft(draftKey);
      if (continueAfterSave && !id) {
        setAmount("0");
        setNote("");
        setItems([]);
        setAttachments([]);
      } else {
        close();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <IosSheet
      title={id ? "编辑记录" : type === "income" ? "记一笔收入" : "记一笔支出"}
      onClose={close}
      footer={
        <div className="ios-form-footer-actions">
          {!id && (
            <IosButton variant="outline" disabled={saving} onClick={() => void save(true)}>
              保存并继续
            </IosButton>
          )}
          <IosButton disabled={saving} onClick={() => void save(false)} style={type === "income" ? { background: "#1f9d57", boxShadow: "0 9px 22px rgba(31, 157, 87, .22)" } : undefined}>
            {saving ? "保存中…" : id ? "保存修改" : type === "income" ? "保存收入" : "保存支出"}
          </IosButton>
        </div>
      }
    >
      <div className="ios-record-form">
        <IosSegment
          value={type}
          onChange={(value) => {
            setType(value);
            setCategoryId("");
          }}
          options={[
            { value: "expense", label: "支出" },
            { value: "income", label: "收入" },
          ]}
        />

        <section className="ios-amount-panel">
          <span>¥</span>
          <strong className={type}>{formatAmountText(amount)}</strong>
        </section>

        <section>
          <h3>类别</h3>
          <div className="ios-category-strip">
            {categories.slice(0, 8).map((category) => (
              <button
                aria-label={category.name}
                className={category.id === categoryId ? "active" : ""}
                type="button"
                onClick={() => setCategoryId(category.id)}
                key={category.id}
              >
                <IconTile tint={category.id === categoryId ? categoryColor(category, type) : `${categoryColor(category, type)}18`} color={category.id === categoryId ? "#fff" : categoryColor(category, type)}>
                  {category.name[0] ?? "类"}
                </IconTile>
                <span>{category.name}</span>
              </button>
            ))}
            {!categories.length && <p className="muted">暂无分类，可稍后在设置中维护。</p>}
          </div>
        </section>

        <div className="ios-record-meta-row">
          <label>
            <CalendarBlankIcon size={17} />
            <input aria-label="日期" type="date" value={occurredAt} onChange={(event) => setOccurredAt(event.currentTarget.value)} />
          </label>
          <button type="button" onClick={() => fileInput.current?.click()}>
            <PaperclipIcon size={17} />
            {attachments.length ? `附件 ${attachments.length}` : "附件"}
          </button>
        </div>
        <input ref={fileInput} className="sr-only" type="file" multiple accept={supportedFileAccept} onChange={(event) => addFiles(event.currentTarget.files)} />

        {attachments.length > 0 && (
          <div className="ios-form-attachments">
            {attachments.map((attachment) => (
              <AttachmentChip attachment={attachment} onRemove={() => removeAttachment(attachment.id)} key={attachment.id} />
            ))}
          </div>
        )}

        <input className="ios-note-input" value={note} placeholder="添加备注…" onChange={(event) => setNote(event.currentTarget.value)} />
        <button className="ios-line-item-link" type="button" onClick={openLineItems}>
          <PlusCircleIcon size={18} weight="bold" />
          拆分多个明细{items.length ? `（${items.length}）` : ""}
        </button>

        <div className="ios-keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map((key) => (
            <button type="button" onClick={() => appendDigit(key)} key={key}>
              {key === "del" ? "⌫" : key}
            </button>
          ))}
        </div>
        {selectedCategory && <p className="ios-form-hint">当前分类：{selectedCategory.name}</p>}
        {error && <p className="field-error">{error}</p>}
      </div>
    </IosSheet>
  );
}

export function AddLineItemsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const draftKey = searchParams.get("draft") ?? getRecordDraftKey(undefined, searchParams.get("bookId"));
  const savedDraft = readRecordDraft(draftKey);
  const total = Number(searchParams.get("total") ?? savedDraft?.amount ?? "");
  const [rows, setRows] = useState(() => getInitialLineItemRows(savedDraft?.items));
  const assigned = rows.reduce((sumValue, item) => sumValue + Number(item.amount || 0), 0);
  const bookId = searchParams.get("bookId");
  const close = () => navigate(`/records/new?${new URLSearchParams({ ...(bookId ? { bookId } : {}), draft: draftKey }).toString()}`);
  const updateRow = (id: string, field: "name" | "amount", value: string) => {
    setRows((current) => current.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };
  const saveRows = () => {
    writeRecordDraft(draftKey, {
      ...(savedDraft ?? { type: "expense", amount: total, occurredAt: toDateInputValue(new Date()), note: "" }),
      items: normalizeLineItemRows(rows),
    });
    close();
  };
  return (
    <IosSheet
      title="拆分明细"
      onClose={close}
      full
      footer={
        <IosButton onClick={saveRows}>
          保存明细 · 剩余 {yuan(total - assigned)}
        </IosButton>
      }
    >
      <div className="ios-line-items-screen">
        <IosCard className="ios-line-summary">
          <IconTile>
            <ReceiptIcon size={22} weight="fill" />
          </IconTile>
          <span>
            <small>总金额</small>
            <b>{yuan(total)}</b>
          </span>
          <span>
            <small>已分配</small>
            <b>{yuan(assigned)}</b>
          </span>
        </IosCard>
        {rows.map((row) => (
          <div className="ios-line-row" key={row.id}>
            <input aria-label="明细名称" placeholder="明细名称" value={row.name} onChange={(event) => updateRow(row.id, "name", event.currentTarget.value)} />
            <input aria-label="明细金额" inputMode="decimal" placeholder="0.00" value={row.amount} onChange={(event) => updateRow(row.id, "amount", event.currentTarget.value)} />
            <button type="button" aria-label="删除明细" onClick={() => setRows((current) => (current.length === 1 ? [{ ...row, name: "", amount: "" }] : current.filter((item) => item.id !== row.id)))}>
              <TrashIcon size={17} />
            </button>
          </div>
        ))}
        <button className="ios-line-item-link" type="button" onClick={() => setRows((current) => [...current, { id: crypto.randomUUID(), name: "", amount: "" }])}>
          <PlusCircleIcon size={18} weight="bold" />
          添加一项
        </button>
      </div>
    </IosSheet>
  );
}

export function RecordDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { book } = useActiveBook();
  const { data, error } = useApi<{ transaction: LedgerTransaction }>(id ? `/transactions/${id}` : undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const transaction = data?.transaction;
  const close = () => navigate(book ? `/records?bookId=${book.id}` : "/records");
  const deleteRecord = async () => {
    if (!transaction) return;
    try {
      await api(`/transactions/${transaction.id}`, { method: "DELETE" });
      toast.success("记录已删除", { duration: 2600, closeButton: true });
      close();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "删除失败", { duration: 3000, closeButton: true });
    }
  };
  const copyRecord = () => {
    if (!transaction) return;
    const params = new URLSearchParams();
    if (book?.id) params.set("bookId", book.id);
    params.set("type", transaction.type);
    params.set("amount", String(transaction.amount));
    if (transaction.categoryId) params.set("categoryId", transaction.categoryId);
    if (transaction.note) params.set("note", transaction.note);
    navigate(`/records/new?${params.toString()}`);
  };

  return (
    <IosSheet
      title="交易详情"
      onClose={close}
      right={
        transaction ? (
          <button className="ios-sheet-text-danger" type="button" onClick={() => setConfirmDelete(true)}>
            删除
          </button>
        ) : null
      }
    >
      {error && <p className="field-error">{error}</p>}
      {!transaction && !error && <p className="muted">正在读取记录…</p>}
      {transaction && (
        <div className="ios-record-detail">
          <div className="ios-record-detail-hero">
            <IconTile tint={`${categoryColor({ name: categoryLabel(transaction) }, transaction.type)}18`} color={categoryColor({ name: categoryLabel(transaction) }, transaction.type)}>
              {categoryLabel(transaction)[0] ?? "记"}
            </IconTile>
            <strong className={transaction.type}>
              {transaction.type === "income" ? "+" : "-"}
              {yuan(transaction.amount, book?.currency)}
            </strong>
            <span>{transaction.note || "未命名记录"}</span>
          </div>
          <IosCard className="ios-detail-rows">
            <DetailRow label="类别" value={categoryLabel(transaction)} />
            <DetailRow label="类型" value={transaction.type === "income" ? "收入" : "支出"} />
            <DetailRow label="时间" value={new Date(transaction.occurredAt).toLocaleString("zh-CN")} />
            <DetailRow label="备注" value={transaction.note || "—"} />
            <DetailRow label="明细" value={transaction.items?.length ? `${transaction.items.length} 项` : "无"} />
          </IosCard>
          <div className="ios-sheet-actions">
            <IosButton variant="outline" onClick={() => navigate(`/records/${transaction.id}/edit${book ? `?bookId=${book.id}` : ""}`)}>
              <NotePencilIcon size={18} />
              编辑
            </IosButton>
            <IosButton variant="secondary" onClick={copyRecord}>
              <CopyIcon size={18} />
              复制为新记录
            </IosButton>
          </div>
        </div>
      )}
      {confirmDelete && transaction && (
        <IosDialog
          danger
          title="删除记录"
          message="删除后无法恢复，确定要删除这笔交易吗？"
          confirmText="删除"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void deleteRecord()}
        />
      )}
    </IosSheet>
  );
}

function TransactionRow({
  transaction,
  categoryNames,
  currency,
}: {
  transaction: LedgerTransaction;
  categoryNames: Record<string, string>;
  currency?: string;
}) {
  const label = transactionCategoryTag(transaction, categoryNames);
  return (
    <Link className="ios-transaction-row" to={`/records/${transaction.id}`}>
      <span className={`ios-transaction-dot ${transaction.type}`} aria-hidden="true" />
      <span className="ios-transaction-meta">
        <span className="ios-transaction-category-tag">{label}</span>
      </span>
      <strong className={transaction.type}>
        {transaction.type === "income" ? "+" : "-"}
        {yuan(transaction.amount, currency)}
      </strong>
    </Link>
  );
}

function AttachmentChip({ attachment, onRemove }: { attachment: FormAttachment; onRemove: () => void }) {
  return (
    <div className={`ios-form-attachment ${attachment.status}`}>
      {attachment.previewUrl ? <img src={attachment.previewUrl} alt={attachment.file.name} /> : <span>{fileExtension(attachment.file.name)}</span>}
      <b>{attachment.file.name}</b>
      <button type="button" aria-label="移除附件" onClick={onRemove}>
        <XIcon size={13} weight="bold" />
      </button>
      {attachment.status !== "idle" && (
        <em>
          {attachment.status === "completed" ? <CheckCircleIcon size={18} weight="fill" /> : attachment.status === "failed" ? "失败" : "处理中"}
        </em>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span>{label}</span>
      <b>{value}</b>
    </p>
  );
}

function emptyRecordFilters(): RecordFilters {
  return {
    q: "",
    type: "all",
    sort: "latest",
    start: "",
    end: "",
    min: "",
    max: "",
    category: "",
    source: "",
    chips: [],
    minStrict: false,
    maxStrict: false,
  };
}

function readRecordFilters(searchParams: URLSearchParams): RecordFilters {
  const type = searchParams.get("type");
  const sort = searchParams.get("sort");
  return {
    ...emptyRecordFilters(),
    q: searchParams.get("q") ?? "",
    type: type === "expense" || type === "income" || type === "all" ? type : "all",
    sort: sort === "amount_desc" ? "amount_desc" : "latest",
    start: searchParams.get("start") ?? "",
    end: searchParams.get("end") ?? "",
    min: searchParams.get("min") ?? "",
    max: searchParams.get("max") ?? "",
    category: searchParams.get("category") ?? "",
    source: searchParams.get("source") === "ai" || searchParams.get("aiFilter") === "1" ? "ai" : "",
    chips: readChips(searchParams.get("chips")),
    minStrict: booleanValue(searchParams.get("minStrict") ?? searchParams.get("strictMin")) ?? false,
    maxStrict: booleanValue(searchParams.get("maxStrict") ?? searchParams.get("strictMax")) ?? false,
  };
}

function writeRecordFilters(searchParams: URLSearchParams, filters: RecordFilters) {
  const next = new URLSearchParams(searchParams);
  const setOrDelete = (key: string, value: string) => {
    if (value) next.set(key, value);
    else next.delete(key);
  };
  setOrDelete("q", filters.q);
  if (filters.type === "all") next.delete("type");
  else next.set("type", filters.type);
  if (filters.sort === "latest") next.delete("sort");
  else next.set("sort", filters.sort);
  setOrDelete("start", filters.start);
  setOrDelete("end", filters.end);
  setOrDelete("min", filters.min);
  setOrDelete("max", filters.max);
  setOrDelete("category", filters.category);
  if (filters.source) next.set("source", filters.source);
  else next.delete("source");
  const chips = filters.source === "ai" ? writeChips(filters.chips.length ? filters.chips : buildFilterChips(filters, {})) : "";
  setOrDelete("chips", chips);
  if (filters.minStrict) next.set("minStrict", "1");
  else next.delete("minStrict");
  if (filters.maxStrict) next.set("maxStrict", "1");
  else next.delete("maxStrict");
  return next;
}

function clearRecordFilterParams(searchParams: URLSearchParams) {
  const next = new URLSearchParams();
  const bookId = searchParams.get("bookId");
  if (bookId) next.set("bookId", bookId);
  return next;
}

function buildFilterChips(filters: RecordFilters, categoryNames: Record<string, string>) {
  return [
    filters.start || filters.end ? formatDateRangeLabel(filters.start, filters.end) : "",
    filters.type !== "all" ? recordTypeFilterOptions.find((item) => item.value === filters.type)?.label : "",
    filters.category ? `分类：${categoryNames[filters.category] ?? filters.category}` : "",
    filters.min || filters.max ? formatAmountRangeLabel(filters) : "",
    filters.sort === "amount_desc" ? "金额最高" : "",
    filters.q ? `${filters.source === "ai" ? "搜索" : "关键词"}：${filters.q}` : "",
  ].filter((part): part is string => Boolean(part));
}

function formatDateRangeLabel(start: string, end: string) {
  if (start && end) return `${start} 至 ${end}`;
  if (start) return `${start} 之后`;
  return `${end} 之前`;
}

function formatAmountRangeLabel(filters: RecordFilters) {
  const minSign = filters.minStrict ? ">" : ">=";
  const maxSign = filters.maxStrict ? "<" : "<=";
  if (filters.min && filters.max) return `金额 ${minSign} ${filters.min} 且 ${maxSign} ${filters.max}`;
  if (filters.min) return `金额 ${minSign} ${filters.min}`;
  return `金额 ${maxSign} ${filters.max}`;
}

function matchesRecordFilters(transaction: LedgerTransaction, filters: RecordFilters, categoryNames: Record<string, string>) {
  if (filters.type !== "all" && transaction.type !== filters.type) return false;
  const occurredAt = transaction.occurredAt.slice(0, 10);
  if (filters.start && occurredAt < filters.start) return false;
  if (filters.end && occurredAt > filters.end) return false;
  const min = Number(filters.min);
  const max = Number(filters.max);
  if (filters.min && Number.isFinite(min) && (filters.minStrict ? transaction.amount <= min : transaction.amount < min)) return false;
  if (filters.max && Number.isFinite(max) && (filters.maxStrict ? transaction.amount >= max : transaction.amount > max)) return false;
  const label = categoryLabel(transaction, categoryNames);
  if (filters.category && ![transaction.categoryId, label].filter(Boolean).join(" ").toLowerCase().includes(filters.category.toLowerCase())) return false;
  if (filters.source === "ai") return true;
  const keyword = filters.q.trim().toLowerCase();
  if (!keyword) return true;
  return [transaction.note, label, transaction.categoryId].filter(Boolean).join(" ").toLowerCase().includes(keyword);
}

function compareRecordTransactions(a: LedgerTransaction, b: LedgerTransaction, sort: RecordSort) {
  if (sort === "amount_desc" && b.amount !== a.amount) return b.amount - a.amount;
  const dateDiff = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
  return dateDiff || a.id.localeCompare(b.id);
}

function groupTransactions(transactions: LedgerTransaction[]) {
  const groups = new Map<string, { key: string; label: string; items: LedgerTransaction[] }>();
  transactions.forEach((transaction) => {
    const key = transaction.occurredAt.slice(0, 10);
    const label = new Date(transaction.occurredAt).toLocaleDateString("zh-CN", {
      month: "long",
      day: "numeric",
      weekday: "short",
    });
    const group = groups.get(key) ?? { key, label, items: [] };
    group.items.push(transaction);
    groups.set(key, group);
  });
  return [...groups.values()];
}

function sum(transactions: LedgerTransaction[], type: "income" | "expense") {
  return transactions.filter((item) => item.type === type).reduce((total, item) => total + item.amount, 0);
}

function buildAiBaseFilters(filters: RecordFilters) {
  return { ...(filters.type === "all" ? {} : { type: filters.type }), sort: filters.sort };
}

function mergeAiSearchResult(current: RecordFilters, query: string, result: AiTransactionSearchResponse): RecordFilters {
  const urlFilters = filtersFromAiSearchUrl(result.href ?? result.url);
  const extracted = extractAiSearchFilters(result);
  const next: RecordFilters = {
    ...emptyRecordFilters(),
    type: current.type,
    sort: current.sort,
    ...urlFilters,
    ...extracted,
    q: query,
    source: "ai",
  };
  if (!next.chips.length) next.chips = buildFilterChips(next, {});
  return next;
}

function filtersFromAiSearchUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    return readRecordFilters(new URL(value, window.location.origin).searchParams);
  } catch {
    return undefined;
  }
}

function extractAiSearchFilters(result: AiTransactionSearchResponse): Partial<RecordFilters> {
  const payload = objectValue(result.filters) ?? objectValue(result.filter) ?? {};
  const amount = objectValue(payload.amount);
  const type = stringValue(payload.type);
  const sort = stringValue(payload.sort);
  const min = numberStringValue(payload.min ?? payload.minAmount ?? amount?.min);
  const max = numberStringValue(payload.max ?? payload.maxAmount ?? amount?.max);
  const category = stringValue(payload.category) ?? stringValue(payload.categoryId) ?? stringValue(payload.categoryName);
  const extracted: Partial<RecordFilters> = {};
  if (type === "expense" || type === "income") extracted.type = type;
  if (sort === "latest" || sort === "amount_desc") extracted.sort = sort;
  if (min) extracted.min = min;
  if (max) extracted.max = max;
  const minPayload = objectValue(payload.min ?? amount?.min);
  const maxPayload = objectValue(payload.max ?? amount?.max);
  const minStrict = booleanValue(payload.minStrict ?? payload.strictMin ?? minPayload?.strict ?? minPayload?.exclusive);
  const maxStrict = booleanValue(payload.maxStrict ?? payload.strictMax ?? maxPayload?.strict ?? maxPayload?.exclusive);
  if (minStrict !== undefined) extracted.minStrict = minStrict;
  if (maxStrict !== undefined) extracted.maxStrict = maxStrict;
  if (category) extracted.category = category;
  const chips = normalizeChips(result.chips ?? payload.chips);
  if (chips.length) extracted.chips = chips;
  const start = stringValue(payload.start) ?? stringValue(payload.from);
  const end = stringValue(payload.end) ?? stringValue(payload.to);
  if (start) extracted.start = start;
  if (end) extracted.end = end;
  return extracted;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberStringValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return value.trim();
  const object = objectValue(value);
  return object ? numberStringValue(object.value ?? object.amount) : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  return undefined;
}

function normalizeChips(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return readChips(value);
  return [];
}

function readChips(value: string | null) {
  if (!value) return [];
  return value.split("|").map((item) => item.trim()).filter(Boolean);
}

function writeChips(chips: string[]) {
  return chips.map((item) => item.trim()).filter(Boolean).join("|");
}

function getClientTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
}

function categoryLabel(transaction: LedgerTransaction, categoryNames?: Record<string, string>) {
  if (transaction.categoryName) return transaction.categoryName;
  if (transaction.categoryId && categoryNames?.[transaction.categoryId]) return categoryNames[transaction.categoryId];
  return transaction.categoryId ?? (transaction.type === "income" ? "收入" : "支出");
}

function transactionCategoryTag(transaction: LedgerTransaction, categoryNames?: Record<string, string>) {
  if (transaction.categoryName) return transaction.categoryName;
  if (transaction.categoryId && categoryNames?.[transaction.categoryId]) return categoryNames[transaction.categoryId];
  return transaction.categoryId ?? "未分类";
}

function categoryColor(category: { name?: string }, type: "income" | "expense") {
  if (type === "income") return "#1f9d57";
  const name = category.name ?? "";
  if (name.includes("餐") || name.includes("饭") || name.includes("食")) return "#ff681c";
  if (name.includes("交通") || name.includes("车")) return "#4c8dff";
  if (name.includes("购") || name.includes("物")) return "#ff5d8f";
  return "#a855f7";
}

function isActiveImport(job: ImportJobStatus) {
  return ["uploaded", "parsing", "converting", "ocr_processing", "ai_processing", "processing"].includes(job.status);
}

function formatActiveImportSummary(imports: ImportJobStatus[]) {
  const first = imports[0];
  if (!first) return "";
  if (first.status === "ai_processing") return imports.length > 1 ? `${imports.length} 个文件，AI 分析中` : "AI 分析中";
  if (typeof first.currentPage === "number" && typeof first.totalPages === "number") {
    return imports.length > 1 ? `${imports.length} 个文件，第 ${first.currentPage}/${first.totalPages} 页` : `第 ${first.currentPage}/${first.totalPages} 页`;
  }
  if (typeof first.progress === "number" && first.progress > 0) return imports.length > 1 ? `${imports.length} 个文件，OCR ${first.progress}%` : `OCR ${first.progress}%`;
  return `${imports.length} 个文件正在识别`;
}

function normalizeAmountInput(current: string, input: string) {
  if (input === "." && current.includes(".")) return current;
  const next = current === "0" && input !== "." ? input : `${current}${input}`;
  const [integer, fraction] = next.split(".");
  return fraction !== undefined ? `${integer || "0"}.${fraction.slice(0, 2)}` : next.replace(/^0+(\d)/, "$1");
}

function formatAmountText(value: string) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0";
  return value.includes(".") ? value : numeric.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function hasPositiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRecordDraftKey(id: string | undefined, bookId: string | null | undefined) {
  return `shared-ledger:record-draft:${id ?? "new"}:${bookId ?? "default"}`;
}

function readRecordDraft(key: string): RecordDraft | undefined {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<RecordDraft>;
    if (parsed.type !== "income" && parsed.type !== "expense") return undefined;
    return {
      type: parsed.type,
      amount: typeof parsed.amount === "number" || parsed.amount === "" ? parsed.amount : undefined,
      occurredAt: typeof parsed.occurredAt === "string" ? parsed.occurredAt : toDateInputValue(new Date()),
      note: typeof parsed.note === "string" ? parsed.note : "",
      categoryId: typeof parsed.categoryId === "string" ? parsed.categoryId : undefined,
      items: Array.isArray(parsed.items) ? normalizeLineItemPayload(parsed.items) : [],
    };
  } catch {
    return undefined;
  }
}

function writeRecordDraft(key: string, value: RecordDraft) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Session storage is best-effort for the local record draft.
  }
}

function clearRecordDraft(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function normalizeLineItemPayload(items: unknown): LineItemValue[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as { name?: unknown; amount?: unknown; categoryId?: unknown; note?: unknown };
    const name = String(candidate.name ?? "").trim();
    const amount = Number(candidate.amount);
    if (!name || !Number.isFinite(amount) || amount <= 0) return [];
    return [
      {
        name,
        amount,
        ...(typeof candidate.categoryId === "string" && candidate.categoryId ? { categoryId: candidate.categoryId } : {}),
        ...(typeof candidate.note === "string" && candidate.note.trim() ? { note: candidate.note.trim() } : {}),
      },
    ];
  });
}

function normalizeLineItemRows(items: Array<{ name: string; amount: string }>) {
  return normalizeLineItemPayload(items);
}

function getInitialLineItemRows(items: LineItemValue[] | undefined) {
  if (!items?.length) return [{ id: "empty", name: "", amount: "" }];
  return items.map((item) => ({ id: crypto.randomUUID(), name: item.name, amount: String(item.amount) }));
}

function createFormAttachment(file: File): FormAttachment {
  const canPreview = file.type.startsWith("image/") && typeof URL.createObjectURL === "function";
  return {
    id: `attachment_${crypto.randomUUID()}`,
    file,
    status: "idle",
    ...(canPreview ? { previewUrl: URL.createObjectURL(file) } : {}),
  };
}

function fileExtension(name: string) {
  const extension = name.split(".").pop()?.toUpperCase();
  return extension && extension !== name.toUpperCase() ? extension : "FILE";
}
