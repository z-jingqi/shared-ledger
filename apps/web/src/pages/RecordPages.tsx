import { zodResolver } from "@hookform/resolvers/zod";
import {
  CalendarBlankIcon,
  FunnelSimpleIcon,
  NotePencilIcon,
  PlusCircleIcon,
  PlusIcon,
  ReceiptIcon,
  SquaresFourIcon,
  TagIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { createTransactionSchema } from "@shared-ledger/shared";
import { Button, Input, Panel } from "@shared-ledger/ui";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { TransactionList, type LedgerTransaction } from "../components/ledger/Transactions";
import { Page } from "../components/layout/Page";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api, money } from "../lib";

type RecordPicker = "type" | "category" | "date" | "tag";

export function RecordsPage() {
  const [filter, setFilter] = useState("全部");
  const { book } = useActiveBook();
  const { data } = useApi<{ transactions: LedgerTransaction[] }>(
    book ? `/books/${book.id}/transactions` : undefined,
  );
  const transactions = (data?.transactions ?? []).filter(
    (item) => filter === "全部" || (filter === "收入" ? item.type === "income" : item.type === "expense"),
  );
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
  return (
    <>
      <Page
        title="记录列表"
        back={false}
        action={
          <Button className="icon-link" type="button" variant="ghost" size="icon" aria-label="筛选记录">
            <FunnelSimpleIcon size={25} />
          </Button>
        }
      />
      <Input className="search" placeholder="搜索记录、分类或备注" />
      <div className="chips">
        {["全部", "收入", "支出"].map((item) => (
          <Button
            className={filter === item ? "selected" : ""}
            type="button"
            variant="ghost"
            onClick={() => setFilter(item)}
            key={item}
          >
            {item}
          </Button>
        ))}
      </div>
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
              <TransactionList transactions={items} />
            </Panel>
          </section>
        ))}
        {!transactions.length && <p className="muted">还没有记录，记下第一笔吧。</p>}
      </div>
      <Button asChild className="primary-wide">
        <Link to={`/records/new?bookId=${book?.id ?? ""}`}>
          <PlusIcon size={24} weight="bold" />
          记一笔
        </Link>
      </Button>
    </>
  );
}
export function TransactionFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { book } = useActiveBook();
  const initialAmount = getPositiveNumber(searchParams.get("amount"));
  const { data: existing } = useApi<{ transaction: LedgerTransaction }>(
    id ? `/transactions/${id}` : undefined,
  );
  const { data: categories } = useApi<{ categories: Array<{ id: string; name: string }> }>(
    book ? `/books/${book.id}/categories` : undefined,
  );
  const { data: tags } = useApi<{ tags: Array<{ id: string; name: string }> }>(
    book ? `/books/${book.id}/tags` : undefined,
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
      amount: (initialAmount ?? undefined) as unknown as number,
      occurredAt: toDateInputValue(new Date()),
      note: "",
      categoryId: undefined,
      tagIds: [],
      items: [],
    },
  });
  const [error, setError] = useState("");
  const [activePicker, setActivePicker] = useState<RecordPicker | null>(null);
  const [localCategories, setLocalCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [localTags, setLocalTags] = useState<Array<{ id: string; name: string }>>([]);
  const [categoryName, setCategoryName] = useState("");
  const [tagName, setTagName] = useState("");
  const selectedType = form.watch("type");
  const selectedCategoryId = form.watch("categoryId");
  const selectedTagIds = form.watch("tagIds") ?? [];
  const selectedDate = form.watch("occurredAt");
  const selectedAmount = form.watch("amount");
  const selectedCategory = localCategories.find((item) => item.id === selectedCategoryId);
  const selectedTags = localTags.filter((item) => selectedTagIds.includes(item.id));
  const selectedTypeLabel = selectedType === "income" ? "收入" : "支出";
  const selectedTagLabel = selectedTags.length ? selectedTags.map((item) => item.name).join("、") : "请选择标签";
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
      setCategoryName("");
      setActivePicker(null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加分类失败");
    }
  };
  const addLocalTag = async () => {
    const name = tagName.trim();
    if (!name) return;
    if (!book) return setError("请先创建账本");
    try {
      const result = await api<{ tag: { id: string; name: string } }>(`/books/${book.id}/tags`, {
        method: "POST",
        body: JSON.stringify({ name, color: "#ff6b1a" }),
      });
      const tag = result.tag;
      setLocalTags((current) => [...current.filter((item) => item.id !== tag.id), tag]);
      form.setValue("tagIds", [...new Set([...selectedTagIds, tag.id])], {
        shouldDirty: true,
        shouldValidate: true,
      });
      setTagName("");
      setActivePicker(null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加标签失败");
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
    if (!id) {
      const params = new URLSearchParams(searchParams);
      params.set("amount", String(amount));
      navigate({ search: params.toString() }, { replace: true });
    }
    navigate(`/records/new/items?total=${encodeURIComponent(String(amount))}`);
  };
  useEffect(() => {
    if (!categories?.categories) return;
    setLocalCategories((current) => [
      ...categories.categories,
      ...current.filter((item) => !categories.categories.some((category) => category.id === item.id)),
    ]);
  }, [categories?.categories]);
  useEffect(() => {
    if (!tags?.tags) return;
    setLocalTags((current) => [
      ...tags.tags,
      ...current.filter((item) => !tags.tags.some((tag) => tag.id === item.id)),
    ]);
  }, [tags?.tags]);
  const submit = (mode: "save" | "continue") => form.handleSubmit(async (value) => {
    if (!book && !existing?.transaction) return setError("请先创建账本");
    try {
      const path = id ? `/transactions/${id}` : `/books/${book?.id}/transactions`;
      const payload = { ...value };
      delete (payload as { memberId?: unknown }).memberId;
      await api(path, { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setError("");
      setActivePicker(null);
      if (mode === "continue" && !id) {
        form.reset({
          type: value.type,
          amount: "" as unknown as number,
          occurredAt: value.occurredAt,
          note: "",
          categoryId: undefined,
          tagIds: [],
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
                className="field-value-button"
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
              <TagIcon size={22} />
              <span>标签</span>
              <Button
                type="button"
                className="field-value-button"
                variant="ghost"
                aria-label={`标签 ${selectedTagLabel}`}
                onClick={() => setActivePicker("tag")}
              >
                {selectedTagLabel}
              </Button>
            </label>
            <label>
              <NotePencilIcon size={22} />
              <span>备注</span>
              <Input placeholder="可填写备注信息（选填）" {...form.register("note")} />
            </label>
          </Panel>
          <Button
            className="sub-action add-detail-row"
            type="button"
            variant="ghost"
            disabled={!canOpenLineItems}
            onClick={openLineItems}
          >
            <PlusCircleIcon size={22} />
            添加明细（选填）
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
      {activePicker === "tag" && (
        <SelectionModal title="选择标签" onClose={() => setActivePicker(null)}>
          <div className="modal-option-list">
            {localTags.map((item) => {
              const selected = selectedTagIds.includes(item.id);
              return (
                <Button
                  type="button"
                  variant="outline"
                  className={selected ? "selected" : ""}
                  key={item.id}
                  onClick={() => {
                    form.setValue(
                      "tagIds",
                      selected ? selectedTagIds.filter((tagId) => tagId !== item.id) : [...selectedTagIds, item.id],
                      { shouldDirty: true, shouldValidate: true },
                    );
                  }}
                >
                  {item.name}
                </Button>
              );
            })}
          </div>
          {!localTags.length && <p className="empty-panel-text">暂无标签，先添加一个。</p>}
          <div className="inline-add modal-inline-add">
            <Input
              aria-label="标签名称"
              value={tagName}
              placeholder="新标签名称"
              onChange={(event) => setTagName(event.target.value)}
            />
            <Button type="button" onClick={() => void addLocalTag()}>
              添加标签
            </Button>
          </div>
          <Button className="modal-done" type="button" onClick={() => setActivePicker(null)}>
            完成
          </Button>
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
export function AddLineItemsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const total = Number(searchParams.get("total") ?? "");
  const hasTotal = Number.isFinite(total) && total > 0;
  const [items, setItems] = useState([{ id: "empty", name: "", amount: "" }]);
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
            <Button type="button" onClick={() => navigate(-1)}>
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
