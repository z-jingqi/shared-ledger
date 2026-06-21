import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
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
  const colors = ["#ff681c", "#ffae75", "#315a9c", "#d8dee9"];
  return (
    <>
      <Page title="账本分析" back={false} />
      <div className="analysis-summary">
        <span>
          <small>本月支出</small>
          <b>{money(total)}</b>
        </span>
        <span>
          <small>记录数</small>
          <b className="income">{transactions.length}</b>
        </span>
      </div>
      <Panel>
        <h2>支出趋势</h2>
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
          <ResponsiveContainer width="50%" height={180}>
            <PieChart>
              <Pie data={grouped} dataKey="value" innerRadius={45} outerRadius={70}>
                {grouped.map((entry, index) => (
                  <Cell key={entry.name} fill={colors[index % colors.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
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
    </>
  );
}
