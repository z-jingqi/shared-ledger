import {
  BookOpenIcon,
  CaretRightIcon,
  DownloadSimpleIcon,
  SignOutIcon,
  SquaresFourIcon,
  TrashIcon,
  UserCircleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { Input } from "@shared-ledger/ui";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { IconTile, IosButton, IosCard, IosDialog, IosField, IosPage, IosScroll, IosTopBar } from "../components/ios/IosDesign";
import { useAuth } from "../features/auth/AuthProvider";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api } from "../lib";

type Resource = { id: string; name: string; type?: string; color?: string };

export function SettingsPage() {
  const { user, setUser } = useAuth();
  const { book } = useActiveBook();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(undefined);
  };
  return (
    <IosPage className="ios-me">
      <IosTopBar title="我的" />
      <IosScroll className="ios-me-scroll">
        <IosCard className="ios-profile-card">
          <span>我</span>
          <div>
            <b>{user?.name || "当前用户"}</b>
            <small>{user?.email || "未绑定邮箱"}</small>
          </div>
          <CaretRightIcon size={18} />
        </IosCard>
        <section className="ios-subscription-card">
          <i />
          <header>
            <span>
              <small>当前订阅</small>
              <b>{user?.plan === "pro" ? "Pro" : "Free"}</b>
            </span>
            <em>{user?.plan === "pro" ? "已订阅" : "免费版"}</em>
          </header>
          <p>{user?.plan === "pro" ? "已解锁完整 AI 助手、文件批量识别与高级分析。" : "可使用核心记账与协作功能。升级 Pro 解锁完整 AI 助手与批量文件识别。"}</p>
          {user?.plan !== "pro" && <Link to="/subscription">升级到 Pro · 解锁完整 AI</Link>}
        </section>
        <SettingsSection title="账本">
          <SettingsRow to="/books/manage" icon={<BookOpenIcon size={18} />} label="切换 / 管理账本" detail={book?.name} />
          <SettingsRow to="/members" icon={<UsersThreeIcon size={18} />} label="成员与邀请" detail="成员管理" />
          <SettingsRow to="/records/pending" icon={<SquaresFourIcon size={18} />} label="待确认记录" />
          <SettingsRow to="/settings/export" icon={<DownloadSimpleIcon size={18} />} label="导出数据" />
        </SettingsSection>
        <SettingsSection title="账号">
          <SettingsRow to="/account" icon={<UserCircleIcon size={18} />} label="账户信息" />
          <button className="ios-settings-row" type="button" onClick={() => setLogoutOpen(true)}>
            <IconTile tint="#fdeceb" color="#d74035"><SignOutIcon size={18} /></IconTile>
            <span>退出登录</span>
            <CaretRightIcon size={18} />
          </button>
        </SettingsSection>
      </IosScroll>
      {logoutOpen && (
        <IosDialog
          title="退出登录"
          message="确定退出当前账号吗？"
          confirmText="退出登录"
          danger
          onCancel={() => setLogoutOpen(false)}
          onConfirm={() => void logout()}
        />
      )}
    </IosPage>
  );
}

