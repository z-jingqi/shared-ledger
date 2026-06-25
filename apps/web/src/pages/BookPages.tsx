import { zodResolver } from "@hookform/resolvers/zod";
import {
  BookOpenIcon,
  CaretDownIcon,
  CaretRightIcon,
  CircleNotchIcon,
  GearIcon,
  PlusIcon,
  CheckIcon,
  UsersIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { createBookSchema } from "@shared-ledger/shared";
import {
  Button,
  Input,
  Panel,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@shared-ledger/ui";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { TransactionList, type LedgerTransaction } from "../components/ledger/Transactions";
import { Page } from "../components/layout/Page";
import { useActiveBook, writeLastActiveBookId } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api, money } from "../lib";

type Book = { id: string; name: string; currency: string };
type TransactionResponse = { transactions: LedgerTransaction[] };
type ImportResponse = {
  imports: Array<{
    id?: string;
    fileName?: string;
    status: string;
    progress?: number;
    stage?: string;
    currentPage?: number;
    totalPages?: number;
  }>;
};
export function BookHomePage() {
  const { book, books, loading, error, setActiveBook } = useActiveBook();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const { data: txData } = useApi<TransactionResponse>(book ? `/books/${book.id}/transactions` : undefined);
  const { data: imports } = useApi<ImportResponse>(book ? `/books/${book.id}/imports` : undefined);
  if (loading) return <p className="muted auth-loading">正在读取账本…</p>;
  if (error) return <p className="field-error">{error}</p>;
  if (!book)
    return (
      <section className="home-empty" aria-label="暂无账本">
        <p>还没有账本</p>
        <Link to="/books/new">创建一个</Link>
      </section>
    );
  const transactions = txData?.transactions ?? [];
  const monthTransactions = transactions.filter((item) => isSameMonth(item.occurredAt, new Date()));
  const todayTransactions = transactions.filter((item) => isSameDay(item.occurredAt, new Date()));
  const recentTransactions = [...transactions]
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
    .slice(0, 5);
  const income = monthTransactions
    .filter((item) => item.type === "income")
    .reduce((sum, item) => sum + item.amount, 0);
  const expense = monthTransactions
    .filter((item) => item.type === "expense")
    .reduce((sum, item) => sum + item.amount, 0);
  const todayExpense = todayTransactions
    .filter((item) => item.type === "expense")
    .reduce((sum, item) => sum + item.amount, 0);
  const importJobs = imports?.imports ?? [];
  const pending = importJobs.filter((item) => item.status === "pending_confirmation").length;
  const processingJobs = importJobs.filter((item) =>
    ["uploaded", "parsing", "converting", "ocr_processing", "ai_processing"].includes(item.status),
  );
  const processing = processingJobs.length;
  const failed = importJobs.filter((item) => item.status === "failed").length;
  return (
    <>
      <header className="book-home-title">
        <button
          className="book-switcher-trigger"
          type="button"
          aria-label={`切换账本，当前账本 ${book.name}`}
          aria-expanded={switcherOpen}
          onClick={() => setSwitcherOpen(true)}
        >
          {book.name} <CaretDownIcon size={18} />
        </button>
        <Link className="icon-link" to={`/books/${book.id}/settings`} aria-label="账本设置">
          <GearIcon size={29} />
        </Link>
      </header>
      {processing > 0 && (
        <Link className="processing-strip" to="/records/imports">
          <CircleNotchIcon size={22} weight="fill" />
          <span>
            <b>正在处理</b>
            <small>{formatHomeImportProgress(processingJobs)}</small>
          </span>
          <CaretRightIcon size={20} />
        </Link>
      )}
      <Panel className="summary">
        <div>
          <span>
            {new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long" })}{" "}
            <CaretDownIcon size={16} />
          </span>
          <small>本月汇总</small>
        </div>
        <section>
          <p>
            本月收入<b className="income">{money(income)}</b>
          </p>
          <p>
            本月支出<b>{money(expense)}</b>
          </p>
          <p>
            结余<b className="income">{money(income - expense)}</b>
          </p>
        </section>
      </Panel>
      <Panel className="today-overview">
        <h2>今日概览</h2>
        <section>
          <p>
            <span>记录笔数</span>
            <b>{todayTransactions.length} 笔</b>
          </p>
          <p>
            <span>今日支出</span>
            <b>{money(todayExpense)}</b>
          </p>
        </section>
      </Panel>
      {(pending > 0 || failed > 0) && (
        <Link className="pending-strip" to={pending > 0 ? "/records/pending" : "/records/imports"}>
          <CircleNotchIcon size={22} weight="fill" />
          <b>
            {pending > 0 ? "待确认记录" : "文件处理失败"} <em>{pending > 0 ? pending : failed}</em>
          </b>
          <CaretRightIcon size={22} />
        </Link>
      )}
      <Panel>
        <header className="section-header">
          <h2>最近记录</h2>
          <Link to="/records">
            查看全部 <CaretRightIcon />
          </Link>
        </header>
        <TransactionList transactions={recentTransactions} compact />
      </Panel>
      {switcherOpen && (
        <BookSwitcherSheet
          books={books}
          currentBookId={book.id}
          onSelect={(bookId) => {
            setActiveBook(bookId);
            setSwitcherOpen(false);
          }}
          close={() => setSwitcherOpen(false)}
        />
      )}
    </>
  );
}
export function BooksPage() {
  const { book, books, loading, error } = useActiveBook();
  const location = useLocation();
  const isManageRoute = location.pathname === "/books/manage";
  return (
    <>
      <Page title={isManageRoute ? "账本管理" : "账本"} back={false} />
      {loading && <p className="muted">正在读取账本…</p>}
      {error && <p className="field-error">{error}</p>}
      {!loading && !error && books.length === 0 && (
        <section className="books-empty" aria-label="暂无账本">
          <p>当前还没有账本</p>
          <Link to="/books/new">创建一个</Link>
        </section>
      )}
      {books.length > 0 && (
        <section className="books-layout">
          <h2 className="section-kicker">我加入的账本</h2>
          <div className="book-list-scroll">
            {books.map((item) => (
              <Link
                className={`book-card${item.id === book?.id ? " current" : ""}`}
                to={`/home?bookId=${item.id}`}
                onClick={() => writeLastActiveBookId(item.id)}
                key={item.id}
              >
                <span className="book-card-icon">
                  <BookOpenIcon size={36} weight="fill" />
                </span>
                <div className="book-card-main">
                  <h2>{item.name}</h2>
                  <p>{item.currency}</p>
                  {item.id === book?.id && <small>当前账本</small>}
                </div>
                <CaretRightIcon />
              </Link>
            ))}
          </div>
          <Link className="primary-wide book-create-cta" to="/books/new">
            <PlusIcon size={24} weight="bold" />
            创建账本
          </Link>
        </section>
      )}
    </>
  );
}
export function CreateBookPage() {
  const navigate = useNavigate();
  const form = useForm({
    resolver: zodResolver(createBookSchema),
    defaultValues: { name: "", currency: "CNY", note: "" },
  });
  const [error, setError] = useState("");
  const currency = form.watch("currency");
  const note = form.watch("note") ?? "";
  const submit = form.handleSubmit(async (value) => {
    try {
      const result = await api<{ book: Book }>("/books", { method: "POST", body: JSON.stringify(value) });
      writeLastActiveBookId(result.book.id);
      navigate(`/home?bookId=${result.book.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败");
    }
  });
  return (
    <form className="form create-book-screen" onSubmit={submit}>
      <Page title="创建账本" />
      <div className="create-book-scroll">
        <section className="create-book-intro">
          <span>
            <WalletIcon size={38} />
          </span>
          <p>创建一个新账本，开始管理你的收支</p>
        </section>
        <Panel>
          <label className="create-book-field">
            账本名称
            <Input placeholder="请输入账本名称" {...form.register("name")} />
            <span className="field-error">{form.formState.errors.name?.message}</span>
          </label>
          <label className="create-book-field">
            默认货币
            <Select
              value={currency}
              onValueChange={(value) => form.setValue("currency", value, { shouldDirty: true, shouldValidate: true })}
            >
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
          </label>
          <label className="create-book-field">
            备注（可选）
            <Textarea placeholder="输入备注信息（可选）" maxLength={100} {...form.register("note")} />
            <span className="note-count">{note.length}/100</span>
          </label>
        </Panel>
        {error && <p className="field-error">{error}</p>}
      </div>
      <Button type="submit">创建账本</Button>
    </form>
  );
}

function BookSwitcherSheet({
  books,
  currentBookId,
  onSelect,
  close,
}: {
  books: Book[];
  currentBookId: string;
  onSelect: (bookId: string) => void;
  close: () => void;
}) {
  return (
    <>
      <button className="book-switcher-backdrop" type="button" aria-label="关闭账本切换器" onClick={close} />
      <section className="book-switcher-sheet" role="dialog" aria-modal="true" aria-label="切换账本">
        <span className="sheet-grabber" aria-hidden="true" />
        <h2>切换账本</h2>
        <div className="book-switcher-list">
          {books.map((book) => (
            <button
              className={book.id === currentBookId ? "selected" : ""}
              type="button"
              onClick={() => onSelect(book.id)}
              key={book.id}
            >
              <span className="book-switcher-icon">
                <BookOpenIcon size={20} weight="fill" />
              </span>
              <span>
                <b>{book.name}</b>
                {book.id === currentBookId && <small>当前账本</small>}
              </span>
              {book.id === currentBookId && <CheckIcon size={19} weight="bold" />}
            </button>
          ))}
        </div>
        <div className="book-switcher-actions">
          <Link to="/books/new" onClick={close}>
            <PlusIcon size={20} weight="bold" />
            创建新账本
          </Link>
          <Link to="/books/manage" onClick={close}>
            <UsersIcon size={20} />
            管理账本
          </Link>
        </div>
      </section>
    </>
  );
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

function formatHomeImportProgress(jobs: ImportResponse["imports"]) {
  const first = jobs[0];
  if (!first) return "";
  if (first.status === "ai_processing") return jobs.length > 1 ? `${jobs.length} 个文件，AI 分析中` : "AI 分析中";
  if (typeof first.currentPage === "number" && typeof first.totalPages === "number") {
    return jobs.length > 1
      ? `${jobs.length} 个文件，第 ${first.currentPage}/${first.totalPages} 页`
      : `第 ${first.currentPage}/${first.totalPages} 页`;
  }
  if (typeof first.progress === "number" && first.progress > 0) {
    return jobs.length > 1 ? `${jobs.length} 个文件，OCR ${first.progress}%` : `OCR ${first.progress}%`;
  }
  return `${jobs.length} 个文件正在识别`;
}
