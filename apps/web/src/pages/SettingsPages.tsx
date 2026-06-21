import { CaretRightIcon, RobotIcon, SignOutIcon, SparkleIcon } from "@phosphor-icons/react";
import type { SubscriptionPlan } from "@shared-ledger/shared";
import { Panel } from "@shared-ledger/ui";
import { Link, useLocation } from "react-router-dom";
import { Page } from "../components/layout/Page";
import { settingsLinks } from "../features/ledger/data";

type SettingsProps = {
  plan: SubscriptionPlan;
  setPlan: (plan: SubscriptionPlan) => void;
};

export function SettingsPage({ plan, setPlan }: SettingsProps) {
  return (
    <>
      <Page title="我的" back={false} />
      <Panel className="profile">
        <span>张</span>
        <div>
          <h2>张三</h2>
          <p>demo@ledger.local</p>
        </div>
        <Link to="/account">
          <CaretRightIcon />
        </Link>
      </Panel>
      {plan === "free" ? (
        <Link to="/subscription" className="upgrade-banner">
          <SparkleIcon size={24} weight="fill" />
          <span>
            <b>升级 Pro</b>
            <small>开启 AI 账本助手</small>
          </span>
          <CaretRightIcon />
        </Link>
      ) : (
        <Link to="/ai" className="upgrade-banner">
          <RobotIcon size={24} weight="fill" />
          <span>
            <b>AI 助手已开启</b>
            <small>随时分析你的账本</small>
          </span>
          <CaretRightIcon />
        </Link>
      )}
      <div className="settings-list">
        {settingsLinks.map(({ label, to, Icon }) => (
          <Link to={to} key={to}>
            <Icon size={22} />
            <span>{label}</span>
            <CaretRightIcon />
          </Link>
        ))}
      </div>
      <button className="logout">
        <SignOutIcon size={20} />
        退出登录
      </button>
      <button className="demo-plan" onClick={() => setPlan(plan === "free" ? "pro" : "free")}>
        演示：切换为{plan === "free" ? " Pro" : "免费"}账户
      </button>
    </>
  );
}

export function ManagementSettingsPage() {
  const location = useLocation();
  const title = settingsLinks.find((item) => location.pathname === item.to)?.label ?? "账本设置";

  return (
    <>
      <Page title={title} />
      <Panel>
        <h2>{title}</h2>
        <p className="muted">这里已预留完整的管理入口。在 MVP 演示中，修改会在连接 API 后同步到账本成员。</p>
      </Panel>
      <div className="settings-list">
        {["新增项目", "排序管理", "保存更改"].map((item) => (
          <button key={item}>
            <span>{item}</span>
            <CaretRightIcon />
          </button>
        ))}
      </div>
    </>
  );
}
