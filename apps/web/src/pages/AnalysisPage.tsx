import { CaretRightIcon, SparkleIcon } from "@phosphor-icons/react";
import { type CSSProperties, useMemo, useState } from "react";
import { BookSwitcherSheet } from "../components/books/BookSwitcherSheet";
import type { LedgerTransaction } from "../components/ledger/Transactions";
import { IosMetric, IosPage, IosScroll, IosTopBar } from "../components/ios/IosDesign";
import { useAuth } from "../features/auth/AuthProvider";
import { yuan } from "../features/formatting/money";
import { useAppSheetActions } from "../features/sheets/SheetContext";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";

type Range = "week" | "month" | "year";
type VisibleSeries = {
  expense: boolean;
  income: boolean;
};
type BookMember = { id: string; userId: string; name: string; role: string };

export function AnalysisPage() {
  const { user } = useAuth();
  const { openSheet } = useAppSheetActions();
  const { book, books, setActiveBook } = useActiveBook();
  const [range, setRange] = useState<Range>("week");
  const [visibleSeries, setVisibleSeries] = useState<VisibleSeries>({ expense: true, income: true });
  const [selectedBar, setSelectedBar] = useState(0);
  const [bookSwitcherOpen, setBookSwitcherOpen] = useState(false);
  const { data } = useApi<{ transactions: LedgerTransaction[] }>(
    book ? `/books/${book.id}/transactions` : undefined,
  );
  const { data: memberData } = useApi<{ members: BookMember[] }>(
    book ? `/books/${book.id}/members` : undefined,
  );
  const transactions = data?.transactions ?? [];
  const incomeEnabled = Boolean(book?.incomeEnabled);
  const memberNameById = useMemo(
    () =>
      new Map(
        (memberData?.members ?? []).flatMap((member) => [
          [member.id, member.name],
          [member.userId, member.name],
        ]),
      ),
    [memberData?.members],
  );
  const rangeInfo = useMemo(() => getRange(range), [range]);
  const visible = useMemo(
    () =>
      transactions.filter((item) => {
        const date = item.occurredAt.slice(0, 10);
        return date >= rangeInfo.start && date <= rangeInfo.end;
      }),
    [rangeInfo.end, rangeInfo.start, transactions],
  );
  const income = sum(visible, "income");
  const expense = sum(visible, "expense");
  const expenseItems = visible.filter((item) => item.type === "expense");
  const categories = groupBy(expenseItems, (item) => item.categoryName ?? item.categoryId ?? "未分类");
  const members = groupMembers(expenseItems, memberNameById);
  const canUseAi = user?.plan === "pro";
  const bars = useMemo(() => rangeBars(range, visible, rangeInfo), [range, rangeInfo, visible]);
  const selected = bars[selectedBar] ?? bars[0];
  const maxBar = Math.max(
    1,
    ...bars.map((item) =>
      Math.max(
        visibleSeries.expense ? item.expense : 0,
        incomeEnabled && visibleSeries.income ? item.income : 0,
      ),
    ),
  );
  const toggleSeries = (series: keyof VisibleSeries) => {
    setVisibleSeries((current) => ({ ...current, [series]: !current[series] }));
  };

  if (!book) {
    return (
      <IosPage className="ios-analysis">
        <IosTopBar book={book} />
        <div className="ios-empty">
          <b>当前还没有账本</b>
          <p>创建账本后即可查看记账分析。</p>
        </div>
      </IosPage>
    );
  }

  return (
    <IosPage className="ios-analysis">
      <IosTopBar book={book} onLedgerClick={() => setBookSwitcherOpen(true)} />
      <div className="ios-analysis-ranges">
        {[
          ["week", "本周"],
          ["month", "本月"],
          ["year", "本年"],
        ].map(([value, label]) => (
          <button
            className={range === value ? "active" : ""}
            type="button"
            onClick={() => {
              setRange(value as Range);
              setSelectedBar(0);
            }}
            key={value}
          >
            {label}
          </button>
        ))}
      </div>
      <IosScroll className="ios-analysis-scroll">
        {canUseAi ? (
          <button className="ios-analysis-ai-action" type="button" onClick={() => openSheet({ type: "ai" })}>
            <SparkleIcon size={18} weight="fill" />
            <span>
              <b>AI 分析</b>
              <small>按分类、成员和趋势继续拆解</small>
            </span>
            <CaretRightIcon size={17} />
          </button>
        ) : null}

        <div className={`ios-analysis-summary${incomeEnabled ? "" : " single"}`}>
          {incomeEnabled ? (
            <IosMetric label="收入" value={yuan(income, book?.currency)} tone="income" />
          ) : null}
          <IosMetric label={incomeEnabled ? "支出" : "总额"} value={yuan(expense, book?.currency)} />
        </div>

        <section className="ios-chart-card">
          <header>
            <h2>{incomeEnabled ? "收支趋势" : "记账趋势"}</h2>
            <div className="ios-chart-legend" aria-label={incomeEnabled ? "收支图例" : "记账图例"}>
              <button
                className={visibleSeries.expense ? "" : "muted"}
                type="button"
                onClick={() => toggleSeries("expense")}
              >
                <i />
                {incomeEnabled ? "支出" : "金额"}
              </button>
              {incomeEnabled ? (
                <button
                  className={visibleSeries.income ? "" : "muted"}
                  type="button"
                  onClick={() => toggleSeries("income")}
                >
                  <i className="income" />
                  收入
                </button>
              ) : null}
            </div>
          </header>
          <div
            className={`ios-bar-chart range-${range}`}
            style={{ "--bar-count": bars.length } as CSSProperties}
          >
            {bars.map((item, index) => (
              <button
                className={selectedBar === index ? "selected" : ""}
                key={item.key}
                type="button"
                onClick={() => setSelectedBar(index)}
                aria-label={
                  incomeEnabled
                    ? `${item.label} ${yuan(item.expense, book?.currency)} ${yuan(item.income, book?.currency)}`
                    : `${item.label} ${yuan(item.expense, book?.currency)}`
                }
              >
                <span>
                  {visibleSeries.expense && (
                    <i style={{ height: `${Math.max(4, (item.expense / maxBar) * 100)}%` }} />
                  )}
                  {incomeEnabled && visibleSeries.income && (
                    <i
                      className="income"
                      style={{ height: `${Math.max(4, (item.income / maxBar) * 100)}%` }}
                    />
                  )}
                </span>
                <small>{item.label}</small>
              </button>
            ))}
          </div>
          {selected && (
            <div className="ios-chart-values" aria-live="polite">
              {visibleSeries.expense && <span>{yuan(selected.expense, book?.currency)}</span>}
              {incomeEnabled && visibleSeries.income && (
                <span className="income">{yuan(selected.income, book?.currency)}</span>
              )}
            </div>
          )}
        </section>

        <section className="ios-chart-card ios-breakdown">
          <h2>{incomeEnabled ? "支出构成" : "分类构成"}</h2>
          <div>
            <div className="ios-donut" style={donutStyle(categories, expense)}>
              <span>
                <b>{yuan(expense, book?.currency)}</b>
              </span>
            </div>
            <ul>
              {categories.map((item, index) => (
                <li key={item.name}>
                  <span>
                    <i style={{ background: chartColors[index % chartColors.length] }} />
                    {item.name}
                  </span>
                  <b>{expense ? Math.round((item.amount / expense) * 100) : 0}%</b>
                </li>
              ))}
              {!categories.length && <li>暂无记录</li>}
            </ul>
          </div>
        </section>

        <section className="ios-chart-card">
          <h2>{incomeEnabled ? "成员贡献" : "成员记录"}</h2>
          <div className="ios-member-bars">
            {members.map((member, index) => (
              <div key={member.name}>
                <span style={{ background: chartColors[index % chartColors.length] }}>
                  {member.name[0] ?? "我"}
                </span>
                <p>
                  <b>{member.name}</b>
                  <small>
                    {yuan(member.amount, book?.currency)} ·{" "}
                    {expense ? Math.round((member.amount / expense) * 100) : 0}%
                  </small>
                  <i>
                    <em
                      style={{
                        width: `${expense ? (member.amount / expense) * 100 : 0}%`,
                        background: chartColors[index % chartColors.length],
                      }}
                    />
                  </i>
                </p>
              </div>
            ))}
            {!members.length && <p className="muted">暂无成员记录</p>}
          </div>
        </section>
      </IosScroll>
      {bookSwitcherOpen && (
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

const chartColors = ["#ff7a45", "#ff5d8f", "#14b8a6", "#4c8dff", "#a855f7", "#94a3b8"];

function sum(transactions: LedgerTransaction[], type: "income" | "expense") {
  return transactions.filter((item) => item.type === type).reduce((total, item) => total + item.amount, 0);
}

function getRange(range: Range) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (range === "year")
    return { start: ymd(new Date(year, 0, 1)), end: ymd(new Date(year, 11, 31)), label: `${year}年` };
  if (range === "week") {
    const day = now.getDay() || 7;
    const monday = new Date(year, month, now.getDate() - day + 1);
    const sunday = new Date(year, month, now.getDate() + (7 - day));
    return { start: ymd(monday), end: ymd(sunday), label: "本周" };
  }
  return {
    start: ymd(new Date(year, month, 1)),
    end: ymd(new Date(year, month + 1, 0)),
    label: `${month + 1}月`,
  };
}

function ymd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function groupBy(transactions: LedgerTransaction[], label: (item: LedgerTransaction) => string) {
  const groups = new Map<string, number>();
  transactions.forEach((item) => groups.set(label(item), (groups.get(label(item)) ?? 0) + item.amount));
  return [...groups.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

function groupMembers(transactions: LedgerTransaction[], memberNameById: Map<string, string>) {
  const groups = new Map<string, { name: string; amount: number }>();
  transactions.forEach((item) => {
    const key = item.memberId ?? "me";
    const name = item.memberId ? (memberNameById.get(item.memberId) ?? "已移除成员") : "我";
    const current = groups.get(key);
    groups.set(key, { name, amount: (current?.amount ?? 0) + item.amount });
  });
  return [...groups.values()].sort((a, b) => b.amount - a.amount);
}

function rangeBars(range: Range, transactions: LedgerTransaction[], limits: { start: string; end: string }) {
  if (range === "year") return yearlyBars(transactions);
  const start = parseYmd(limits.start);
  const end = parseYmd(limits.end);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  return Array.from({ length: days }, (_, offset) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    const key = ymd(date);
    const items = transactions.filter((item) => item.occurredAt.slice(0, 10) === key);
    return {
      key,
      label:
        range === "week"
          ? ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][offset]
          : String(date.getDate()),
      income: sum(items, "income"),
      expense: sum(items, "expense"),
    };
  });
}

function yearlyBars(transactions: LedgerTransaction[]) {
  const now = new Date();
  const year = now.getFullYear();
  return Array.from({ length: 12 }, (_, month) => {
    const monthItems = transactions.filter((item) => {
      const d = parseYmd(item.occurredAt.slice(0, 10));
      return d.getFullYear() === year && d.getMonth() === month;
    });
    return {
      key: `${year}-${String(month + 1).padStart(2, "0")}`,
      label: `${month + 1}月`,
      income: sum(monthItems, "income"),
      expense: sum(monthItems, "expense"),
    };
  });
}

function parseYmd(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function donutStyle(items: Array<{ amount: number }>, total: number) {
  if (!total || !items.length) return { background: "#f0f2f5" };
  let cursor = 0;
  const parts = items.map((item, index) => {
    const start = cursor;
    const end = cursor + (item.amount / total) * 100;
    cursor = end;
    return `${chartColors[index % chartColors.length]} ${start}% ${end}%`;
  });
  return { background: `conic-gradient(${parts.join(",")})` };
}
