import {
  CalendarBlankIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  FunnelIcon,
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
import { Navigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BookSwitcherSheet } from "../components/books/BookSwitcherSheet";
import { IosTransactionRow, type LedgerTransaction } from "../components/ledger/Transactions";
import {
  AiSparkButton,
  IconTile,
  IosButton,
  IosCard,
  IosDialog,
  IosField,
  IosListSkeleton,
  IosPage,
  IosScroll,
  IosSegment,
  IosSheet,
  IosTopBar,
  yuan,
} from "../components/ios/IosDesign";
import { searchTransactionsWithAi, type AiTransactionSearchResponse } from "../features/ai/search";
import { useAuth } from "../features/auth/AuthProvider";
import { invalidateLedgerData } from "../features/data/invalidations";
import {
  isSupportedAttachment,
  maxAttachmentFiles,
  supportedFileAccept,
  supportedFileDescription,
} from "../features/imports/files";
import { terminalImportStatuses, watchImportJobs, type ImportJobStatus } from "../features/imports/status";
import { uploadImportFiles } from "../features/imports/upload";
import { useAppSheetActions } from "../features/sheets/SheetContext";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api } from "../lib";

type CategoryOption = { id: string; name: string; type?: "expense" | "income"; icon?: string };
type RecordFilterType = "all" | "expense" | "income";
type RecordSort = "latest" | "amount_desc";
type RecordFilterSource = "" | "ai";
type LineItemRow = { id: string; name: string; amount: string };
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
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readRecordFilters(searchParams);
  const [searchText, setSearchText] = useState(filters.q);
  const [aiSearching, setAiSearching] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [bookSwitcherOpen, setBookSwitcherOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState(filters);
  const { user } = useAuth();
  const { book, books, setActiveBook } = useActiveBook();
  const { openSheet } = useAppSheetActions();
  const { data, error: transactionsError, loading: transactionsLoading } = useApi<{ transactions: LedgerTransaction[] }>(book ? `/books/${book.id}/transactions` : undefined);
  const { data: categories } = useApi<{ categories: CategoryOption[] }>(book ? `/books/${book.id}/categories` : undefined);
  const { data: imports, reload: reloadImports } = useApi<{ imports: ImportJobStatus[] }>(book ? `/books/${book.id}/imports` : undefined);

  const categoryNames = useMemo(
    () => Object.fromEntries((categories?.categories ?? []).map((item) => [item.id, item.name])),
    [categories?.categories],
  );
  const activeImports = (imports?.imports ?? []).filter(isActiveImport);
  const pendingCount = (imports?.imports ?? []).filter((item) => item.status === "pending_confirmation").length;
  const failedCount = (imports?.imports ?? []).filter((item) => item.status === "failed").length;
  const allTransactions = useMemo(() => data?.transactions ?? [], [data?.transactions]);
  const visibleTransactions = useMemo(
    () =>
      allTransactions
        .filter((item) => matchesRecordFilters(item, filters, categoryNames))
        .sort((a, b) => compareRecordTransactions(a, b, filters.sort)),
    [allTransactions, categoryNames, filters],
  );
  const groups = useMemo(() => groupTransactions(visibleTransactions), [visibleTransactions]);
  const canUseAiSearch = Boolean(user);
  const hasAnyTransactions = allTransactions.length > 0;
  const hasActiveFilters = hasActiveRecordFilters(filters);
  const activeFilterChips = useMemo(
    () => (filters.source === "ai" && filters.chips.length ? filters.chips : buildFilterChips(filters, categoryNames)),
    [categoryNames, filters],
  );

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
            <button className={`ios-filter-trigger${hasActiveFilters ? " active" : ""}`} type="button" aria-label="筛选记录" onClick={openFilters}>
              <FunnelIcon size={21} weight="bold" />
            </button>
            {canUseAiSearch && (
              <AiSparkButton
                onClick={() => openSheet({ type: "ai" })}
              />
            )}
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
            <button className="ios-record-ai-search-button" type="submit" disabled={aiSearching || !book || !searchText.trim()} aria-label="AI 搜索">
              {aiSearching ? <CircleNotchIcon size={15} className="ios-spin" /> : <SparkleIcon size={15} weight="fill" />}
              <span>{aiSearching ? "搜索中" : "AI 搜索"}</span>
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

        {hasActiveFilters && (
          <ActiveFilterResetBar
            source={filters.source}
            chips={activeFilterChips}
            onReset={resetFilters}
          />
        )}

        {(activeImports.length > 0 || pendingCount > 0 || failedCount > 0) && (
          <section className="ios-section">
            <h2>待处理</h2>
            <div className="ios-reminder-list">
              {activeImports.length > 0 && (
                <button className="ios-reminder-row" type="button" onClick={() => openSheet({ type: "imports" })}>
                  <IconTile tint="#eaf1ff" color="#4c8dff">
                    {activeImports.length}
                  </IconTile>
                  <span>
                    <b>{activeImports.length} 个文件正在识别</b>
                    <small>{formatActiveImportSummary(activeImports)}</small>
                  </span>
                  <CaretRightIcon size={18} />
                </button>
              )}
              {pendingCount > 0 && (
                <button className="ios-reminder-row" type="button" onClick={() => openSheet({ type: "pending-imports" })}>
                  <IconTile>{pendingCount}</IconTile>
                  <span>
                    <b>{pendingCount} 条待确认记录</b>
                    <small>来自文件识别与 AI — 需你审核入账</small>
                  </span>
                  <CaretRightIcon size={18} />
                </button>
              )}
              {failedCount > 0 && (
                <button className="ios-reminder-row danger" type="button" onClick={() => openSheet({ type: "imports" })}>
                  <IconTile tint="#fdeceb" color="#d74035">
                    !
                  </IconTile>
                  <span>
                    <b>{failedCount} 个文件处理失败</b>
                    <small>查看失败原因或重试</small>
                  </span>
                  <CaretRightIcon size={18} />
                </button>
              )}
            </div>
          </section>
        )}

        <section className="ios-record-groups">
          {(transactionsLoading || aiSearching) && (
            <IosCard className="ios-record-list">
              <IosListSkeleton rows={5} />
            </IosCard>
          )}
          {transactionsError && <p className="field-error">{transactionsError}</p>}
          {!transactionsLoading &&
            !aiSearching &&
            !transactionsError &&
            groups.map((group) => (
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
                    <IosTransactionRow transaction={transaction} categoryNames={categoryNames} currency={book?.currency} key={transaction.id} />
                  ))}
                </IosCard>
              </article>
            ))}
          {!transactionsLoading && !aiSearching && !transactionsError && !groups.length && (
            <RecordEmptyState
              filtered={hasAnyTransactions && hasActiveFilters}
              onReset={hasActiveFilters ? resetFilters : undefined}
            />
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
  return <LegacyRecordsRedirect />;
}

export function TransactionFormSheet({
  recordId,
  initialType = "expense",
  onClose,
}: {
  recordId?: string;
  initialType?: "income" | "expense";
  onClose: () => void;
}) {
  const id = recordId;
  const { book } = useActiveBook();
  const { data: existing } = useApi<{ transaction: LedgerTransaction }>(id ? `/transactions/${id}` : undefined);
  const { data: categoriesData } = useApi<{ categories: CategoryOption[] }>(book ? `/books/${book.id}/categories` : undefined);
  const draftKey = getRecordDraftKey(id, book?.id);
  const initialDraft = readRecordDraft(draftKey);
  const [view, setView] = useState<"form" | "lineItems">("form");
  const [type, setType] = useState<"income" | "expense">(initialDraft?.type || initialType);
  const [amount, setAmount] = useState(() => String(initialDraft?.amount ?? "0"));
  const [categoryId, setCategoryId] = useState(initialDraft?.categoryId ?? "");
  const [occurredAt, setOccurredAt] = useState(initialDraft?.occurredAt?.slice(0, 10) ?? toDateInputValue(new Date()));
  const [note, setNote] = useState(initialDraft?.note ?? "");
  const [items, setItems] = useState<LineItemValue[]>(() => initialDraft?.items ?? []);
  const [lineRows, setLineRows] = useState<LineItemRow[]>(() => getInitialLineItemRows(initialDraft?.items));
  const [attachments, setAttachments] = useState<FormAttachment[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const stopWatchingRef = useRef<(() => void) | undefined>(undefined);
  const categories = categoriesData?.categories ?? [];
  const amountNumber = Number(amount || 0);
  const selectedCategory = categories.find((category) => category.id === categoryId);
  const assignedLineAmount = lineRows.reduce((sumValue, item) => sumValue + Number(item.amount || 0), 0);
  const lineItemErrors = useMemo(() => getLineItemErrors(lineRows, amountNumber), [lineRows, amountNumber]);
  const hasLineItemErrors = Object.values(lineItemErrors).some(Boolean);

  useEffect(() => {
    if (!existing?.transaction) return;
    if (initialDraft) return;
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

  const close = onClose;
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
        return job
          ? {
              ...item,
              status: "processing",
              jobId: job.id,
              progress: job.progress,
              stage: job.stage,
              currentPage: job.currentPage,
              totalPages: job.totalPages,
            }
          : item;
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
                  stage: job.stage,
                  currentPage: job.currentPage,
                  totalPages: job.totalPages,
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
    setLineRows(getInitialLineItemRows(items));
    setView("lineItems");
  };
  const updateLineRow = (rowId: string, field: "name" | "amount", value: string) => {
    setLineRows((current) => current.map((item) => (item.id === rowId ? { ...item, [field]: value } : item)));
  };
  const addLineRow = () => {
    setLineRows((current) => [...current, { id: crypto.randomUUID(), name: "", amount: "" }]);
  };
  const removeLineRow = (row: LineItemRow) => {
    setLineRows((current) => (current.length === 1 ? [{ ...row, name: "", amount: "" }] : current.filter((item) => item.id !== row.id)));
  };
  const saveLineRows = () => {
    if (hasLineItemErrors) {
      toast.error("明细金额不能超过剩余金额", { duration: 3000, closeButton: true });
      return;
    }
    setItems(normalizeLineItemRows(lineRows));
    setView("form");
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
    const closeImmediately = !continueAfterSave && attachments.length === 0;
    if (!closeImmediately) setSaving(true);
    setError("");
    const payload = {
      type,
      amount: amountNumber,
      categoryId: categoryId || undefined,
      note: note.trim() || undefined,
      occurredAt,
      tagIds: [],
      items: normalizeLineItemPayload(items),
    };
    if (closeImmediately) close();
    try {
      const saved = await api<{ transaction?: LedgerTransaction }>(id ? `/transactions/${id}` : `/books/${book?.id}/transactions`, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      invalidateLedgerData({
        bookId: book?.id,
        transactionId: id ?? saved.transaction?.id,
        scopes: ["transactions", "transaction"],
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
      } else if (!closeImmediately) {
        close();
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "保存失败";
      if (closeImmediately) toast.error(message, { duration: 3000, closeButton: true });
      else setError(message);
    } finally {
      if (!closeImmediately) setSaving(false);
    }
  };

  return (
    <IosSheet
      title={view === "lineItems" ? "添加明细" : id ? "编辑记录" : type === "income" ? "记一笔收入" : "记一笔支出"}
      onClose={close}
      back={view === "lineItems"}
      onBack={() => setView("form")}
      footer={
        view === "lineItems" ? (
          <IosButton disabled={hasLineItemErrors} onClick={saveLineRows}>
            保存明细 · 剩余 {yuan(amountNumber - assignedLineAmount)}
          </IosButton>
        ) : (
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
        )
      }
    >
      {view === "lineItems" ? (
        <LineItemsEditor
          rows={lineRows}
          total={amountNumber}
          assigned={assignedLineAmount}
          errors={lineItemErrors}
          onAdd={addLineRow}
          onRemove={removeLineRow}
          onUpdate={updateLineRow}
        />
      ) : (
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
          添加明细{items.length ? `（${items.length}）` : ""}
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
      )}
    </IosSheet>
  );
}

export function AddLineItemsPage() {
  return <LegacyRecordsRedirect />;
}

function LineItemsEditor({
  rows,
  total,
  assigned,
  errors,
  onAdd,
  onRemove,
  onUpdate,
}: {
  rows: LineItemRow[];
  total: number;
  assigned: number;
  errors: Record<string, string>;
  onAdd: () => void;
  onRemove: (row: LineItemRow) => void;
  onUpdate: (id: string, field: "name" | "amount", value: string) => void;
}) {
  return (
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
          <label>
            <input aria-label="明细名称" placeholder="明细名称" value={row.name} onChange={(event) => onUpdate(row.id, "name", event.currentTarget.value)} />
          </label>
          <label>
            <input aria-label="明细金额" inputMode="decimal" placeholder="0.00" value={row.amount} onChange={(event) => onUpdate(row.id, "amount", event.currentTarget.value)} />
            {errors[row.id] ? <em>{errors[row.id]}</em> : null}
          </label>
          <button type="button" aria-label="删除明细" onClick={() => onRemove(row)}>
            <TrashIcon size={17} />
          </button>
        </div>
      ))}
      <button className="ios-line-item-link" type="button" onClick={onAdd}>
        <PlusCircleIcon size={18} weight="bold" />
        添加明细
      </button>
    </div>
  );
}

export function RecordDetailPage() {
  return <LegacyRecordsRedirect />;
}

export function RecordDetailSheet({
  bookId,
  currency,
  transactionId,
  onClose,
  onEdit,
}: {
  bookId?: string;
  currency?: string;
  transactionId: string;
  onClose: () => void;
  onEdit: (transactionId: string) => void;
}) {
  const { data, error } = useApi<{ transaction: LedgerTransaction }>(`/transactions/${transactionId}`);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const transaction = data?.transaction;
  const close = onClose;
  const deleteRecord = async () => {
    if (!transaction) return;
    close();
    try {
      await api(`/transactions/${transaction.id}`, { method: "DELETE" });
      invalidateLedgerData({ bookId, transactionId: transaction.id, scopes: ["transactions", "transaction"] });
      toast.success("记录已删除", { duration: 2600, closeButton: true });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "删除失败", { duration: 3000, closeButton: true });
    }
  };

  return (
    <IosSheet title="交易详情" onClose={close}>
      {error && <p className="field-error">{error}</p>}
      {!transaction && !error && <IosListSkeleton rows={3} />}
      {transaction && (
        <div className="ios-record-detail">
          <div className="ios-record-detail-hero">
            <strong className={transaction.type}>
              {yuan(transaction.amount, currency)}
            </strong>
            <span>{transaction.note || "未命名记录"}</span>
            <small>{categoryLabel(transaction)}</small>
          </div>
          <IosCard className="ios-detail-rows">
            <DetailRow label="时间" value={new Date(transaction.occurredAt).toLocaleString("zh-CN")} />
            <DetailRow label="备注" value={transaction.note || "—"} />
            <DetailRow label="明细" value={transaction.items?.length ? `${transaction.items.length} 项` : "无"} />
          </IosCard>
          <div className="ios-sheet-actions">
            <IosButton
              variant="outline"
              onClick={() => onEdit(transaction.id)}
            >
              <NotePencilIcon size={18} />
              编辑
            </IosButton>
            <button className="ios-danger-text-button" type="button" onClick={() => setConfirmDelete(true)}>
              删除记录
            </button>
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

function RecordEmptyState({ filtered, onReset }: { filtered: boolean; onReset?: () => void }) {
  return (
    <div className={`ios-empty ios-record-empty-state${filtered ? " filtered" : ""}`}>
      <b>{filtered ? "没有符合筛选的记录" : "还没有流水记录"}</b>
      <p>{filtered ? "当前条件下暂时没有结果，可以调整筛选或清空条件。" : "点底部加号记下第一笔，之后这里会按日期展示流水。"}</p>
      {filtered && onReset ? (
        <button type="button" onClick={onReset}>
          清空筛选
        </button>
      ) : null}
    </div>
  );
}

function ActiveFilterResetBar({
  source,
  chips,
  onReset,
}: {
  source: RecordFilterSource;
  chips: string[];
  onReset: () => void;
}) {
  return (
    <div className={`ios-active-filter-bar${source === "ai" ? " ai" : ""}`}>
      <span>{source === "ai" ? "AI 筛选" : "已筛选"}</span>
      <div>
        {(chips.length ? chips : ["当前条件"]).slice(0, 4).map((chip) => (
          <em key={chip}>{chip}</em>
        ))}
      </div>
      <button type="button" onClick={onReset}>
        重置
      </button>
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

function LegacyRecordsRedirect() {
  const [searchParams] = useSearchParams();
  const bookId = searchParams.get("bookId");
  return <Navigate to={`/records${bookId ? `?bookId=${encodeURIComponent(bookId)}` : ""}`} replace />;
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

function hasActiveRecordFilters(filters: RecordFilters) {
  return Boolean(
    filters.q.trim() ||
      filters.type !== "all" ||
      filters.sort !== "latest" ||
      filters.start ||
      filters.end ||
      filters.min ||
      filters.max ||
      filters.category ||
      filters.source ||
      filters.minStrict ||
      filters.maxStrict,
  );
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
  return {
    ...(filters.type === "all" ? {} : { type: filters.type }),
    ...(filters.sort === "amount_desc" ? { sort: "amount_desc" as const } : { sort: "date_desc" as const }),
  };
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
  if (sort === "latest" || sort === "date_desc") extracted.sort = "latest";
  if (sort === "amount_desc") extracted.sort = "amount_desc";
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
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        const object = objectValue(item);
        return stringValue(object?.value) ?? stringValue(object?.label) ?? "";
      })
      .filter(Boolean);
  }
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
  return ["uploaded", "parsing", "ocr_processing", "ai_processing", "processing"].includes(job.status);
}

function formatActiveImportSummary(imports: ImportJobStatus[]) {
  const first = imports[0];
  if (!first) return "";
  if (first.status === "ai_processing") return imports.length > 1 ? `${imports.length} 个文件，AI 分析中` : "AI 分析中";
  if (first.stage === "converting") return imports.length > 1 ? `${imports.length} 个文件，正在转换图片` : "正在转换图片";
  if (first.stage === "compressing") return imports.length > 1 ? `${imports.length} 个文件，正在压缩图片` : "正在压缩图片";
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

function getLineItemErrors(rows: Array<{ id: string; amount: string }>, total: number) {
  return Object.fromEntries(
    rows.map((row) => {
      if (!row.amount) return [row.id, ""];
      const amount = Number(row.amount);
      if (!Number.isFinite(amount) || amount < 0) return [row.id, "请输入有效金额"];
      const otherAssigned = rows.reduce((sumValue, item) => (item.id === row.id ? sumValue : sumValue + Number(item.amount || 0)), 0);
      const remaining = Math.max(0, total - otherAssigned);
      if (amount > remaining) return [row.id, `不能超过剩余 ${yuan(remaining)}`];
      return [row.id, ""];
    }),
  );
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
