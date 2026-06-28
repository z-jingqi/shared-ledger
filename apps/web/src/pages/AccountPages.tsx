import {
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  LockKeyIcon,
  NotebookIcon,
  ShieldCheckIcon,
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
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const changePassword = async () => {
    setPasswordSaved(false);
    setPasswordError("");
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致");
      return;
    }
    setSavingPassword(true);
    try {
      await api("/auth/me/password", {
        method: "PUT",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
    } catch (cause) {
      setPasswordError(cause instanceof Error ? cause.message : "修改密码失败");
    } finally {
      setSavingPassword(false);
    }
  };
  return (
    <IosPage>
      <IosTopBar title="账户与安全" back onBack={() => navigate(-1)} />
      <IosScroll className="ios-account-scroll">
        <IosCard className="ios-security-summary">
          <IconTile tint="#e9fbef" color="#24b05a">
            <ShieldCheckIcon size={24} weight="fill" />
          </IconTile>
          <div>
            <b>账号安全</b>
            <small>{user?.email || user?.name || "当前账号"} · {user?.plan === "pro" ? "Pro" : "Free"}</small>
          </div>
        </IosCard>
        <section className="ios-settings-section">
          <h2>修改密码</h2>
          <IosCard className="ios-form-card ios-password-card">
            <IosField label="当前密码">
              <input autoComplete="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.currentTarget.value)} />
            </IosField>
            <IosField label="新密码">
              <input autoComplete="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.currentTarget.value)} placeholder="至少 6 位" />
            </IosField>
            <IosField label="确认新密码" error={passwordError}>
              <input autoComplete="new-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.currentTarget.value)} />
            </IosField>
            {passwordSaved ? <p className="ios-success-note">密码已更新，下次登录请使用新密码。</p> : null}
            <IosButton disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword} onClick={() => void changePassword()}>
              {savingPassword ? "保存中…" : "修改密码"}
            </IosButton>
          </IosCard>
        </section>
        <section className="ios-settings-section">
          <h2>账号信息</h2>
          <IosCard>
            <div className="ios-settings-info ios-user-id-row">
              <IconTile tint="#f0f2f5" color="#5b6473">
                <UserCircleIcon size={20} weight="bold" />
              </IconTile>
              <span>用户 ID</span>
              <code>{user?.id ?? "未登录"}</code>
            </div>
          </IosCard>
        </section>
      </IosScroll>
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
