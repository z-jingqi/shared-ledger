import { zodResolver } from "@hookform/resolvers/zod";
import {
  BookOpenIcon,
  CaretDownIcon,
  CaretRightIcon,
  ChartPieSliceIcon,
  CircleNotchIcon,
  GearIcon,
  PlusIcon,
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
  Switch,
  Textarea,
} from "@shared-ledger/ui";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { TransactionList, type LedgerTransaction } from "../components/ledger/Transactions";
import { Page } from "../components/layout/Page";
import { useApi } from "../hooks/useApi";
import { api, money } from "../lib";

type Book = { id: string; name: string; currency: string };
type TransactionResponse = { transactions: LedgerTransaction[] };
type ImportResponse = { imports: Array<{ status: string }> };
export function BookHomePage() {
  const { id } = useParams();
  const { data: bookData } = useApi<{ book: Book }>(id ? `/books/${id}` : undefined);
  const { data: txData } = useApi<TransactionResponse>(id ? `/books/${id}/transactions` : undefined);
  const { data: imports } = useApi<ImportResponse>(id ? `/books/${id}/imports` : undefined);
  const transactions = txData?.transactions ?? [];
  const income = transactions
    .filter((item) => item.type === "income")
    .reduce((sum, item) => sum + item.amount, 0);
  const expense = transactions
    .filter((item) => item.type === "expense")
    .reduce((sum, item) => sum + item.amount, 0);
  const pending = imports?.imports.filter((item) => item.status === "pending_confirmation").length ?? 0;
  return (
    <>
      <header className="book-home-title">
        <h1>
          {bookData?.book.name ?? "账本"} <CaretDownIcon size={22} />
        </h1>
        <Link className="icon-link" to={`/books/${id}/settings`} aria-label="账本设置">
          <GearIcon size={29} />
        </Link>
      </header>
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
      <Link className="pending-strip" to="/imports/pending">
        <CircleNotchIcon size={22} weight="fill" />
        <b>
          待确认 <em>{pending}</em>
        </b>
        <CaretRightIcon size={22} />
      </Link>
      <Panel>
        <header className="section-header">
          <h2>最近记录</h2>
          <Link to="/records">
            查看全部 <CaretRightIcon />
          </Link>
        </header>
        <TransactionList transactions={transactions} compact />
      </Panel>
      <Link to={`/records/new?bookId=${id}`} className="primary-wide">
        <PlusIcon size={24} weight="bold" />
        记一笔
      </Link>
    </>
  );
}
export function BooksPage() {
  const { data, loading, error } = useApi<{ books: Book[] }>("/books");
  const books = data?.books ?? [];
  return (
    <>
      <Page title="账本" back={false} />
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
            {books.map((book) => (
              <Link className="book-card" to={`/books/${book.id}`} key={book.id}>
                <span className="book-card-icon">
                  <BookOpenIcon size={36} weight="fill" />
                </span>
                <div className="book-card-main">
                  <h2>{book.name}</h2>
                  <p>日常生活收支记录</p>
                  <small>
                    <UsersIcon size={16} /> 1 位成员
                  </small>
                </div>
                <div className="book-card-money">
                  <span>
                    本月收入 <b>{money(0)}</b>
                  </span>
                  <span>本月支出 {money(0)}</span>
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
  const [shared, setShared] = useState(false);
  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const currency = form.watch("currency");
  const note = form.watch("note") ?? "";
  const submit = form.handleSubmit(async (value) => {
    try {
      const result = await api<{ book: Book }>("/books", { method: "POST", body: JSON.stringify(value) });
      navigate(`/books/${result.book.id}`);
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
        <Panel className="book-option-list">
          <span>
            <UsersIcon size={25} />
            <b>多人共享</b>
            <small>邀请家人或朋友一起管理账本</small>
            <Switch
              aria-label="多人共享"
              checked={shared}
              onCheckedChange={setShared}
            />
          </span>
          <span>
            <ChartPieSliceIcon size={25} />
            <b>启用预算</b>
            <small>为收支设置预算，帮助控制开销</small>
            <Switch
              aria-label="启用预算"
              checked={budgetEnabled}
              onCheckedChange={setBudgetEnabled}
            />
          </span>
        </Panel>
        {error && <p className="field-error">{error}</p>}
      </div>
      <Button type="submit">创建账本</Button>
    </form>
  );
}
