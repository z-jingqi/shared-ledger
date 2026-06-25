import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  BookOpenIcon,
  CaretDownIcon,
  CheckIcon,
  ChartBarIcon,
  ChartPieSliceIcon,
  TrendUpIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { Button, Panel } from "@shared-ledger/ui";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Page } from "../components/layout/Page";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import type { LedgerTransaction } from "../components/ledger/Transactions";
import { money } from "../lib";

export function AnalysisPage() {
  const [expanded, setExpanded] = useState(false);
  const [period, setPeriod] = useState<"month" | "quarter" | "year">("month");
  const [searchParams, setSearchParams] = useSearchParams();
  const { book, books, loading: booksLoading } = useActiveBook();
  const { data } = useApi<{ transactions: LedgerTransaction[] }>(
    book ? `/books/${book.id}/transactions` : undefined,
  );
  const selectBook = (bookId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("bookId", bookId);
    setSearchParams(next);
    setExpanded(false);
  };
  const transactions = data?.transactions ?? [];
  const income = transactions
    .filter((item) => item.type === "income")
    .reduce((sum, item) => sum + item.amount, 0);
  const expenses = transactions.filter((item) => item.type === "expense");
  const total = expenses.reduce((sum, item) => sum + item.amount, 0);
  const trend = [...expenses].reverse().map((item) => ({
    d: new Date(item.occurredAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }),
    value: item.amount,
  }));
  const grouped = Object.values(
    expenses.reduce<Record<string, { name: string; value: number }>>((group, item) => {
      const name = item.categoryId ?? "未分类";
      group[name] = group[name] ?? { name, value: 0 };
      group[name].value += item.amount;
      return group;
    }, {}),
  );
  const members = Object.values(
    expenses.reduce<Record<string, { name: string; value: number }>>((group, item) => {
      const name = item.memberId ?? "我";
      group[name] = group[name] ?? { name, value: 0 };
      group[name].value += item.amount;
      return group;
    }, {}),
  ).sort((left, right) => right.value - left.value);
  const colors = ["#ff681c", "#ffae75", "#315a9c", "#d8dee9"];
  const periodOptions = [
    { label: "本月", value: "month" as const },
    { label: "3 个月", value: "quarter" as const },
    { label: "年度", value: "year" as const },
  ];
  return (
    <section className="analysis-screen">
      <div className="analysis-fixed">
        <Page title="分析" back={false} />
        {booksLoading && <p className="muted">正在读取账本…</p>}
        {!booksLoading && !book && (
          <Panel className="analysis-empty">
            <BookOpenIcon size={32} weight="fill" />
            <h2>当前还没有账本</h2>
            <p>创建账本后，就可以查看收支趋势、分类占比和成员排行。</p>
          </Panel>
        )}
        {book && (
          <Panel className="analysis-book-picker">
            <Button
              type="button"
              variant="ghost"
              aria-expanded={expanded}
              aria-controls="analysis-book-list"
              onClick={() => setExpanded((current) => !current)}
            >
              <span>
                <small>当前账本</small>
                <b>{book.name}</b>
              </span>
              <CaretDownIcon className={expanded ? "open" : ""} size={22} />
            </Button>
            {expanded && (
              <div id="analysis-book-list" className="analysis-book-list">
                {books.map((item) => (
                  <Button
                    type="button"
                    variant="ghost"
                    className={item.id === book.id ? "selected" : ""}
                    onClick={() => selectBook(item.id)}
                    key={item.id}
                  >
                    <BookOpenIcon size={20} weight={item.id === book.id ? "fill" : "regular"} />
                    <span>{item.name}</span>
                    {item.id === book.id && <CheckIcon size={18} weight="bold" />}
                  </Button>
                ))}
              </div>
            )}
          </Panel>
        )}
      </div>
      {book && (
        <div className="analysis-scroll">
          <Panel className="analysis-period">
            <span>{new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long" })}</span>
            <div>
              {periodOptions.map((item) => (
                <Button
                  className={period === item.value ? "selected" : ""}
                  variant="ghost"
                  type="button"
                  onClick={() => setPeriod(item.value)}
                  key={item.value}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </Panel>
          <div className="analysis-summary">
            <span>
              <TrendUpIcon size={22} />
              <small>本月收入</small>
              <b className="income">{money(income)}</b>
            </span>
            <span>
              <ChartBarIcon size={22} />
              <small>本月支出</small>
              <b>{money(total)}</b>
            </span>
            <span>
              <ChartPieSliceIcon size={22} />
              <small>结余</small>
              <b className="income">{money(income - total)}</b>
            </span>
          </div>
          <Panel>
            <h2>收支趋势</h2>
            <div className="chart">
              <ResponsiveContainer>
                <AreaChart data={trend}>
                  <Tooltip />
                  <Area type="monotone" dataKey="value" stroke="#ff681c" fill="#ffe9db" strokeWidth={3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel>
            <h2>分类占比</h2>
            <div className="pie-wrap">
              <div className="pie-chart-shell">
                <PieChart width={160} height={180}>
                  <Pie
                    data={grouped}
                    dataKey="value"
                    innerRadius={45}
                    outerRadius={70}
                    cx={80}
                    cy={90}
                    isAnimationActive={false}
                  >
                    {grouped.map((entry, index) => (
                      <Cell key={entry.name} fill={colors[index % colors.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </div>
              <ul>
                {grouped.map((item, index) => (
                  <li key={item.name}>
                    <i style={{ background: colors[index % colors.length] }} />
                    {item.name}
                    <b>{total ? Math.round((item.value / total) * 100) : 0}%</b>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
          <Panel className="member-ranking">
            <h2>
              <UsersThreeIcon size={22} />
              成员支出排行
            </h2>
            {members.map((member, index) => (
              <div className="ranking-row" key={member.name}>
                <span>{index + 1}</span>
                <b>{member.name}</b>
                <small>{money(member.value)}</small>
              </div>
            ))}
            {!members.length && <p className="muted">暂无支出记录</p>}
          </Panel>
        </div>
      )}
    </section>
  );
}
