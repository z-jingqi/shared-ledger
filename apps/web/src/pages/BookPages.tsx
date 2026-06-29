import { zodResolver } from "@hookform/resolvers/zod";
import {
  CalendarBlankIcon,
  CaretRightIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { createBookSchema } from "@shared-ledger/shared";
import { Input, Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue, Textarea } from "@shared-ledger/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { BookSwitcherSheet } from "../components/books/BookSwitcherSheet";
import { IosTransactionRow, type LedgerTransaction } from "../components/ledger/Transactions";
import {
  AiSparkButton,
  BookMark,
  IconTile,
  IosButton,
  IosCard,
  IosField,
  IosListSkeleton,
  IosPage,
  IosScroll,
  IosTopBar,
  yuan,
} from "../components/ios/IosDesign";
import { useAppSheetActions } from "../features/sheets/SheetContext";
import { useActiveBook, writeLastActiveBookId } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api } from "../lib";

type Book = { id: string; name: string; currency: string };
type TransactionResponse = { transactions: LedgerTransaction[] };
type ImportJob = {
  id?: string;
  fileName?: string;
  status: string;
  progress?: number;
  stage?: string;
  currentPage?: number;
  totalPages?: number;
};
type ImportResponse = { imports: ImportJob[] };

export function BookHomePage() {
  const { book, books, loading, setActiveBook } = useActiveBook();
  const { openSheet } = useAppSheetActions();
  const [bookSwitcherOpen, setBookSwitcherOpen] = useState(false);
  const { data: txData, loading: transactionsLoading } = useApi<TransactionResponse>(book ? `/books/${book.id}/transactions` : undefined);
  const { data: imports } = useApi<ImportResponse>(book ? `/books/${book.id}/imports` : undefined);
  const hasBook = Boolean(book?.id);
  const displayBook = book ?? { id: "", name: "一起记", currency: "CNY" };
  const transactions = txData?.transactions ?? [];
  const monthTransactions = transactions.filter((item) => isSameMonth(item.occurredAt, new Date()));
  const todayTransactions = transactions.filter((item) => isSameDay(item.occurredAt, new Date()));
  const income = sum(monthTransactions, "income");
  const expense = sum(monthTransactions, "expense");
  const todayExpense = sum(todayTransactions, "expense");
  const importJobs = imports?.imports ?? [];
  const processing = importJobs.filter(isProcessingJob);
  const pending = importJobs.filter((job) => job.status === "pending_confirmation");
  const failed = importJobs.filter((job) => job.status === "failed");
  const recent = [...transactions]
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
    .slice(0, 5);

  if (loading)
    return (
      <IosPage>
        <IosScroll className="ios-main-tab-scroll">
          <IosCard>
            <IosListSkeleton rows={4} />
          </IosCard>
        </IosScroll>
      </IosPage>
    );
  const openRecordForm = () => {
    if (!hasBook) {
      toast.error("请先创建或选择账本", { duration: 3000, closeButton: true });
      return;
    }
    openSheet({ type: "record-form", initialType: "expense" });
  };

  return (
    <IosPage className="ios-home">
      <IosTopBar
        book={hasBook ? book : undefined}
        title={hasBook ? undefined : "一起记"}
        onLedgerClick={hasBook ? () => setBookSwitcherOpen(true) : undefined}
        action={<AiSparkButton onClick={() => openSheet({ type: "ai" })} />}
      />
      <IosScroll className="ios-home-scroll">
        <section className="ios-balance-hero">
          <span>6月净收支</span>
          <strong>{yuan(income - expense, displayBook.currency)}</strong>
          <div>
            <p>
              <small>收入</small>
              <b>{yuan(income, displayBook.currency)}</b>
            </p>
            <p>
              <small>支出</small>
              <b>{yuan(expense, displayBook.currency)}</b>
            </p>
          </div>
        </section>

        <IosCard className="ios-today-card">
          <IconTile>
            <CalendarBlankIcon size={19} />
          </IconTile>
          <div>
            <b>今日记账</b>
            <small>
              {todayTransactions.length} 笔 · 支出 {yuan(todayExpense, displayBook.currency)}
            </small>
          </div>
          <button type="button" onClick={openRecordForm}>继续记账</button>
        </IosCard>

        {(processing.length > 0 || pending.length > 0 || failed.length > 0) && (
          <section className="ios-section">
            <h2>待处理</h2>
            <div className="ios-reminder-list">
              {processing.length > 0 && (
                <button className="ios-reminder-row" type="button" onClick={() => openSheet({ type: "imports" })}>
                  <IconTile tint="#eaf1ff" color="#4c8dff">
                    {processing.length}
                  </IconTile>
                  <span>
                    <b>{processing.length} 个文件正在识别</b>
                    <small>{formatHomeImportProgress(processing)} — 点击查看进度</small>
                  </span>
                  <CaretRightIcon size={18} />
                </button>
              )}
              {pending.length > 0 && (
                <button className="ios-reminder-row" type="button" onClick={() => openSheet({ type: "pending-imports" })}>
                  <IconTile>{pending.length}</IconTile>
                  <span>
                    <b>{pending.length} 条待确认记录</b>
                    <small>来自文件识别与 AI — 需你审核入账</small>
                  </span>
                  <CaretRightIcon size={18} />
                </button>
              )}
              {failed.length > 0 && (
                <button className="ios-reminder-row danger" type="button" onClick={() => openSheet({ type: "imports" })}>
                  <IconTile tint="#fdeceb" color="#d74035">
                    {failed.length}
                  </IconTile>
                  <span>
                    <b>{failed.length} 个文件处理失败</b>
                    <small>查看失败原因或重试</small>
                  </span>
                  <CaretRightIcon size={18} />
                </button>
              )}
            </div>
          </section>
        )}

        <section className="ios-section">
          <header>
            <h2>最近交易</h2>
            {hasBook ? <Link to={`/records?bookId=${book!.id}`}>查看全部</Link> : <Link to="/books/new">创建账本</Link>}
          </header>
          <IosCard className="ios-transaction-card">
            {hasBook && transactionsLoading ? (
              <IosListSkeleton rows={3} />
            ) : recent.length ? (
              recent.map((item) => <IosTransactionRow transaction={item} currency={displayBook.currency} key={item.id} />)
            ) : (
              <div className="ios-transaction-empty" data-testid="recent-empty-state">
                {hasBook ? (
                  <p>还没有记录，记下第一笔吧。</p>
                ) : (
                  <>
                    <b>还没有账本</b>
                    <p>创建一个账本后就可以开始记账。</p>
                  </>
                )}
              </div>
            )}
          </IosCard>
        </section>
      </IosScroll>
      {bookSwitcherOpen && book && (
        <BookSwitcherSheet
          books={books}
          currentBookId={book.id}
          onSelect={(bookId) => {
            setActiveBook(bookId);
            setBookSwitcherOpen(false);
          }}
          close={() => setBookSwitcherOpen(false)}
        />
      )}
    </IosPage>
  );
}

