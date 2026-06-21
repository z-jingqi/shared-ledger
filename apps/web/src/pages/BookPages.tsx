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
import { Link, useNavigate } from "react-router-dom";
import { TransactionList } from "../components/ledger/Transactions";
import { Page } from "../components/layout/Page";
import { api } from "../lib";

export function BookHomePage() {
  return (
    <>
      <Page
        title="家庭账本"
        back={false}
        action={
          <Link className="icon-link" to="/books/book_home/settings">
            <GearIcon size={27} />
          </Link>
        }
      />
      <Panel className="summary">
        <div>
          <span>
            2026年6月 <CaretDownIcon size={16} />
          </span>
          <small>切换月份</small>
        </div>
        <section>
          <p>
            本月收入<b className="income">¥12,560.00</b>
          </p>
          <p>
            本月支出<b>¥8,230.00</b>
          </p>
          <p>
            结余<b className="income">¥4,330.00</b>
          </p>
        </section>
      </Panel>
      <Link className="pending-strip" to="/imports/pending">
        <CircleNotchIcon size={22} weight="fill" />
        <b>
          待确认 <em>3</em>
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
        <TransactionList compact />
      </Panel>
      <Link to="/records/new" className="primary-wide">
        <PlusIcon size={24} weight="bold" />
        记一笔
      </Link>
    </>
  );
}

export function BooksPage() {
  return (
    <>
      <Page title="我的账本" back={false} />
      <Panel className="book-hero">
        <BookOpenIcon size={35} weight="fill" />
        <div>
          <h2>家庭账本</h2>
          <p>3 位成员 · 人民币</p>
        </div>
        <CaretRightIcon />
      </Panel>
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

  const submit = form.handleSubmit(async (value) => {
    await api("/books", { method: "POST", body: JSON.stringify(value) }).catch(() => undefined);
    navigate("/books/book_home");
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
        <Button type="submit">创建账本</Button>
      </form>
    </>
  );
}
