import { zodResolver } from "@hookform/resolvers/zod";
import { CaretRightIcon, MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { createTransactionSchema } from "@shared-ledger/shared";
import { Button, Panel } from "@shared-ledger/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { TransactionList, type LedgerTransaction } from "../components/ledger/Transactions";
import { Page } from "../components/layout/Page";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api, money } from "../lib";

export function RecordsPage() {
  const [filter, setFilter] = useState("全部");
  const { book } = useActiveBook();
  const { data } = useApi<{ transactions: LedgerTransaction[] }>(
    book ? `/books/${book.id}/transactions` : undefined,
  );
  const transactions = (data?.transactions ?? []).filter(
    (item) => filter === "全部" || (filter === "收入" ? item.type === "income" : item.type === "expense"),
  );
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
      <input className="search" placeholder="搜索记录、分类或备注" />
      <div className="chips">
        {["全部", "收入", "支出"].map((item) => (
          <button className={filter === item ? "selected" : ""} onClick={() => setFilter(item)} key={item}>
            {item}
          </button>
        ))}
      </div>
      <TransactionList transactions={transactions} />
      <Link to={`/records/new?bookId=${book?.id ?? ""}`} className="primary-wide">
        <PlusIcon size={24} weight="bold" />
        记一笔
      </Link>
    </>
  );
}
export function TransactionFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { book } = useActiveBook();
  const { data: existing } = useApi<{ transaction: LedgerTransaction }>(
    id ? `/transactions/${id}` : undefined,
  );
  const { data: categories } = useApi<{ categories: Array<{ id: string; name: string }> }>(
    book ? `/books/${book.id}/categories` : undefined,
  );
  const form = useForm({
    resolver: zodResolver(createTransactionSchema),
    values: existing?.transaction
      ? {
          ...existing.transaction,
          occurredAt: existing.transaction.occurredAt.slice(0, 10),
          tagIds: [],
          items: [],
        }
      : undefined,
    defaultValues: {
      type: "expense" as const,
      amount: undefined as unknown as number,
      occurredAt: new Date().toISOString().slice(0, 10),
      note: "",
      categoryId: undefined,
      tagIds: [],
      items: [],
    },
  });
  const [error, setError] = useState("");
  const submit = form.handleSubmit(async (value) => {
    if (!book && !existing?.transaction) return setError("请先创建账本");
    try {
      const path = id ? `/transactions/${id}` : `/books/${book?.id}/transactions`;
      await api(path, { method: id ? "PATCH" : "POST", body: JSON.stringify(value) });
      navigate("/records");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    }
  });
  return (
    <>
      <Page title={id ? "编辑记录" : "记一笔"} />
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
          <select {...form.register("categoryId")}>
            <option value="">未分类</option>
            {categories?.categories?.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
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
        {error && <p className="field-error">{error}</p>}
        <Button type="submit">保存记录</Button>
      </form>
    </>
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
          <Link className="text-action" to={`/records/${transaction.id}/edit`}>
            编辑
          </Link>
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
