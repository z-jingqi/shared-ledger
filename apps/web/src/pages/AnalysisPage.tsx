import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartBarIcon, ChartPieSliceIcon, TrendUpIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { Panel } from "@shared-ledger/ui";
import { Page } from "../components/layout/Page";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import type { LedgerTransaction } from "../components/ledger/Transactions";
import { money } from "../lib";

export function AnalysisPage() {
  const { book } = useActiveBook();
  const { data } = useApi<{ transactions: LedgerTransaction[] }>(
    book ? `/books/${book.id}/transactions` : undefined,
  );
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
  return (
    <>
      <Page title="分析" back={false} />
      <Panel className="analysis-period">
        <span>{new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long" })}</span>
        <div>
          <button className="selected" type="button">
            本月
          </button>
          <button type="button">3 个月</button>
          <button type="button">年度</button>
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
    </>
  );
}