export function BooksPage() {
  const { book, books, loading, error } = useActiveBook();
  const navigate = useNavigate();
  return (
    <IosPage>
      <IosTopBar title="管理账本" back onBack={() => navigate("/settings")} />
      <IosScroll className="ios-book-list-screen">
        {loading && <IosListSkeleton rows={3} />}
        {error && <p className="field-error">{error}</p>}
        {!loading && !error && books.length === 0 && (
          <div className="ios-empty">
            <b>当前还没有账本</b>
            <Link className="ios-link-button" to="/books/new?source=manage">创建一个</Link>
          </div>
        )}
        {books.map((item) => {
          const active = item.id === book?.id;
          return (
            <button
              className={`ios-book-list-row${active ? " active" : ""}`}
              type="button"
              onClick={() => navigate(`/books/${item.id}/settings`, { replace: false })}
              key={item.id}
            >
              <BookMark book={item} size={44} />
              <span>
                <b>{item.name}</b>
                <small>{item.currency} · {active ? "当前账本 · 点击管理" : "点击管理"}</small>
              </span>
              <CaretRightIcon size={18} />
            </button>
          );
        })}
        <Link className="ios-create-book-row ios-button primary" to="/books/new?source=manage">
          <b>创建新账本</b>
        </Link>
      </IosScroll>
    </IosPage>
  );
}

