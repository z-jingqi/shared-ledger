import { CheckIcon, CaretRightIcon, NotebookIcon, SparkleIcon } from "@phosphor-icons/react";
import type { SubscriptionPlan } from "@shared-ledger/shared";
import { Button, Panel } from "@shared-ledger/ui";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { Page } from "../components/layout/Page";

export function AccountSettingsPage() {
  return (
    <>
      <Page title="账号设置" />
      <Panel className="profile">
        <span>张</span>
        <div>
          <h2>张三</h2>
          <p>demo@ledger.local</p>
        </div>
      </Panel>
      <div className="settings-list">
        {["个人资料", "安全与登录", "通知设置", "语言与主题", "订阅与套餐"].map((item) => (
          <button key={item}>
            <span>{item}</span>
            <CaretRightIcon />
          </button>
        ))}
      </div>
    </>
  );
}

export function SubscriptionPage({ setPlan }: { setPlan: (plan: SubscriptionPlan) => void }) {
  return (
    <>
      <Page title="订阅与套餐" />
      <Panel className="plan-card">
        <SparkleIcon size={33} weight="fill" />
        <h2>一起记 Pro</h2>
        <p>让账本帮你发现每一笔钱的意义</p>
        <ul>
          <li>
            <CheckIcon /> AI 账本助手
          </li>
          <li>
            <CheckIcon /> 智能分类与分析
          </li>
          <li>
            <CheckIcon /> 全局对话抽屉
          </li>
        </ul>
        <Button onClick={() => setPlan("pro")}>立即升级 ¥18/月</Button>
      </Panel>
    </>
  );
}

export function AuthPage({ register = false }: { register?: boolean }) {
  const navigate = useNavigate();
  const form = useForm({ defaultValues: { email: "", password: "" } });

  return (
    <>
      <div className="brand">
        <NotebookIcon size={38} weight="fill" />
        <h1>一起记</h1>
        <p>和重要的人，一起记下生活</p>
      </div>
      <form className="form auth-form" onSubmit={form.handleSubmit(() => navigate("/books/book_home"))}>
        {register && (
          <label>
            昵称
            <input placeholder="怎么称呼你" />
          </label>
        )}
        <label>
          邮箱
          <input type="email" placeholder="name@example.com" {...form.register("email")} />
        </label>
        <label>
          密码
          <input type="password" placeholder="至少 8 位" {...form.register("password")} />
        </label>
        {register && (
          <label className="check-label">
            <input type="checkbox" />
            我已阅读并同意服务协议
          </label>
        )}
        <Button type="submit">{register ? "创建账号" : "登录"}</Button>
      </form>
      <p className="auth-switch">
        {register ? "已有账号？" : "还没有账号？"}
        <Link to={register ? "/login" : "/register"}>{register ? "去登录" : "注册"}</Link>
      </p>
    </>
  );
}
