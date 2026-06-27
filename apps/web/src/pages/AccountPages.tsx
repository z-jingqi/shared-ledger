import {
  CaretRightIcon,
  CheckIcon,
  CreditCardIcon,
  EyeIcon,
  EyeSlashIcon,
  LockKeyIcon,
  NotebookIcon,
  SignOutIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { UseFormRegisterReturn } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  IconTile,
  IosButton,
  IosCard,
  IosDialog,
  IosField,
  IosPage,
  IosScroll,
  IosTopBar,
} from "../components/ios/IosDesign";
import { useAuth } from "../features/auth/AuthProvider";
import { api } from "../lib";

type LoginForm = { identifier: string; password: string };
type RegisterForm = { name: string; password: string; confirmPassword: string };
type SubscriptionForm = { email: string; phone: string };

export function AccountSettingsPage() {
  const navigate = useNavigate();
  const { setUser, user } = useAuth();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(undefined);
    navigate("/login");
  };
  return (
    <IosPage>
      <IosTopBar title="账户信息" />
      <IosScroll className="ios-account-scroll">
        <IosCard className="ios-profile-card">
          <span>{user?.name?.slice(0, 1) ?? "?"}</span>
          <div>
            <b>{user?.name ?? "未登录"}</b>
            <small>{user?.email || "未绑定邮箱"} · {user?.plan === "pro" ? "Pro" : "Free"}</small>
          </div>
        </IosCard>
        <section className="ios-settings-section">
          <h2>账户</h2>
          <IosCard>
            <Link className="ios-settings-row" to="/subscription">
              <IconTile tint="#fff0e8" color="#ff681c">
                <CreditCardIcon size={20} weight="bold" />
              </IconTile>
              <span>订阅与套餐</span>
              <small>{user?.plan === "pro" ? "Pro" : "Free"}</small>
              <CaretRightIcon size={18} />
            </Link>
            <button className="ios-settings-row" type="button" onClick={() => setConfirmLogout(true)}>
              <IconTile tint="#fdeceb" color="#d74035">
                <SignOutIcon size={20} weight="bold" />
              </IconTile>
              <span style={{ color: "#d74035" }}>退出登录</span>
              <CaretRightIcon size={18} />
            </button>
          </IosCard>
        </section>
      </IosScroll>
      {confirmLogout && (
        <IosDialog
          danger
          title="退出登录"
          message="确定退出当前账号吗？"
          confirmText="退出登录"
          onCancel={() => setConfirmLogout(false)}
          onConfirm={() => void logout()}
        />
      )}
    </IosPage>
  );
}