export function CreateBookPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const source = new URLSearchParams(location.search).get("source");
  const fromManage = source === "manage";
  const form = useForm({
    resolver: zodResolver(createBookSchema),
    defaultValues: { name: "", currency: "CNY", note: "" },
  });
  const [error, setError] = useState("");
  const currency = form.watch("currency");
  const submit = form.handleSubmit(async (value) => {
    try {
      const result = await api<{ book: Book }>("/books", { method: "POST", body: JSON.stringify(value) });
      if (fromManage) {
        navigate("/books/manage");
      } else {
        writeLastActiveBookId(result.book.id);
        navigate(`/home?bookId=${result.book.id}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败");
    }
  });
  return (
    <form className="ios-create-book-screen" onSubmit={submit}>
      <IosTopBar title="创建账本" back onBack={() => navigate(fromManage ? "/books/manage" : "/home")} />
      <IosScroll className="ios-create-book-scroll">
        <section className="ios-create-book-hero">
          <IconTile>
            <WalletIcon size={28} weight="fill" />
          </IconTile>
          <h1>创建一个新账本</h1>
          <p>用于家庭、旅行、合租或任何需要多人共同维护的收支场景。</p>
        </section>
        <IosCard className="ios-form-card">
          <IosField label="账本名称" error={form.formState.errors.name?.message}>
            <Input placeholder="例如：家庭账本" {...form.register("name")} />
          </IosField>
          <IosField label="默认货币">
            <Select value={currency} onValueChange={(value) => form.setValue("currency", value, { shouldDirty: true, shouldValidate: true })}>
              <SelectTrigger aria-label="默认货币">
                <SelectValue placeholder="请选择货币" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="CNY">CNY 人民币</SelectItem>
                  <SelectItem value="USD">USD 美元</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </IosField>
          <IosField label="备注（可选）">
            <Textarea placeholder="这个账本用来记录什么？" maxLength={100} {...form.register("note")} />
          </IosField>
        </IosCard>
        {error && <p className="field-error">{error}</p>}
      </IosScroll>
      <footer className="ios-fixed-footer">
        <IosButton type="submit">创建账本</IosButton>
      </footer>
    </form>
  );
}

function sum(transactions: LedgerTransaction[], type: "income" | "expense") {
  return transactions.filter((item) => item.type === type).reduce((total, item) => total + item.amount, 0);
}

function isSameMonth(value: string, now: Date) {
  const date = new Date(value);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function isSameDay(value: string, now: Date) {
  const date = new Date(value);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function isProcessingJob(job: ImportJob) {
  return ["uploaded", "parsing", "ocr_processing", "ai_processing"].includes(job.status);
}

function formatHomeImportProgress(jobs: ImportJob[]) {
  const first = jobs[0];
  if (!first) return "";
  if (first.status === "ai_processing") return jobs.length > 1 ? `${jobs.length} 个文件，AI 分析中` : "AI 分析中";
  if (first.stage === "converting") return jobs.length > 1 ? `${jobs.length} 个文件，正在转换图片` : "正在转换图片";
  if (first.stage === "compressing") return jobs.length > 1 ? `${jobs.length} 个文件，正在压缩图片` : "正在压缩图片";
  if (typeof first.currentPage === "number" && typeof first.totalPages === "number") {
    return jobs.length > 1 ? `${jobs.length} 个文件，第 ${first.currentPage}/${first.totalPages} 页` : `第 ${first.currentPage}/${first.totalPages} 页`;
  }
  if (typeof first.progress === "number" && first.progress > 0) {
    return jobs.length > 1 ? `${jobs.length} 个文件，OCR ${first.progress}%` : `OCR ${first.progress}%`;
  }
  return `${jobs.length} 个文件正在识别`;
}
