import { CheckIcon, CaretRightIcon, NotebookIcon, SparkleIcon } from "@phosphor-icons/react";
import { Button, Panel } from "@shared-ledger/ui";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Page } from "../components/layout/Page";
import { useAuth } from "../features/auth/AuthProvider";
import { api } from "../lib";

export function AccountSettingsPage() {
  const { user } = useAuth();
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
      <div className="settings-list">
        {["个人资料", "安全与登录", "通知设置", "语言与主题", "订阅与套餐"].map((item) => (
          <Link key={item} to={item === "订阅与套餐" ? "/subscription" : "/account"}>
            <span>{item}</span>
            <CaretRightIcon />
          </Link>
        ))}
      </div>
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
            <Button type="submit">立即升级 ¥18/月</Button>
          </form>
        )}
      </Panel>
    </>
  );
}

export function AuthPage({ register = false }: { register?: boolean }) {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const form = useForm({ defaultValues: { name: "", identifier: "", email: "", phone: "", password: "" } });
  const [error, setError] = useState("");
  const submit = form.handleSubmit(async (value) => {
    try {
      const result = register
        ? await api("/auth/register", {
            method: "POST",
            body: JSON.stringify({
              name: value.name,
              email: value.email || undefined,
              phone: value.phone || undefined,
              password: value.password,
            }),
          })
        : await api("/auth/login", {
            method: "POST",
            body: JSON.stringify({ identifier: value.identifier, password: value.password }),
          });
      void result;
      await refresh();
      navigate("/books");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "认证失败");
    }
  });
  const oauth = (provider: "google" | "wechat") => {
    window.location.assign(
      `${import.meta.env.VITE_API_URL || "/api"}/auth/oauth/${provider}?redirectTo=${encodeURIComponent(window.location.origin + "/books")}`,
    );
  };
  return (
    <>
      <div className="brand">
        <NotebookIcon size={38} weight="fill" />
        <h1>一起记</h1>
        <p>和重要的人，一起记下生活</p>
      </div>
      <form className="form auth-form" onSubmit={submit}>
        {register && (
          <>
            <label>
              昵称
              <input placeholder="怎么称呼你" {...form.register("name")} />
            </label>
            <label>
              邮箱（可选）
              <input type="email" placeholder="用于找回密码" {...form.register("email")} />
            </label>
            <label>
              手机号（可选）
              <input placeholder="用于找回密码" {...form.register("phone")} />
            </label>
          </>
        )}
        <label>
          {register ? "密码" : "邮箱或手机号"}
          <input
            placeholder={register ? "至少 10 位" : "name@example.com 或手机号"}
            {...form.register(register ? "password" : "identifier")}
          />
        </label>
        {!register && (
          <label>
            密码
            <input type="password" {...form.register("password")} />
          </label>
        )}
        {register && (
          <label>
            确认密码
            <input type="password" {...form.register("password")} />
          </label>
        )}
        {error && <p className="field-error">{error}</p>}
        <Button type="submit">{register ? "创建账号" : "登录"}</Button>
      </form>
      <div className="oauth-actions">
        <button onClick={() => oauth("google")}>使用 Google 登录</button>
        <button onClick={() => oauth("wechat")}>使用微信登录</button>
      </div>
      <p className="auth-switch">
        {register ? "已有账号？" : "还没有账号？"}
        <Link to={register ? "/login" : "/register"}>{register ? "去登录" : "注册"}</Link>
      </p>
    </>
  );
}
