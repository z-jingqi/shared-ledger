import {
  BellIcon,
  CheckIcon,
  CaretRightIcon,
  CreditCardIcon,
  GlobeHemisphereEastIcon,
  LockKeyIcon,
  NotebookIcon,
  SignOutIcon,
  SparkleIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { Button, Panel } from "@shared-ledger/ui";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Page } from "../components/layout/Page";
import { useAuth } from "../features/auth/AuthProvider";
import { api } from "../lib";

export function AccountSettingsPage() {
  const { setUser, user } = useAuth();
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(undefined);
  };
  const links = [
    { label: "个人资料", Icon: UserCircleIcon, to: "/account" },
    { label: "安全与登录", Icon: LockKeyIcon, to: "/account" },
    { label: "通知设置", Icon: BellIcon, to: "/settings/notifications" },
    { label: "语言与主题", Icon: GlobeHemisphereEastIcon, to: "/account" },
    { label: "订阅与套餐", Icon: CreditCardIcon, to: "/subscription" },
  ];
  return (
    <>
      <Page title="账号设置" />
      <Panel className="profile">
        <span>{user?.name.slice(0, 1) ?? "?"}</span>
        <div>
          <h2>{user?.name ?? "未登录"}</h2>
          <p>{user?.email || "未绑定邮箱"}</p>
        </div>
      </Panel>
      <Panel className="settings-list">
        {links.map(({ label, Icon, to }) => (
          <Link key={label} to={to}>
            <Icon size={24} />
            <span>{label}</span>
            <CaretRightIcon />
          </Link>
        ))}
      </Panel>
      <button className="logout" onClick={() => void logout()}>
        <SignOutIcon size={20} />
        退出登录
      </button>
    </>
  );
}

export function SubscriptionPage() {
  const { user, refresh } = useAuth();
  const form = useForm<{ email: string; phone: string }>({
    defaultValues: { email: user?.email ?? "", phone: "" },
  });
  const [error, setError] = useState("");
  const upgrade = form.handleSubmit(async (value) => {
    try {
      await api("/subscriptions/pro", {
        method: "POST",
        body: JSON.stringify({ email: value.email || undefined, phone: value.phone || undefined }),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "订阅失败");
    }
  });
  return (
    <>
      <Page title="订阅与套餐" />
      <Panel className="plan-card">
        <SparkleIcon size={33} weight="fill" />
        <h2>一起记 Pro</h2>
        <p>让账本帮你发现每一笔钱的意义</p>
        <div className="plan-options">
          <button className="selected" type="button">
            <b>年度套餐</b>
            <small>¥68/年</small>
          </button>
          <button type="button">
            <b>月度套餐</b>
            <small>¥12/月</small>
          </button>
        </div>
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
        {user?.plan === "pro" ? (
          <p className="success-note">你已是 Pro 用户</p>
        ) : (
          <form className="form" onSubmit={upgrade}>
            <p className="muted">密码注册的账号订阅前需补充邮箱或手机号；Google、微信授权登录无需补充。</p>
            <label>
              邮箱
              <input type="email" {...form.register("email")} />
            </label>
            <label>
              手机号
              <input {...form.register("phone")} />
            </label>
            {error && <p className="field-error">{error}</p>}
            <Button type="submit">立即升级</Button>
          </form>
        )}
      </Panel>
    </>
  );
}

export function AuthPage({ register = false }: { register?: boolean }) {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [searchParams] = useSearchParams();
  const form = useForm({ defaultValues: { name: "", identifier: "", password: "", confirmPassword: "" } });
  const [error, setError] = useState("");
  const submit = form.handleSubmit(async (value) => {
    if (register && value.password !== value.confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    try {
      const result = register
        ? await api("/auth/register", {
            method: "POST",
            body: JSON.stringify({
              name: value.name,
              password: value.password,
            }),
          })
        : await api("/auth/login", {
            method: "POST",
            body: JSON.stringify({ identifier: value.identifier, password: value.password }),
          });
      void result;
      await refresh();
      navigate(searchParams.get("redirect") || "/books");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "认证失败");
    }
  });
  return (
    <>
      <div className="brand">
        <NotebookIcon size={38} weight="fill" />
        <h1>一起记</h1>
        <p>和重要的人，一起记下生活</p>
      </div>
      <form className="form auth-form" onSubmit={submit}>
        {register && (
          <label>
            用户名
            <input placeholder="请输入用户名" {...form.register("name")} />
          </label>
        )}
        {!register && (
          <label>
            用户名
            <input type="text" placeholder="请输入用户名" {...form.register("identifier")} />
          </label>
        )}
        <label>
          密码
          <input
            type="password"
            placeholder={register ? "至少 10 位" : "请输入密码"}
            {...form.register("password")}
          />
        </label>
        {register && (
          <label>
            确认密码
            <input type="password" aria-label="确认密码" placeholder="再次输入密码" {...form.register("confirmPassword")} />
          </label>
        )}
        {error && <p className="field-error">{error}</p>}
        <Button type="submit">{register ? "创建账号" : "登录"}</Button>
      </form>
      <p className="auth-switch">
        {register ? "已有账号？" : "还没有账号？"}
        <Link to={register ? "/login" : "/register"}>{register ? "去登录" : "注册"}</Link>
      </p>
    </>
  );
}
