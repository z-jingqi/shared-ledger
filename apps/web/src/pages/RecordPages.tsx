import { zodResolver } from "@hookform/resolvers/zod";
import { CaretRightIcon, MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { createTransactionSchema } from "@shared-ledger/shared";
import { Button, Panel } from "@shared-ledger/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { TransactionList } from "../components/ledger/Transactions";
import { Page } from "../components/layout/Page";
import { transactionIcons, transactions } from "../features/ledger/data";
import { api, money } from "../lib";

export function RecordsPage() {
  const [filter, setFilter] = useState("全部");

  return (
    <>
      <Page
        title="记录列表"
        back={false}
        action={
          <button className="icon-link">
            <MagnifyingGlassIcon size={25} />
          </button>
        }
      />
      <input className="search" placeholder="搜索记录、分类、成员或备注" />
      <div className="chips">
        {["全部", "收入", "支出"].map((item) => (
          <button className={filter === item ? "selected" : ""} onClick={() => setFilter(item)} key={item}>
            {item}
          </button>
        ))}
      </div>
      <TransactionList />
      <Link to="/records/new" className="primary-wide">
        <PlusIcon size={24} weight="bold" />
        记一笔
      </Link>
    </>
  );
}

export function TransactionFormPage() {
  const navigate = useNavigate();
  const form = useForm({
    resolver: zodResolver(createTransactionSchema),
    defaultValues: {
      type: "expense" as const,
      amount: undefined as unknown as number,
      occurredAt: new Date().toISOString().slice(0, 10),
      note: "",
      tagIds: [],
      items: [],
    },
  });

  const submit = form.handleSubmit(async (value) => {
    await api("/books/book_home/transactions", { method: "POST", body: JSON.stringify(value) }).catch(
      () => undefined,
    );
    navigate("/records");
  });

  return (
    <>
      <Page title="记一笔" />
      <form className="form transaction-form" onSubmit={submit}>
        <div className="type-toggle">
          <button
            type="button"
            className={form.watch("type") === "expense" ? "selected" : ""}
            onClick={() => form.setValue("type", "expense")}
          >
            支出
          </button>
          <button
            type="button"
            className={form.watch("type") === "income" ? "selected" : ""}
            onClick={() => form.setValue("type", "income")}
          >
            收入
          </button>
        </div>
        <label className="amount-field">
          金额
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            {...form.register("amount", { valueAsNumber: true })}
          />
        </label>
        <p className="field-error">{form.formState.errors.amount?.message}</p>
        <label>
          分类
          <select>
            <option>餐饮</option>
            <option>交通</option>
            <option>工资</option>
          </select>
        </label>
        <label>
          日期
          <input type="date" {...form.register("occurredAt")} />
        </label>
        <label>
          备注
          <textarea placeholder="写点说明…" {...form.register("note")} />
        </label>
        <Link className="sub-action" to="/records/new/items">
          添加明细 <CaretRightIcon />
        </Link>
        <Button type="submit">保存记录</Button>
      </form>
    </>
  );
}

export function RecordDetailPage() {
  const { id } = useParams();
  const transaction = transactions.find((item) => item.id === id) ?? transactions[0];
  const Icon = transactionIcons[transaction.icon];

  return (
    <>
      <Page
        title="记录详情"
        action={
          <Link className="text-action" to={`/records/${transaction.id}/edit`}>
            编辑
          </Link>
        }
      />
      <Panel className="detail-amount">
        <span>
          <Icon size={31} weight="fill" />
        </span>
        <h1 className={transaction.type}>
          {transaction.type === "income" ? "+" : "-"}
          {money(transaction.amount)}
        </h1>
        <p>{transaction.title}</p>
      </Panel>
      <Panel className="detail-grid">
        <p>
          <span>成员</span>
          {transaction.member}
        </p>
        <p>
          <span>日期</span>2026年6月20日
        </p>
        <p>
          <span>账户</span>现金
        </p>
        <p>
          <span>标签</span>日常
        </p>
        <p>
          <span>备注</span>
          {transaction.note}
        </p>
      </Panel>
    </>
  );
}
