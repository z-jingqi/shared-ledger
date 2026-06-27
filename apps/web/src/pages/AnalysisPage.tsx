import { WarningCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { LedgerTransaction } from "../components/ledger/Transactions";
import { AiSparkButton, IosMetric, IosPage, IosScroll, IosTopBar, yuan } from "../components/ios/IosDesign";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { useNavigate } from "react-router-dom";

type Range = "month" | "quarter" | "year";

export function AnalysisPage() {
  const navigate = useNavigate();
  const { book } = useActiveBook();
  const [range, setRange] = useState<Range>("month");
  const { data } = useApi<{ transactions: LedgerTransaction[] }>(book ? `/books/${book.id}/transactions` : undefined);
  const transactions = data?.transactions ?? [];
  const limits = getRange(range);
  const visible = transactions.filter((item) => item.occurredAt.slice(0, 10) >= limits.start && item.occurredAt.slice(0, 10) <= limits.end);
  const income = sum(visible, "income");
  const expense = sum(visible, "expense");
  const expenseItems = visible.filter((item) => item.type === "expense");
  const categories = groupBy(expenseItems, (item) => item.categoryName ?? item.categoryId ?? "未分类");
  const members = groupBy(expenseItems, (item) => item.memberId ?? "我");
  const maxMonth = Math.max(1, ...monthlyBars(transactions).map((item) => Math.max(item.income, item.expense)));
  const warnings = [...expenseItems].sort((a, b) => b.amount - a.amount).slice(0, 2);

  return (
    <IosPage className="ios-analysis">
      <IosTopBar
        book={book}
        suffix={`· ${limits.label}`}
        onLedgerClick={() => navigate("/books/manage")}
        action={<AiSparkButton onClick={() => navigate(`/ai${book?.id ? `?bookId=${book.id}` : ""}`)} />}
      />
      <div className="ios-analysis-ranges">
        {[
          ["month", "本月"],
          ["quarter", "3 个月"],
          ["year", "今年"],
        ].map(([value, label]) => (
          <button className={range === value ? "active" : ""} type="button" onClick={() => setRange(value as Range)} key={value}>
            {label}
          </button>
        ))}
      </div>
      <IosScroll className="ios-analysis-scroll">
        <div className="ios-analysis-summary">
          <IosMetric label="收入" value={yuan(income, book?.currency)} tone="income" />
          <IosMetric label="支出" value={yuan(expense, book?.currency)} />
          <IosMetric label="结余" value={yuan(income - expense, book?.currency)} tone="accent" />
        </div>

        <section className="ios-chart-card">
          <header>
            <h2>收支趋势</h2>
            <p><i />支出 <i className="income" />收入</p>
          </header>
          <div className="ios-bar-chart">
            {monthlyBars(transactions).map((item) => (
              <div key={item.label}>
                <span>
                  <i style={{ height: `${Math.max(4, (item.expense / maxMonth) * 100)}%` }} />
                  <i className="income" style={{ height: `${Math.max(4, (item.income / maxMonth) * 100)}%` }} />
                </span>
                <small>{item.label}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="ios-chart-card ios-breakdown">
          <h2>支出构成</h2>
          <div>
            <div className="ios-donut" style={donutStyle(categories, expense)}>
              <span>
                <small>总支出</small>
                <b>{yuan(expense, book?.currency)}</b>
              </span>
            </div>
            <ul>
              {categories.map((item, index) => (
                <li key={item.name}>
                  <span><i style={{ background: chartColors[index % chartColors.length] }} />{item.name}</span>
                  <b>{expense ? Math.round((item.amount / expense) * 100) : 0}%</b>
                </li>
              ))}
              {!categories.length && <li>暂无支出记录</li>}
            </ul>
          </div>
        </section>

        <section className="ios-chart-card">
          <h2>成员贡献</h2>
          <div className="ios-member-bars">
            {members.map((member, index) => (
              <div key={member.name}>
                <span style={{ background: chartColors[index % chartColors.length] }}>{member.name[0] ?? "我"}</span>
                <p>
                  <b>{member.name}</b>
                  <small>{yuan(member.amount, book?.currency)} · {expense ? Math.round((member.amount / expense) * 100) : 0}%</small>
                  <i><em style={{ width: `${expense ? (member.amount / expense) * 100 : 0}%`, background: chartColors[index % chartColors.length] }} /></i>
                </p>
              </div>
            ))}
            {!members.length && <p className="muted">暂无成员支出数据</p>}
          </div>
        </section>

        <section className="ios-chart-card">
          <h2>异常与大额</h2>
          <div className="ios-unusual-list">
            {warnings.map((item) => (
              <article key={item.id}>
                <WarningCircleIcon size={18} />
                <span>
                  <b>{item.note || "大额支出"}</b>
                  <small>本期较高支出，请留意预算</small>
                </span>
                <strong>{yuan(item.amount, book?.currency)}</strong>
              </article>
            ))}
            {!warnings.length && <p className="muted">暂无异常支出</p>}
          </div>
        </section>
      </IosScroll>
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
  if (range === "year") return { start: ymd(new Date(year, 0, 1)), end: ymd(new Date(year, 11, 31)), label: `${year}年` };
  if (range === "quarter") return { start: ymd(new Date(year, month - 2, 1)), end: ymd(new Date(year, month + 1, 0)), label: "近3个月" };
  return { start: ymd(new Date(year, month, 1)), end: ymd(new Date(year, month + 1, 0)), label: `${month + 1}月` };
}

function ymd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function groupBy(transactions: LedgerTransaction[], label: (item: LedgerTransaction) => string) {
  const groups = new Map<string, number>();
  transactions.forEach((item) => groups.set(label(item), (groups.get(label(item)) ?? 0) + item.amount));
  return [...groups.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
}

function monthlyBars(transactions: LedgerTransaction[]) {
  const now = new Date();
  return Array.from({ length: 6 }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - offset), 1);
    const month = date.getMonth();
    const year = date.getFullYear();
    const monthItems = transactions.filter((item) => {
      const d = new Date(item.occurredAt);
      return d.getFullYear() === year && d.getMonth() === month;
    });
    return { label: `${month + 1}月`, income: sum(monthItems, "income"), expense: sum(monthItems, "expense") };
  });
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