export function ManagementSettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { id: routeBookId } = useParams();
  const { book } = useActiveBook();
  const path = location.pathname.includes("categories") ? "categories" : undefined;
  const { data, reload } = useApi<Record<string, Resource[]>>(path && book ? `/books/${book.id}/${path}` : undefined);
  const { data: directBookData } = useApi<{ book: { name: string; currency: string }; role?: string }>(!path && routeBookId ? `/books/${routeBookId}` : undefined);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const items = path ? (data?.[path] ?? []) : [];

  if (location.pathname.includes("/export")) return <ExportPage />;

  if (!path && routeBookId) {
    const remove = async () => {
      await api(`/books/${routeBookId}`, { method: "DELETE" });
      navigate("/books");
    };
    return (
      <IosPage>
        <IosTopBar title="账本设置" />
        <IosScroll className="ios-me-scroll">
          <SettingsSection title="账本信息">
            <div className="ios-settings-info">
              <IconTile><BookOpenIcon size={18} /></IconTile>
              <span>账本名称</span>
              <small>{directBookData?.book.name ?? "账本"}</small>
            </div>
            <div className="ios-settings-info">
              <IconTile><BookOpenIcon size={18} /></IconTile>
              <span>默认货币</span>
              <small>{directBookData?.book.currency ?? "CNY"}</small>
            </div>
            <SettingsRow to="/members" icon={<UsersThreeIcon size={18} />} label="成员与权限" />
            <SettingsRow to="/settings/categories" icon={<SquaresFourIcon size={18} />} label="分类管理" />
          </SettingsSection>
          {directBookData?.role === "creator" && (
            <IosButton variant="outline" className="ios-danger-link" onClick={() => setDeleteOpen(true)}>
              <TrashIcon size={20} /> 删除账本
            </IosButton>
          )}
        </IosScroll>
        {deleteOpen && <IosDialog title="删除账本" message="删除后将无法恢复，所有记录、成员与文件都会被移除。" confirmText="删除账本" danger onCancel={() => setDeleteOpen(false)} onConfirm={() => void remove()} />}
      </IosPage>
    );
  }

  if (!path && location.pathname.includes("/settings/about"))
    return (
      <IosPage>
        <IosTopBar title="关于我们" />
        <IosScroll className="ios-me-scroll">
          <IosCard className="ios-about-card">
            <h2>一起记</h2>
            <p>和重要的人，一起记下生活。当前版本 0.1.0。</p>
          </IosCard>
        </IosScroll>
      </IosPage>
    );

  const create = async () => {
    if (!path || !book || !name.trim()) return;
    try {
      await api(`/books/${book.id}/${path}`, { method: "POST", body: JSON.stringify({ name, type: "expense", icon: "tag", sortOrder: items.length }) });
      setName("");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    }
  };

  return (
    <IosPage>
      <IosTopBar title="分类管理" />
      <IosScroll className="ios-me-scroll">
        <IosCard className="ios-category-list">
          {items.map((item) => (
            <div key={item.id}>
              <b>{item.name}</b>
              <small>{item.type ?? item.color ?? "分类"}</small>
            </div>
          ))}
          {!items.length && <p className="muted">暂无分类</p>}
        </IosCard>
        <IosCard className="ios-form-card">
          <IosField label="新增分类" error={error}>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：餐饮" />
          </IosField>
          <IosButton onClick={() => void create()}>新增分类</IosButton>
        </IosCard>
      </IosScroll>
    </IosPage>
  );
}

function ExportPage() {
  const { book } = useActiveBook();
  const [busy, setBusy] = useState(false);
  const exportBook = async () => {
    if (!book) return;
    setBusy(true);
    try {
      const payload = await api(`/books/${book.id}/export`);
      const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${book.name}-export.json`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setBusy(false);
    }
  };
  return (
    <IosPage>
      <IosTopBar title="导出数据" />
      <IosScroll className="ios-me-scroll">
        <IosCard className="ios-export-card">
          <h2>本次导出包含</h2>
          {["账本信息与默认货币", "全部成员与角色", "全部交易与明细", "类别与邀请记录", "相关元数据"].map((item) => (
            <p key={item}><i />{item}</p>
          ))}
        </IosCard>
        <p className="ios-export-note">导出格式为 JSON，文件仅包含你有权访问的数据。</p>
        <IosButton disabled={!book || busy} onClick={() => void exportBook()}>{busy ? "导出中…" : "导出为 JSON"}</IosButton>
      </IosScroll>
    </IosPage>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ios-settings-section">
      <h2>{title}</h2>
      <IosCard>{children}</IosCard>
    </section>
  );
}

function SettingsRow({ to, icon, label, detail }: { to: string; icon: React.ReactNode; label: string; detail?: string }) {
  return (
    <Link className="ios-settings-row" to={to}>
      <IconTile>{icon}</IconTile>
      <span>{label}</span>
      {detail ? <small>{detail}</small> : null}
      <CaretRightIcon size={18} />
    </Link>
  );
}
