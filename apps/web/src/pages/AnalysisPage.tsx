import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Area, AreaChart } from "recharts";
import { Panel } from "@shared-ledger/ui";
import { Page } from "../components/layout/Page";

const trend = [
  { d: "周一", value: 110 },
  { d: "周二", value: 230 },
  { d: "周三", value: 180 },
  { d: "周四", value: 440 },
  { d: "周五", value: 270 },
  { d: "周六", value: 520 },
];

const categoryBreakdown = [
  { name: "餐饮", value: 36, color: "#ff681c" },
  { name: "居住", value: 27, color: "#ffae75" },
  { name: "交通", value: 20, color: "#315a9c" },
  { name: "其他", value: 17, color: "#d8dee9" },
];

export function AnalysisPage() {
  return (
    <>
      <Page title="账本分析" back={false} />
      <div className="analysis-summary">
        <span>
          <small>本月支出</small>
          <b>¥8,230</b>
        </span>
        <span>
          <small>较上月</small>
          <b className="income">-8.2%</b>
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
              <Pie data={categoryBreakdown} dataKey="value" innerRadius={45} outerRadius={70}>
                {categoryBreakdown.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <ul>
            {categoryBreakdown.map((item) => (
              <li key={item.name}>
                <i style={{ background: item.color }} />
                {item.name}
                <b>{item.value}%</b>
              </li>
            ))}
          </ul>
        </div>
      </Panel>
    </>
  );
}
