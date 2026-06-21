import { BusIcon, CaretRightIcon, CheckIcon, FileArrowUpIcon, ShoppingCartIcon } from "@phosphor-icons/react";
import { Panel } from "@shared-ledger/ui";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Page } from "../components/layout/Page";
import { money } from "../lib";

export function ImportsPage() {
  return (
    <>
      <Page title="导入记录" back={false} />
      <Panel className="upload-zone">
        <FileArrowUpIcon size={42} weight="duotone" />
        <h2>导入账单或票据</h2>
        <p>支持图片、PDF、CSV、Excel</p>
        <button onClick={() => document.getElementById("file")?.click()}>选择文件</button>
        <input id="file" type="file" hidden onChange={() => undefined} />
      </Panel>
      <div className="tips">
        <h3>智能识别流程</h3>
        <p>上传文件 → 提取文本/OCR → AI 整理 → 待确认入账</p>
      </div>
      <Link className="sub-action" to="/imports/pending">
        待确认记录 <b>3</b>
        <CaretRightIcon />
      </Link>
      <Link className="sub-action" to="/imports/history">
        导入历史 <CaretRightIcon />
      </Link>
    </>
  );
}

const pendingRecords = [
  { id: "a", name: "超市购物", amount: 158.6, warning: "" },
  { id: "b", name: "交通出行", amount: 32, warning: "疑似重复" },
];

export function PendingImportsPage() {
  const [confirmed, setConfirmed] = useState<string[]>([]);

  return (
    <>
      <Page
        title="待确认记录"
        action={
          <button className="text-action" onClick={() => setConfirmed(["a", "b"])}>
            全部确认
          </button>
        }
      />
      <Panel>
        <p className="muted">智能识别结果，请确认后入账</p>
        {pendingRecords.map((record) => (
          <div className="pending-row" key={record.id}>
            <span className="category-icon">
              {record.id === "a" ? (
                <ShoppingCartIcon size={19} weight="fill" />
              ) : (
                <BusIcon size={19} weight="fill" />
              )}
            </span>
            <div>
              <strong>{record.name}</strong>
              <small>{record.warning || "识别置信度 94%"}</small>
            </div>
            <b>{money(record.amount)}</b>
            <button
              disabled={confirmed.includes(record.id)}
              onClick={() => setConfirmed((current) => [...current, record.id])}
            >
              {confirmed.includes(record.id) ? <CheckIcon /> : "确认"}
            </button>
          </div>
        ))}
      </Panel>
    </>
  );
}

export function ImportHistoryPage() {
  return (
    <>
      <Page title="导入历史" />
      <Panel>
        <div className="history-row">
          <FileArrowUpIcon size={25} />
          <div>
            <strong>六月账单.csv</strong>
            <small>2026-06-20 · 识别 12 条</small>
          </div>
          <span className="status success">已完成</span>
        </div>
        <div className="history-row">
          <FileArrowUpIcon size={25} />
          <div>
            <strong>购物小票.jpg</strong>
            <small>2026-06-19 · 等待确认</small>
          </div>
          <span className="status">处理中</span>
        </div>
      </Panel>
    </>
  );
}
