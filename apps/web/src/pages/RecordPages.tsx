import { zodResolver } from "@hookform/resolvers/zod";
import {
  CalendarBlankIcon,
  CaretRightIcon,
  CircleNotchIcon,
  FileArrowUpIcon,
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
  NotePencilIcon,
  PlusCircleIcon,
  PlusIcon,
  ReceiptIcon,
  SquaresFourIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { createTransactionSchema } from "@shared-ledger/shared";
import { Button, Input, Panel } from "@shared-ledger/ui";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ImportAttachmentCards, type ImportAttachmentView } from "../components/imports/ImportAttachmentCards";
import { TransactionList, type LedgerTransaction } from "../components/ledger/Transactions";
import { Page } from "../components/layout/Page";
import { searchTransactionsWithAi, type AiTransactionSearchResponse } from "../features/ai/search";
import {
  isSupportedAttachment,
  isOcrAttachment,
  maxAttachmentFiles,
  supportedFileAccept,
  supportedFileDescription,
} from "../features/imports/files";
import { terminalImportStatuses, watchImportJobs } from "../features/imports/status";
import type { ImportJobStatus } from "../features/imports/status";
import { cancelImportJob, retryImportJob, uploadImportFiles } from "../features/imports/upload";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api, money } from "../lib";

type RecordPicker = "type" | "category" | "date";
type RecordFilterType = "all" | "expense" | "income";
type RecordSort = "latest" | "amount_desc";
type RecordFilterSource = "" | "ai";
type CategoryOption = { id: string; name: string; type?: "expense" | "income" };
type LineItemValue = { name: string; amount: number; categoryId?: string; note?: string };
type RecordDraft = {
  type: "income" | "expense";
  amount?: number | "";
  occurredAt: string;
  note?: string;
  categoryId?: string;
  items: LineItemValue[];
};
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

