import { zodResolver } from "@hookform/resolvers/zod";
import {
  BookOpenIcon,
  CaretDownIcon,
  CaretRightIcon,
  CircleNotchIcon,
  GearIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { createBookSchema } from "@shared-ledger/shared";
import { Button, Panel } from "@shared-ledger/ui";
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
      <Page
        title={bookData?.book.name ?? "账本"}
        back={false}
        action={
          <Link className="icon-link" to={`/books/${id}/settings`}>
            <GearIcon size={27} />
          </Link>
        }
      />
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
  return (
    <>
      <Page title="我的账本" back={false} />
      {loading && <p className="muted">正在读取账本…</p>}
      {error && <p className="field-error">{error}</p>}
      {data?.books.map((book) => (
        <Link className="book-hero" to={`/books/${book.id}`} key={book.id}>
          <BookOpenIcon size={35} weight="fill" />
          <div>
            <h2>{book.name}</h2>
            <p>{book.currency}</p>
          </div>
          <CaretRightIcon />
        </Link>
      ))}
      <Link className="add-row" to="/books/new">
        <PlusIcon />
        新建账本
      </Link>
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
  const submit = form.handleSubmit(async (value) => {
    try {
      const result = await api<{ book: Book }>("/books", { method: "POST", body: JSON.stringify(value) });
      navigate(`/books/${result.book.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败");
    }
  });
  return (
    <>
      <Page title="创建账本" />
      <form className="form" onSubmit={submit}>
        <label>
          账本名称
          <input placeholder="例如：家庭账本" {...form.register("name")} />
        </label>
        <p className="field-error">{form.formState.errors.name?.message}</p>
        <label>
          默认货币
          <select {...form.register("currency")}>
            <option value="CNY">人民币 CNY</option>
            <option value="USD">美元 USD</option>
          </select>
        </label>
        <label>
          备注
          <textarea placeholder="可选，说明这个账本的用途" {...form.register("note")} />
        </label>
        {error && <p className="field-error">{error}</p>}
        <Button type="submit">创建账本</Button>
      </form>
    </>
  );
}