export function SubscriptionPage() {
  const { user, refresh } = useAuth();
  const form = useForm<SubscriptionForm>({ defaultValues: { email: user?.email ?? "", phone: "" } });
  const [error, setError] = useState("");
  const upgrade = form.handleSubmit(async (value) => {
    setError("");
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
  const features = [
    ["AI 自然语言记账", "“记一笔昨天午餐 38” 即可入账"],
    ["AI 智能查账与分析", "用一句话查询、统计、生成报告"],
    ["文件批量识别", "小票、账单、Excel 一次处理多份"],
    ["高级分析与异常提醒", "趋势、成员贡献、大额预警"],
  ];
  return (
    <IosPage>
      <IosTopBar title="订阅升级" />
      <IosScroll className="ios-account-scroll">
        <section className="ios-upgrade-hero">
          <button type="button">PRO</button>
          <h1>解锁完整 AI 助手</h1>
          <p>让记账、查账与分析都交给 AI</p>
        </section>
        <IosCard className="ios-upgrade-features">
          {features.map(([title, text]) => (
            <div key={title}>
              <span>
                <CheckIcon size={14} weight="bold" />
              </span>
              <p>
                <b>{title}</b>
                <small>{text}</small>
              </p>
            </div>
          ))}
        </IosCard>
        {user?.plan === "pro" ? (
          <p className="ios-success-note">你已是 Pro 用户，完整 AI 能力已解锁。</p>
        ) : (
          <form className="ios-auth-form ios-subscription-form" onSubmit={upgrade}>
            <p>订阅前需绑定邮箱或手机号 · ¥28/月，随时取消</p>
            <IosField label="邮箱">
              <input type="email" autoComplete="email" {...form.register("email")} />
            </IosField>
            <IosField label="手机号">
              <input autoComplete="tel" {...form.register("phone")} />
            </IosField>
            {error && <p className="field-error">{error}</p>}
            <IosButton disabled={form.formState.isSubmitting} type="submit">
              {form.formState.isSubmitting ? "升级中…" : "升级到 Pro"}
            </IosButton>
          </form>
        )}
      </IosScroll>
    </IosPage>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [searchParams] = useSearchParams();
  const form = useForm<LoginForm>({ defaultValues: { identifier: "", password: "" } });
  const [error, setError] = useState("");
  const submit = form.handleSubmit(async (value) => {
    setError("");
    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier: value.identifier, password: value.password }),
      });
      await refresh();
      navigate(searchParams.get("redirect") || "/books");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "认证失败");
    }
  });
  return (
    <AuthShell title="欢迎回来" subtitle="继续维护你和家人的共享账本">
      <form className="ios-auth-form" onSubmit={submit}>
        <AuthInput icon={<UserCircleIcon size={19} />} label="用户名" placeholder="用户名 / 邮箱 / 手机号" autoComplete="username" registration={form.register("identifier")} />
        <PasswordInput label="密码" placeholder="密码" autoComplete="current-password" value={form.watch("password")} onChange={(value) => form.setValue("password", value, { shouldDirty: true })} />
        {error && <p className="field-error">{error}</p>}
        <IosButton disabled={form.formState.isSubmitting} type="submit">
          {form.formState.isSubmitting ? "登录中…" : "登录"}
        </IosButton>
      </form>
      <p className="ios-auth-switch">
        还没有账号？<Link to="/register">立即注册</Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [searchParams] = useSearchParams();
  const form = useForm<RegisterForm>({ defaultValues: { name: "", password: "", confirmPassword: "" } });
  const [error, setError] = useState("");
  const submit = form.handleSubmit(async (value) => {
    setError("");
    if (value.password !== value.confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    try {
      await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name: value.name, password: value.password }),
      });
      await refresh();
      navigate(searchParams.get("redirect") || "/books");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "认证失败");
    }
  });
  return (
    <AuthShell title="创建账号" subtitle="几秒钟后，你就能开始创建共享账本">
      <form className="ios-auth-form" onSubmit={submit}>
        <AuthInput icon={<UserCircleIcon size={19} />} label="用户名" placeholder="用户名" autoComplete="username" registration={form.register("name")} />
        <PasswordInput label="密码" placeholder="密码（至少 6 位）" autoComplete="new-password" value={form.watch("password")} onChange={(value) => form.setValue("password", value, { shouldDirty: true })} />
        <PasswordInput label="确认密码" placeholder="确认密码" autoComplete="new-password" value={form.watch("confirmPassword")} onChange={(value) => form.setValue("confirmPassword", value, { shouldDirty: true })} />
        {error && <p className="field-error">{error}</p>}
        <IosButton disabled={form.formState.isSubmitting} type="submit">
          {form.formState.isSubmitting ? "创建中…" : "创建账号"}
        </IosButton>
      </form>
      <p className="ios-auth-switch">
        已有账号？<Link to="/login">去登录</Link>
      </p>
    </AuthShell>
  );
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <IosPage className="ios-auth-page">
      <div className="ios-auth-brand">
        <span>
          <NotebookIcon size={31} weight="duotone" />
        </span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </IosPage>
  );
}

function AuthInput({
  icon,
  label,
  placeholder,
  autoComplete,
  registration,
}: {
  icon: ReactNode;
  label: string;
  placeholder: string;
  autoComplete?: string;
  registration: UseFormRegisterReturn;
}) {
  return (
    <label className="ios-auth-input">
      <span className="sr-only">{label}</span>
      {icon}
      <input autoComplete={autoComplete} placeholder={placeholder} {...registration} />
    </label>
  );
}

function PasswordInput({
  label,
  placeholder,
  autoComplete,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  autoComplete?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="ios-auth-input">
      <span className="sr-only">{label}</span>
      <LockKeyIcon size={19} />
      <input
        autoComplete={autoComplete}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <button type="button" aria-label={`${visible ? "隐藏" : "显示"}${label}`} onClick={() => setVisible((current) => !current)}>
        {visible ? <EyeSlashIcon size={20} /> : <EyeIcon size={20} />}
      </button>
    </label>
  );
}