export function RecordsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readRecordFilters(searchParams);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState(filters.q);
  const [aiSearching, setAiSearching] = useState(false);
  const [draftFilters, setDraftFilters] = useState<RecordFilters>(filters);
  const isAiFilter = filters.source === "ai";
  const [attachments, setAttachments] = useState<ImportAttachmentView[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const stopWatchingRef = useRef<(() => void) | undefined>(undefined);
  const stopRestoredWatchingRef = useRef<(() => void) | undefined>(undefined);
  const previewUrlsRef = useRef(new Set<string>());
  const { book } = useActiveBook();
  const { data } = useApi<{ transactions: LedgerTransaction[] }>(
    book ? `/books/${book.id}/transactions` : undefined,
  );
  const { data: categories } = useApi<{ categories: CategoryOption[] }>(
    book ? `/books/${book.id}/categories` : undefined,
  );
  const { data: imports, reload: reloadImports } = useApi<{ imports: ImportJobStatus[] }>(
    book ? `/books/${book.id}/imports` : undefined,
  );
  const categoryNames = Object.fromEntries((categories?.categories ?? []).map((item) => [item.id, item.name]));
  const pendingCount = imports?.imports.filter((item) => item.status === "pending_confirmation").length ?? 0;
  const activeImports =
    imports?.imports.filter((item) => ["uploaded", "parsing", "converting", "ocr_processing", "ai_processing"].includes(item.status)) ??
    [];
  const transactions = (data?.transactions ?? [])
    .filter((item) => matchesRecordFilters(item, filters, categoryNames))
    .sort((a, b) => compareRecordTransactions(a, b, filters.sort));
  const groups = transactions.reduce<Record<string, LedgerTransaction[]>>((result, transaction) => {
    const key = new Date(transaction.occurredAt).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    });
    result[key] = [...(result[key] ?? []), transaction];
    return result;
  }, {});
  const filterChips = getVisibleFilterChips(filters, categoryNames);
  const openFilters = () => {
    setDraftFilters(filters);
    setFilterOpen(true);
  };
  const applyDraftFilters = () => {
    setSearchParams(writeRecordFilters(searchParams, draftFilters));
    setFilterOpen(false);
  };
  const resetFilters = () => {
    const empty = emptyRecordFilters();
    setDraftFilters(empty);
    setSearchText("");
    setSearchParams(clearRecordFilterParams(searchParams));
    setFilterOpen(false);
  };
  const submitAiSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) {
      resetFilters();
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
      const nextFilters = mergeAiSearchResult(filters, query, result);
      setSearchParams(writeRecordFilters(searchParams, nextFilters));
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "AI 搜索失败", {
        duration: 3000,
        closeButton: true,
      });
    } finally {
      setAiSearching(false);
    }
  };
  useEffect(() => {
    setSearchText(filters.q);
  }, [filters.q]);
  useEffect(() => {
    attachments.forEach((attachment) => {
      if (attachment.previewUrl) previewUrlsRef.current.add(attachment.previewUrl);
    });
  }, [attachments]);
  useEffect(() => () => {
    stopWatchingRef.current?.();
    stopRestoredWatchingRef.current?.();
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  useEffect(() => {
    stopRestoredWatchingRef.current?.();
    const ocrImportIds = activeImports.filter((job) => job.status === "converting" || job.status === "ocr_processing").map((job) => job.id);
    if (!ocrImportIds.length) return undefined;
    stopRestoredWatchingRef.current = watchImportJobs(
      ocrImportIds,
      (job) => {
        if (terminalImportStatuses.has(job.status)) void reloadImports();
      },
      {
        onDone: () => void reloadImports(),
        onError: (message) => toast.warning(message, { duration: 3000, closeButton: true }),
      },
    );
    return () => {
      stopRestoredWatchingRef.current?.();
      stopRestoredWatchingRef.current = undefined;
    };
  }, [activeImports.map((job) => `${job.id}:${job.status}`).join(","), reloadImports]);
  const removeAttachments = (ids: string[]) => {
    const removing = new Set(ids);
    setAttachments((current) => {
      current.forEach((attachment) => {
        if (removing.has(attachment.id) && attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      return current.filter((attachment) => !removing.has(attachment.id));
    });
  };
  const addAttachments = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    const unsupported = files.find((file) => !isSupportedAttachment(file));
    if (unsupported) {
      toast.error("附件格式暂不支持", {
        description: `${unsupported.name} 不是支持的 ${supportedFileDescription} 格式。`,
        duration: 3000,
        closeButton: true,
      });
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    const next = [...attachments, ...files.map(createImportAttachment)].slice(0, maxAttachmentFiles);
    if (attachments.length + files.length > maxAttachmentFiles) {
      toast.warning(`一次最多上传 ${maxAttachmentFiles} 个附件`, {
        description: "请减少文件数量后重试。",
        duration: 3000,
        closeButton: true,
      });
    }
    setAttachments(next);
    if (fileInput.current) fileInput.current.value = "";
  };
  const uploadRecordAttachments = async () => {
    const uploadable = attachments.filter((attachment) => attachment.status === "idle" || attachment.status === "failed");
    if (!uploadable.length) return fileInput.current?.click();
    if (!book) return toast.error("请先选择账本", { duration: 3000, closeButton: true });
    const uploadIds = new Set(uploadable.map((attachment) => attachment.id));
    setUploadingAttachments(true);
    try {
      setAttachments((current) =>
        current.map((attachment) =>
          uploadIds.has(attachment.id) ? { ...attachment, status: "uploading" } : attachment,
        ),
      );
      const { jobs } = await uploadImportFiles(
        book.id,
        uploadable.map((attachment) => attachment.file),
        { autoConfirm: true },
      );
      const jobToAttachment = new Map<string, string>();
      jobs.forEach((job, index) => {
        const attachment = uploadable[index];
        if (attachment) jobToAttachment.set(job.id, attachment.id);
      });
      setAttachments((current) =>
        current.map((attachment) => {
          const job = jobs.find((item) => jobToAttachment.get(item.id) === attachment.id);
          return job
            ? {
                ...attachment,
                status: "processing",
                jobId: job.id,
                progress: job.progress,
                stage: job.stage,
                currentPage: job.currentPage,
                totalPages: job.totalPages,
                retryable: job.retryable,
                cancelable: job.cancelable,
              }
            : attachment;
        }),
      );
      stopWatchingRef.current?.();
      const ocrJobIds = jobs
        .filter((job, index) => {
          const attachment = uploadable[index];
          return Boolean(attachment && isOcrAttachment(attachment.file));
        })
        .map((job) => job.id);
      if (ocrJobIds.length) stopWatchingRef.current = watchImportJobs(
        ocrJobIds,
        (job) => {
          const attachmentId = jobToAttachment.get(job.id);
          if (!attachmentId) return;
          setAttachments((current) =>
            current.map((attachment) =>
              attachment.id === attachmentId
                ? {
                    ...attachment,
                    status:
                      job.status === "failed"
                      ? "failed"
                      : job.status === "cancelled"
                        ? "failed"
                      : job.status === "completed" || job.status === "pending_confirmation"
                        ? "completed"
                        : "processing",
                    errorMessage: job.errorMessage,
                    retryable: job.retryable,
                    cancelable: job.cancelable,
                    progress: job.progress,
                    stage: job.stage ?? job.status,
                    currentPage: job.currentPage,
                    totalPages: job.totalPages,
                  }
                : attachment,
          ),
        );
        if (job.status === "cancelled") removeAttachments([attachmentId]);
      },
        {
          onError: (message) => toast.warning(message, { duration: 3000, closeButton: true }),
        },
      );
      toast.success("附件已上传", {
        description: `${jobs.length} 个文件正在 OCR/解析，完成后会自动保存到当前账本。`,
        duration: 3000,
        closeButton: true,
      });
    } catch (cause) {
      setAttachments((current) =>
        current.map((attachment) =>
          uploadIds.has(attachment.id) ? { ...attachment, status: "failed", errorMessage: "附件上传失败" } : attachment,
        ),
      );
      toast.error(cause instanceof Error ? cause.message : "附件上传失败", {
        duration: 3000,
        closeButton: true,
      });
    } finally {
      setUploadingAttachments(false);
    }
  };
  const cancelRecordAttachment = async (attachmentId: string) => {
    const attachment = attachments.find((item) => item.id === attachmentId);
    if (!attachment?.jobId) return;
    try {
      await cancelImportJob(attachment.jobId);
      removeAttachments([attachmentId]);
      void reloadImports();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "取消导入失败", {
        duration: 3000,
        closeButton: true,
      });
      throw cause;
    }
  };
  const retryRecordAttachment = async (attachmentId: string) => {
    const attachment = attachments.find((item) => item.id === attachmentId);
    if (!attachment?.jobId) return;
    try {
      const { job } = await retryImportJob(attachment.jobId);
      setAttachments((current) =>
        current.map((item) =>
          item.id === attachmentId
            ? {
                ...item,
                status: "processing",
                errorMessage: undefined,
                retryable: job.retryable,
                cancelable: job.cancelable,
                progress: job.progress,
                stage: job.stage,
                currentPage: job.currentPage,
                totalPages: job.totalPages,
              }
            : item,
        ),
      );
      stopWatchingRef.current?.();
      stopWatchingRef.current = watchImportJobs(
        [attachment.jobId],
        (next) => {
          if (next.status === "cancelled") {
            removeAttachments([attachmentId]);
            return;
          }
          setAttachments((current) =>
            current.map((item) =>
              item.id === attachmentId
                ? {
                    ...item,
                    status:
                      next.status === "failed"
                        ? "failed"
                        : next.status === "completed" || next.status === "pending_confirmation"
                          ? "completed"
                          : "processing",
                    errorMessage: next.errorMessage,
                    retryable: next.retryable,
                    cancelable: next.cancelable,
                    progress: next.progress,
                    stage: next.stage ?? next.status,
                    currentPage: next.currentPage,
                    totalPages: next.totalPages,
                  }
                : item,
            ),
          );
        },
        { onError: (message) => toast.warning(message, { duration: 3000, closeButton: true }) },
      );
      void reloadImports();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "重试导入失败", {
        duration: 3000,
        closeButton: true,
      });
      throw cause;
    }
  };
  return (
    <>
      <Page
        title={book?.name ?? "记录"}
        back={false}
        action={
          <Button className="icon-link" type="button" variant="ghost" size="icon" aria-label="筛选记录" onClick={openFilters}>
            <FunnelSimpleIcon size={25} />
          </Button>
        }
      />
      {pendingCount > 0 && (
        <Link className="pending-strip records-pending-entry" to="/records/pending">
          <ReceiptIcon size={22} weight="fill" />
          <b>
            待确认记录 <em>{pendingCount}</em>
          </b>
          <CaretRightIcon size={22} />
        </Link>
      )}
      {activeImports.length > 0 && (
        <Link className="processing-strip records-pending-entry" to="/records/imports">
          <CircleNotchIcon size={22} weight="fill" />
          <span>
            <b>文件处理中</b>
            <small>{formatActiveImportSummary(activeImports)}</small>
          </span>
          <CaretRightIcon size={22} />
        </Link>
      )}
      <form className="record-ai-search" onSubmit={(event) => void submitAiSearch(event)}>
        <Input
          className="search"
          aria-label="自然语言搜索记录"
          placeholder="用自然语言搜索记录，例如：今年大于 100 的餐饮支出"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <Button
          className="record-ai-search-submit"
          type="submit"
          variant="ghost"
          size="icon"
          aria-label="AI 搜索记录"
          disabled={aiSearching || !book}
        >
          {aiSearching ? <CircleNotchIcon size={20} weight="bold" /> : <MagnifyingGlassIcon size={21} weight="bold" />}
        </Button>
      </form>
      {hasActiveRecordFilters(filters) && (
        <div className={`active-filter-summary ${isAiFilter ? "ai-filter" : ""}`}>
          {isAiFilter && <b>AI 已筛选</b>}
          <span>{`已筛选：${formatFilterSummary(filters, categoryNames)}`}</span>
          <Button type="button" variant="ghost" onClick={resetFilters}>
            清除
          </Button>
        </div>
      )}
      {isAiFilter && filterChips.length > 0 && (
        <div className="ai-filter-chips" aria-label="AI 筛选条件">
          {filterChips.map((chip) => (
            <span key={chip}>{chip}</span>
          ))}
        </div>
      )}
      <div className="record-groups">
        {Object.entries(groups).map(([date, items]) => (
          <section key={date}>
            <header>
              <h2>{date}</h2>
              <span>
                收入 {money(items.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amount, 0))}
                <b>
                  支出 {money(items.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount, 0))}
                </b>
              </span>
            </header>
            <Panel>
              <TransactionList transactions={items} categoryNames={categoryNames} />
            </Panel>
          </section>
        ))}
        {!transactions.length && <p className="records-empty-state">还没有记录，记下第一笔吧。</p>}
      </div>
      <Button asChild className="primary-wide">
        <Link to={`/records/new?bookId=${book?.id ?? ""}`}>
          <PlusIcon size={24} weight="bold" />
          记一笔
        </Link>
      </Button>
      <Panel className="records-upload-panel">
        <div>
          <strong>上传文件记一笔</strong>
          <small>
            最多 {maxAttachmentFiles} 个，支持{supportedFileDescription}
          </small>
        </div>
        <ImportAttachmentCards
          attachments={attachments}
          onRemove={(id) => removeAttachments([id])}
          onCancel={cancelRecordAttachment}
          onRetry={retryRecordAttachment}
        />
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          multiple
          accept={supportedFileAccept}
          onChange={(event) => addAttachments(event.currentTarget.files)}
        />
        <div className="records-upload-actions">
          <Button
            type="button"
            variant="outline"
            disabled={uploadingAttachments || attachments.length >= maxAttachmentFiles}
            onClick={() => fileInput.current?.click()}
          >
            <FileArrowUpIcon size={19} />
            选择文件
          </Button>
          <Button
            type="button"
            disabled={uploadingAttachments || !attachments.length || !book}
            onClick={() => void uploadRecordAttachments()}
          >
            {uploadingAttachments ? "处理中…" : "上传并自动记账"}
          </Button>
        </div>
      </Panel>
      {filterOpen && (
        <SelectionModal title="筛选记录" onClose={() => setFilterOpen(false)}>
          <div className="record-filter-sheet">
            <section>
              <h3>类型</h3>
              <div className="filter-segment">
                {recordTypeFilterOptions.map((item) => (
                  <Button
                    type="button"
                    variant="ghost"
                    className={draftFilters.type === item.value ? "selected" : ""}
                    key={item.value}
                    onClick={() => setDraftFilters((current) => ({ ...current, type: item.value }))}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </section>
            <section>
              <h3>排序</h3>
              <div className="filter-segment sort-segment">
                {recordSortOptions.map((item) => (
                  <Button
                    type="button"
                    variant="ghost"
                    className={draftFilters.sort === item.value ? "selected" : ""}
                    key={item.value}
                    onClick={() => setDraftFilters((current) => ({ ...current, sort: item.value }))}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </section>
            <div className="record-filter-actions">
              <Button type="button" variant="outline" onClick={resetFilters}>
                重置
              </Button>
              <Button type="button" onClick={applyDraftFilters}>
                应用筛选
              </Button>
            </div>
          </div>
        </SelectionModal>
      )}
    </>
  );
}
export function TransactionFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { book } = useActiveBook();
  const initialAmount = getPositiveNumber(searchParams.get("amount"));
  const draftKey = searchParams.get("draft") ?? getRecordDraftKey(id, book?.id ?? searchParams.get("bookId"));
  const savedDraft = !id ? readRecordDraft(draftKey) : undefined;
  const { data: existing } = useApi<{ transaction: LedgerTransaction }>(
    id ? `/transactions/${id}` : undefined,
  );
  const { data: categories } = useApi<{ categories: CategoryOption[] }>(
    book ? `/books/${book.id}/categories` : undefined,
  );
  const form = useForm({
    resolver: zodResolver(createTransactionSchema),
    values: existing?.transaction
      ? {
          ...existing.transaction,
          occurredAt: existing.transaction.occurredAt.slice(0, 10),
          items: existing.transaction.items ?? [],
        }
      : undefined,
    defaultValues: {
      type: savedDraft?.type ?? ("expense" as const),
      amount: (savedDraft?.amount ?? initialAmount ?? undefined) as unknown as number,
      occurredAt: savedDraft?.occurredAt ?? toDateInputValue(new Date()),
      note: savedDraft?.note ?? "",
      categoryId: savedDraft?.categoryId,
      items: savedDraft?.items ?? [],
    },
  });
  const [error, setError] = useState("");
  const [activePicker, setActivePicker] = useState<RecordPicker | null>(null);
  const [localCategories, setLocalCategories] = useState<CategoryOption[]>([]);
  const [categoryName, setCategoryName] = useState("");
  const selectedType = form.watch("type");
  const selectedCategoryId = form.watch("categoryId");
  const selectedDate = form.watch("occurredAt");
  const selectedAmount = form.watch("amount");
  const selectedItems = form.watch("items") ?? [];
  const selectedCategory = localCategories.find((item) => item.id === selectedCategoryId);
  const selectedTypeLabel = selectedType === "income" ? "收入" : "支出";
  const selectedDateValue = selectedDate || toDateInputValue(new Date());
  const canOpenLineItems = hasPositiveNumber(selectedAmount);
  const monthDays = getMonthDays(selectedDateValue);
  const addLocalCategory = async () => {
    const name = categoryName.trim();
    if (!name) return;
    if (!book) return setError("请先创建账本");
    try {
      const result = await api<{ category: { id: string; name: string } }>(`/books/${book.id}/categories`, {
        method: "POST",
        body: JSON.stringify({
          name,
          type: selectedType,
          icon: "tag",
          sortOrder: localCategories.length,
        }),
      });
      const category = result.category;
      setLocalCategories((current) => [
        ...current.filter((item) => item.id !== category.id),
        category,
      ]);
      form.setValue("categoryId", category.id, { shouldDirty: true, shouldValidate: true });
      form.clearErrors("categoryId");
      setCategoryName("");
      setActivePicker(null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加分类失败");
    }
  };
  const setDateValue = (value: string) => {
    form.setValue("occurredAt", value, { shouldDirty: true, shouldValidate: true });
  };
  const openLineItems = () => {
    const amount = Number(selectedAmount);
    if (!hasPositiveNumber(amount)) {
      setError("请先输入总金额");
      return;
    }
    setError("");
    writeRecordDraft(draftKey, form.getValues() as RecordDraft);
    if (!id) {
      const params = new URLSearchParams(searchParams);
      params.set("amount", String(amount));
      params.set("draft", draftKey);
      navigate({ search: params.toString() }, { replace: true });
    }
    const itemParams = new URLSearchParams();
    itemParams.set("total", String(amount));
    itemParams.set("draft", draftKey);
    const bookId = book?.id ?? searchParams.get("bookId");
    if (bookId) itemParams.set("bookId", bookId);
    navigate(`/records/new/items?${itemParams.toString()}`);
  };
  useEffect(() => {
    if (!categories?.categories) return;
    setLocalCategories((current) => [
      ...categories.categories,
      ...current.filter((item) => !categories.categories.some((category) => category.id === item.id)),
    ]);
  }, [categories?.categories]);
  const submit = (mode: "save" | "continue") => form.handleSubmit(async (value) => {
    if (!book && !existing?.transaction) return setError("请先创建账本");
    if (!value.categoryId) {
      const message = "分类必填";
      form.setError("categoryId", { type: "manual", message });
      setError(message);
      return;
    }
    try {
      const path = id ? `/transactions/${id}` : `/books/${book?.id}/transactions`;
      const payload = { ...value, items: normalizeLineItemPayload(value.items) };
      delete (payload as { memberId?: unknown }).memberId;
      delete (payload as { accountId?: unknown }).accountId;
      delete (payload as { tags?: unknown }).tags;
      delete (payload as { tagIds?: unknown }).tagIds;
      await api(path, { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setError("");
      setActivePicker(null);
      clearRecordDraft(draftKey);
      if (mode === "continue" && !id) {
        form.reset({
          type: value.type,
          amount: "" as unknown as number,
          occurredAt: value.occurredAt,
          note: "",
          categoryId: undefined,
          items: [],
        });
        return;
      }
      navigate("/records");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    }
  });
  return (
    <div className="transaction-screen">
      <Page title={id ? "编辑记录" : "新增记录"} />
      <form className="form transaction-form" onSubmit={submit("save")}>
        <div className="transaction-form-scroll">
          <div className="amount-card" role="group" aria-label="金额">
            <label className="amount-field">
              金额
              <Input
                aria-label="金额"
                type="number"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                {...form.register("amount", { valueAsNumber: true })}
              />
            </label>
          </div>
          <p className="field-error">{form.formState.errors.amount?.message}</p>
          <Panel className="record-fields">
            <label>
              <ReceiptIcon size={22} />
              <span>类型</span>
              <Button
                type="button"
                className="field-value-button"
                variant="ghost"
                aria-label={`类型 ${selectedTypeLabel}`}
                onClick={() => setActivePicker("type")}
              >
                {selectedTypeLabel}
              </Button>
            </label>
            <label>
              <SquaresFourIcon size={22} />
              <span>分类</span>
              <Button
                type="button"
                className={`field-value-button ${form.formState.errors.categoryId ? "is-error" : ""}`}
                variant="ghost"
                aria-label={`分类 ${selectedCategory?.name ?? "请选择分类"}`}
                onClick={() => setActivePicker("category")}
              >
                {selectedCategory?.name ?? "请选择分类"}
              </Button>
            </label>
            <label>
              <CalendarBlankIcon size={22} />
              <span>时间</span>
              <Button
                type="button"
                className="field-value-button"
                variant="ghost"
                aria-label={`时间 ${selectedDateValue}`}
                onClick={() => setActivePicker("date")}
              >
                {formatDateLabel(selectedDateValue)}
              </Button>
            </label>
            <label>
              <NotePencilIcon size={22} />
              <span>备注</span>
              <Input placeholder="可填写备注信息（选填）" {...form.register("note")} />
            </label>
          </Panel>
          {form.formState.errors.categoryId?.message && (
            <p className="field-error record-field-error">{form.formState.errors.categoryId.message}</p>
          )}
          <Button
            className="sub-action add-detail-row"
            type="button"
            variant="ghost"
            disabled={!canOpenLineItems}
            onClick={openLineItems}
          >
            <PlusCircleIcon size={22} />
            {selectedItems.length ? `添加明细（${selectedItems.length} 项）` : "添加明细（选填）"}
          </Button>
        </div>
        <div className="record-form-footer">
          {error && <p className="field-error">{error}</p>}
          <div className="record-form-actions">
            <Button type="submit">保存记录</Button>
            {!id && (
              <Button type="button" variant="secondary" onClick={() => void submit("continue")()}>
                保存并继续
              </Button>
            )}
          </div>
        </div>
      </form>
      {activePicker === "type" && (
        <SelectionModal title="选择类型" onClose={() => setActivePicker(null)}>
          <div className="modal-option-list">
            {(["expense", "income"] as const).map((type) => (
              <Button
                type="button"
                variant="outline"
                className={selectedType === type ? "selected" : ""}
                key={type}
                onClick={() => {
                  form.setValue("type", type, { shouldDirty: true, shouldValidate: true });
                  setActivePicker(null);
                }}
              >
                {type === "income" ? "收入" : "支出"}
              </Button>
            ))}
          </div>
        </SelectionModal>
      )}
      {activePicker === "category" && (
        <SelectionModal title="选择分类" onClose={() => setActivePicker(null)}>
          <div className="modal-option-list">
            {localCategories.map((item) => (
              <Button
                type="button"
                variant="outline"
                className={item.id === selectedCategoryId ? "selected" : ""}
                key={item.id}
                onClick={() => {
                  form.setValue("categoryId", item.id, { shouldDirty: true, shouldValidate: true });
                  form.clearErrors("categoryId");
                  setActivePicker(null);
                }}
              >
                {item.name}
              </Button>
            ))}
          </div>
          {!localCategories.length && <p className="empty-panel-text">暂无分类，先添加一个。</p>}
          <div className="inline-add modal-inline-add">
            <Input
              aria-label="分类名称"
              value={categoryName}
              placeholder="新分类名称"
              onChange={(event) => setCategoryName(event.target.value)}
            />
            <Button type="button" onClick={() => void addLocalCategory()}>
              添加分类
            </Button>
          </div>
        </SelectionModal>
      )}
      {activePicker === "date" && (
        <SelectionModal title="选择时间" onClose={() => setActivePicker(null)}>
          <div className="quick-dates">
            {[
              { label: "今天", value: toDateInputValue(new Date()) },
              { label: "昨天", value: shiftDate(toDateInputValue(new Date()), -1) },
              { label: "前天", value: shiftDate(toDateInputValue(new Date()), -2) },
            ].map((item) => (
              <Button
                type="button"
                variant="outline"
                className={selectedDateValue === item.value ? "selected" : ""}
                key={item.label}
                onClick={() => {
                  setDateValue(item.value);
                  setActivePicker(null);
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <div className="date-panel-header">
            <Button type="button" variant="ghost" onClick={() => setDateValue(shiftMonth(selectedDateValue, -1))}>
              上月
            </Button>
            <b>{formatMonthLabel(selectedDateValue)}</b>
            <Button type="button" variant="ghost" onClick={() => setDateValue(shiftMonth(selectedDateValue, 1))}>
              下月
            </Button>
          </div>
          <div className="date-grid">
            {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
              <span key={day}>{day}</span>
            ))}
            {monthDays.map((day, index) =>
              day ? (
                <Button
                  type="button"
                  variant="ghost"
                  className={day.value === selectedDateValue ? "selected" : ""}
                  key={day.value}
                  onClick={() => {
                    setDateValue(day.value);
                    setActivePicker(null);
                  }}
                >
                  {day.label}
                </Button>
              ) : (
                <i key={`blank-${index}`} />
              ),
            )}
          </div>
        </SelectionModal>
      )}
    </div>
  );
}

function SelectionModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="selection-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="selection-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <Button type="button" variant="ghost" size="icon" aria-label={`关闭${title}`} onClick={onClose}>
            <XIcon size={20} />
          </Button>
        </header>
        {children}
      </section>
    </div>
  );
}

const recordTypeFilterOptions: Array<{ label: string; value: RecordFilterType }> = [
  { label: "全部", value: "all" },
  { label: "支出", value: "expense" },
  { label: "收入", value: "income" },
];

const recordSortOptions: Array<{ label: string; value: RecordSort }> = [
  { label: "最新优先", value: "latest" },
  { label: "金额最高", value: "amount_desc" },
];

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
  const source = searchParams.get("source") === "ai" || searchParams.get("aiFilter") === "1" ? "ai" : "";
  const min = searchParams.get("min") ?? "";
  const max = searchParams.get("max") ?? "";
  const strict = booleanValue(searchParams.get("strict"));
  const minStrict = booleanValue(searchParams.get("minStrict") ?? searchParams.get("strictMin"));
  const maxStrict = booleanValue(searchParams.get("maxStrict") ?? searchParams.get("strictMax"));
  return {
    q: searchParams.get("q") ?? "",
    type: type === "expense" || type === "income" ? type : "all",
    sort: sort === "amount_desc" ? sort : "latest",
    start: searchParams.get("start") ?? "",
    end: searchParams.get("end") ?? "",
    min,
    max,
    category: searchParams.get("category") ?? "",
    source,
    chips: readChips(searchParams.get("chips")),
    minStrict: source === "ai" && Boolean(min) ? minStrict ?? strict ?? true : false,
    maxStrict: source === "ai" && Boolean(max) ? maxStrict ?? strict ?? true : false,
  };
}

function writeRecordFilters(searchParams: URLSearchParams, filters: RecordFilters) {
  const next = new URLSearchParams(searchParams);
  setParam(next, "q", filters.q.trim());
  setParam(next, "type", filters.type === "all" ? "" : filters.type);
  setParam(next, "sort", filters.sort === "latest" && filters.source !== "ai" ? "" : filters.sort);
  setParam(next, "start", filters.start);
  setParam(next, "end", filters.end);
  setParam(next, "min", filters.min.trim());
  setParam(next, "max", filters.max.trim());
  setParam(next, "category", filters.category.trim());
  setParam(next, "source", filters.source);
  next.delete("aiFilter");
  const chips = filters.source === "ai" ? filters.chips.length ? filters.chips : buildFilterChips(filters, {}) : [];
  setParam(next, "chips", writeChips(chips));
  if (filters.source === "ai" && filters.min.trim()) next.set("minStrict", filters.minStrict ? "1" : "0");
  else next.delete("minStrict");
  if (filters.source === "ai" && filters.max.trim()) next.set("maxStrict", filters.maxStrict ? "1" : "0");
  else next.delete("maxStrict");
  next.delete("strict");
  next.delete("strictMin");
  next.delete("strictMax");
  return next;
}

function clearRecordFilterParams(searchParams: URLSearchParams) {
  const next = new URLSearchParams();
  const bookId = searchParams.get("bookId");
  if (bookId) next.set("bookId", bookId);
  return next;
}

function setParam(searchParams: URLSearchParams, key: string, value: string) {
  if (value) searchParams.set(key, value);
  else searchParams.delete(key);
}

function hasActiveRecordFilters(filters: RecordFilters) {
  return Boolean(
    filters.q ||
      filters.type !== "all" ||
      filters.sort !== "latest" ||
      filters.start ||
      filters.end ||
      filters.min ||
      filters.max ||
      filters.category ||
      filters.chips.length,
  );
}

function formatFilterSummary(filters: RecordFilters, categoryNames: Record<string, string>) {
  const parts = getVisibleFilterChips(filters, categoryNames);
  return parts.length ? parts.join(" · ") : "全部记录";
}

function getVisibleFilterChips(filters: RecordFilters, categoryNames: Record<string, string>) {
  if (filters.source === "ai" && filters.chips.length) return filters.chips;
  return buildFilterChips(filters, categoryNames);
}

function buildFilterChips(filters: RecordFilters, categoryNames: Record<string, string>) {
  const parts = [
    filters.start || filters.end ? formatDateRangeLabel(filters.start, filters.end) : "",
    filters.type !== "all" ? recordTypeFilterOptions.find((item) => item.value === filters.type)?.label : "",
    filters.category ? `分类：${formatCategoryFilter(filters.category, categoryNames)}` : "",
    filters.min || filters.max ? formatAmountRangeLabel(filters) : "",
    filters.sort === "amount_desc" ? "金额最高" : "",
    filters.q ? `${filters.source === "ai" ? "搜索" : "关键词"}：${filters.q}` : "",
  ].filter((part): part is string => Boolean(part));
  return parts;
}

function formatDateRangeLabel(start: string, end: string) {
  if (!start && !end) return "全部时间";
  const today = new Date();
  const currentYear = today.getFullYear();
  if (start === `${currentYear}-01-01` && end === `${currentYear}-12-31`) return "今年";
  if (start && end) return `${start} 至 ${end}`;
  if (start) return `${start} 之后`;
  return `${end} 之前`;
}

function formatCategoryFilter(category: string, categoryNames: Record<string, string>) {
  return categoryNames[category] ?? category;
}

function formatAmountRangeLabel(filters: RecordFilters) {
  const min = filters.min.trim();
  const max = filters.max.trim();
  const minSign = filters.minStrict ? ">" : ">=";
  const maxSign = filters.maxStrict ? "<" : "<=";
  if (min && max) return `金额 ${minSign} ${min} 且 ${maxSign} ${max}`;
  if (min) return `金额 ${minSign} ${min}`;
  return `金额 ${maxSign} ${max}`;
}

function matchesRecordFilters(
  transaction: LedgerTransaction,
  filters: RecordFilters,
  categoryNames: Record<string, string>,
) {
  if (filters.type !== "all" && transaction.type !== filters.type) return false;
  const occurredAt = transaction.occurredAt.slice(0, 10);
  if (filters.start && occurredAt < filters.start) return false;
  if (filters.end && occurredAt > filters.end) return false;
  const min = Number(filters.min);
  const max = Number(filters.max);
  const category = transaction.categoryName ?? (transaction.categoryId ? categoryNames[transaction.categoryId] : "");
  if (filters.min && Number.isFinite(min)) {
    if (filters.minStrict ? transaction.amount <= min : transaction.amount < min) return false;
  }
  if (filters.max && Number.isFinite(max)) {
    if (filters.maxStrict ? transaction.amount >= max : transaction.amount > max) return false;
  }
  if (filters.category) {
    const target = filters.category.trim().toLowerCase();
    const categoryText = [transaction.categoryId, category].filter(Boolean).join(" ").toLowerCase();
    if (!categoryText.includes(target)) return false;
  }
  const keyword = filters.source === "ai" ? "" : filters.q.trim().toLowerCase();
  if (!keyword) return true;
  const searchable = [transaction.note, category, transaction.categoryId].filter(Boolean).join(" ").toLowerCase();
  return searchable.includes(keyword);
}

function compareRecordTransactions(a: LedgerTransaction, b: LedgerTransaction, sort: RecordSort) {
  if (sort === "amount_desc" && b.amount !== a.amount) return b.amount - a.amount;
  const dateDiff = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
  if (dateDiff !== 0) return dateDiff;
  return a.id.localeCompare(b.id);
}

function buildAiBaseFilters(filters: RecordFilters) {
  return {
    ...(filters.type === "all" ? {} : { type: filters.type }),
    sort: filters.sort,
  };
}

function getClientTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
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
  const minSource = payload.min ?? payload.minAmount ?? amount?.min;
  const maxSource = payload.max ?? payload.maxAmount ?? amount?.max;
  const strict = booleanValue(payload.strict);
  const strictObject = objectValue(payload.strict);
  const minObject = objectValue(minSource);
  const maxObject = objectValue(maxSource);
  const type = stringValue(payload.type);
  const sort = stringValue(payload.sort);
  const category =
    stringValue(payload.category) ?? stringValue(payload.categoryId) ?? stringValue(payload.categoryName);
  const chips = normalizeChips(result.chips ?? payload.chips);
  const extracted: Partial<RecordFilters> = {};
  if (type === "expense" || type === "income") extracted.type = type;
  if (sort === "latest" || sort === "amount_desc") extracted.sort = sort;
  if (chips.length) extracted.chips = chips;
  const start = stringValue(payload.start) ?? stringValue(payload.from);
  const end = stringValue(payload.end) ?? stringValue(payload.to);
  const min = numberStringValue(minSource);
  const max = numberStringValue(maxSource);
  if (start) extracted.start = start;
  if (end) extracted.end = end;
  if (min) extracted.min = min;
  if (max) extracted.max = max;
  if (category) extracted.category = category;
  const minStrict =
    booleanValue(payload.minStrict ?? payload.strictMin ?? strictObject?.min ?? minObject?.strict) ?? strict;
  const maxStrict =
    booleanValue(payload.maxStrict ?? payload.strictMax ?? strictObject?.max ?? maxObject?.strict) ?? strict;
  if (minStrict !== undefined) extracted.minStrict = minStrict;
  if (maxStrict !== undefined) extracted.maxStrict = maxStrict;
  return extracted;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberStringValue(value: unknown): string | undefined {
  const object = objectValue(value);
  if (object) return numberStringValue(object.value ?? object.amount);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return value.trim();
  return undefined;
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
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    // Fall through to the compact URL format.
  }
  return value.split("|").map((item) => item.trim()).filter(Boolean);
}

function writeChips(chips: string[]) {
  return chips.map((item) => item.trim()).filter(Boolean).join("|");
}

function formatDateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}
function formatMonthLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
  });
}
function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}
function shiftMonth(value: string, months: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return toDateInputValue(date);
}
function getMonthDays(value: string) {
  const date = new Date(`${value}T00:00:00`);
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const leading = (first.getDay() + 6) % 7;
  const total = new Date(year, month + 1, 0).getDate();
  return [
    ...Array.from<null>({ length: leading }).fill(null),
    ...Array.from({ length: total }, (_, index) => {
      const day = index + 1;
      const dayDate = new Date(year, month, day);
      return {
        label: String(day),
        value: toDateInputValue(dayDate),
      };
    }),
  ];
}
function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function getPositiveNumber(value: unknown) {
  const number = Number(value);
  return hasPositiveNumber(number) ? number : undefined;
}
function hasPositiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function createImportAttachment(file: File): ImportAttachmentView {
  const canPreview = file.type.startsWith("image/") && typeof URL.createObjectURL === "function";
  return {
    id: `attachment_${crypto.randomUUID()}`,
    file,
    status: "idle",
    ...(canPreview ? { previewUrl: URL.createObjectURL(file) } : {}),
  };
}

function formatActiveImportSummary(imports: ImportJobStatus[]) {
  const first = imports[0];
  if (!first) return "";
  if (first.status === "ai_processing") return imports.length > 1 ? `${imports.length} 个文件，AI 分析中` : "AI 分析中";
  if (typeof first.currentPage === "number" && typeof first.totalPages === "number") {
    return imports.length > 1
      ? `${imports.length} 个文件，第 ${first.currentPage}/${first.totalPages} 页`
      : `第 ${first.currentPage}/${first.totalPages} 页`;
  }
  if (typeof first.progress === "number" && first.progress > 0) {
    return imports.length > 1 ? `${imports.length} 个文件，OCR ${first.progress}%` : `OCR ${first.progress}%`;
  }
  return `${imports.length} 个文件正在识别`;
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
    window.sessionStorage.setItem(
      key,
      JSON.stringify({
        type: value.type,
        amount: value.amount,
        occurredAt: value.occurredAt,
        note: value.note ?? "",
        categoryId: value.categoryId,
        items: normalizeLineItemPayload(value.items),
      }),
    );
  } catch {
    // Session storage is only used to keep the local form draft while moving between record subpages.
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
  return items.map((item) => ({
    id: crypto.randomUUID(),
    name: item.name,
    amount: String(item.amount),
  }));
}

export function AddLineItemsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const draftKey = searchParams.get("draft") ?? getRecordDraftKey(undefined, searchParams.get("bookId"));
  const savedDraft = readRecordDraft(draftKey);
  const total = Number(searchParams.get("total") ?? savedDraft?.amount ?? "");
  const hasTotal = Number.isFinite(total) && total > 0;
  const [items, setItems] = useState(() => getInitialLineItemRows(savedDraft?.items));
  const assigned = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const updateItem = (id: string, field: "name" | "amount", value: string) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  const addItem = () =>
    setItems((current) => [...current, { id: crypto.randomUUID(), name: "", amount: "" }]);
  const removeItem = (id: string) =>
    setItems((current) =>
      current.length === 1
        ? current.map((item) => (item.id === id ? { ...item, name: "", amount: "" } : item))
        : current.filter((item) => item.id !== id),
    );
  const saveItems = () => {
    const next = {
      ...(savedDraft ?? {
        type: "expense" as const,
        amount: total,
        occurredAt: toDateInputValue(new Date()),
        note: "",
      }),
      amount: savedDraft?.amount ?? total,
      items: normalizeLineItemRows(items),
    };
    writeRecordDraft(draftKey, next);
    const params = new URLSearchParams();
    const bookId = searchParams.get("bookId");
    if (bookId) params.set("bookId", bookId);
    params.set("amount", String(total));
    params.set("draft", draftKey);
    navigate(`/records/new?${params.toString()}`);
  };
  return (
    <div className="line-items-screen">
      <Page title="添加明细" />
      {!hasTotal ? (
        <>
          <div className="line-items-scroll">
            <Panel>
              <h2>请先输入总金额</h2>
              <p className="muted">返回新增记录页面，输入总金额后再添加明细。</p>
            </Panel>
          </div>
          <div className="line-items-footer">
            <Button type="button" onClick={() => navigate(-1)}>
              返回输入金额
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="line-items-scroll">
            <Panel className="line-summary">
              <span className="line-summary-icon">
                <ReceiptIcon size={26} weight="fill" />
              </span>
              <div className="line-summary-total">
                <small>总金额</small>
                <b>{money(total)}</b>
              </div>
              <i />
              <div className="line-summary-balance">
                <p>
                  <small>已分配</small>
                  <b>{money(assigned)}</b>
                </p>
                <p>
                  <small>剩余</small>
                  <em className={total - assigned < 0 ? "expense" : "income"}>{money(total - assigned)}</em>
                </p>
              </div>
            </Panel>
            <Panel className="line-items">
              {items.map((item) => (
                <label key={item.id}>
                  <Input
                    aria-label="明细名称"
                    value={item.name}
                    placeholder="输入明细名称"
                    onChange={(event) => updateItem(item.id, "name", event.target.value)}
                  />
                  <Input
                    aria-label="明细金额"
                    inputMode="decimal"
                    value={item.amount}
                    placeholder="¥0.00"
                    onChange={(event) => updateItem(item.id, "amount", event.target.value)}
                  />
                  <Button
                    className="line-item-delete"
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="删除明细"
                    onClick={() => removeItem(item.id)}
                  >
                    <TrashIcon size={18} />
                  </Button>
                </label>
              ))}
              <Button className="line-item-add" type="button" variant="ghost" onClick={addItem}>
                <PlusCircleIcon size={18} />
                添加一项
              </Button>
            </Panel>
          </div>
          <div className="line-items-footer">
            <Button type="button" onClick={saveItems}>
              保存明细
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
export function RecordDetailPage() {
  const { id } = useParams();
  const { data, error } = useApi<{ transaction: LedgerTransaction }>(id ? `/transactions/${id}` : undefined);
  const transaction = data?.transaction;
  if (error)
    return (
      <>
        <Page title="记录详情" />
        <p className="field-error">{error}</p>
      </>
    );
  if (!transaction)
    return (
      <>
        <Page title="记录详情" />
        <p className="muted">正在读取记录…</p>
      </>
    );
  return (
    <>
      <Page
        title="记录详情"
        action={
          <Button asChild className="text-action" variant="ghost">
            <Link to={`/records/${transaction.id}/edit`}>编辑</Link>
          </Button>
        }
      />
      <Panel className="detail-amount">
        <h1 className={transaction.type}>
          {transaction.type === "income" ? "+" : "-"}
          {money(transaction.amount)}
        </h1>
        <p>{transaction.note || "未命名记录"}</p>
      </Panel>
      <Panel className="detail-grid">
        <p>
          <span>日期</span>
          {new Date(transaction.occurredAt).toLocaleDateString("zh-CN")}
        </p>
        <p>
          <span>分类</span>
          {transaction.categoryId ?? "未分类"}
        </p>
        <p>
          <span>备注</span>
          {transaction.note || "—"}
        </p>
      </Panel>
    </>
  );
}
