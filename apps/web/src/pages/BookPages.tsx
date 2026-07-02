import { CalendarBlankIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { BookSwitcherSheet } from "../components/books/BookSwitcherSheet";
import { IosTransactionRow, type LedgerTransaction } from "../components/ledger/Transactions";
import {
  AiSparkButton,
  IconTile,
  IosCard,
  IosListSkeleton,
  IosPage,
  IosScroll,
  IosTopBar,
} from "../components/ios/IosDesign";
import { yuan } from "../features/formatting/money";
import { useAppSheetActions } from "../features/sheets/SheetContext";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";

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
  const { data: txData, loading: transactionsLoading } = useApi<TransactionResponse>(
    book ? `/books/${book.id}/transactions` : undefined,
  );
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
          <button type="button" onClick={openRecordForm}>
            继续记账
          </button>
        </IosCard>

        {(processing.length > 0 || pending.length > 0 || failed.length > 0) && (
          <section className="ios-section">
            <h2>待处理</h2>
            <div className="ios-reminder-list">
              {processing.length > 0 && (
                <button
                  className="ios-reminder-row"
                  type="button"
                  onClick={() => openSheet({ type: "imports" })}
                >
                  <IconTile tint="#eaf1ff" color="#4c8dff">
                    {processing.length}
                  </IconTile>
                  <span>
                    <b>{processing.length} 张图片正在识别</b>
                    <small>{formatHomeImportProgress(processing)} — 点击查看进度</small>
                  </span>
                  <CaretRightIcon size={18} />
                </button>
              )}
              {pending.length > 0 && (
                <button
                  className="ios-reminder-row"
                  type="button"
                  onClick={() => openSheet({ type: "pending-imports" })}
                >
                  <IconTile>{pending.length}</IconTile>
                  <span>
                    <b>{pending.length} 条待确认记录</b>
                    <small>来自图片识别与 AI — 需你审核入账</small>
                  </span>
                  <CaretRightIcon size={18} />
                </button>
              )}
              {failed.length > 0 && (
                <button
                  className="ios-reminder-row danger"
                  type="button"
                  onClick={() => openSheet({ type: "imports" })}
                >
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
            {hasBook ? (
              <Link to={`/records?bookId=${book!.id}`}>查看全部</Link>
            ) : (
              <Link to="/books/new">创建账本</Link>
            )}
          </header>
          <IosCard className="ios-transaction-card">
            {hasBook && transactionsLoading ? (
              <IosListSkeleton rows={3} />
            ) : recent.length ? (
              recent.map((item) => (
                <IosTransactionRow transaction={item} currency={displayBook.currency} key={item.id} />
              ))
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

function sum(transactions: LedgerTransaction[], type: "income" | "expense") {
  return transactions.filter((item) => item.type === type).reduce((total, item) => total + item.amount, 0);
}

function isSameMonth(value: string, now: Date) {
  const date = new Date(value);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function isSameDay(value: string, now: Date) {
  const date = new Date(value);
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function isProcessingJob(job: ImportJob) {
  return ["uploaded", "parsing", "ocr_processing", "ai_processing"].includes(job.status);
}

function formatHomeImportProgress(jobs: ImportJob[]) {
  const first = jobs[0];
  if (!first) return "";
  if (first.status === "ai_processing")
    return jobs.length > 1 ? `${jobs.length} 个文件，AI 分析中` : "AI 分析中";
  if (typeof first.currentPage === "number" && typeof first.totalPages === "number") {
    return jobs.length > 1
      ? `${jobs.length} 个文件，第 ${first.currentPage}/${first.totalPages} 页`
      : `第 ${first.currentPage}/${first.totalPages} 页`;
  }
  if (typeof first.progress === "number" && first.progress > 0) {
    return jobs.length > 1 ? `${jobs.length} 个文件，OCR ${first.progress}%` : `OCR ${first.progress}%`;
  }
  return `${jobs.length} 张图片正在识别`;
}
