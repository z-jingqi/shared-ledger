import {
  BookOpenIcon,
  CaretRightIcon,
  ChartPieSliceIcon,
  MoonIcon,
  SignOutIcon,
  SquaresFourIcon,
  TagIcon,
  TrashIcon,
  UsersThreeIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { Button, Panel } from "@shared-ledger/ui";
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Page } from "../components/layout/Page";
import { useAuth } from "../features/auth/AuthProvider";
import { settingsLinks } from "../features/ledger/data";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api } from "../lib";

export function SettingsPage() {
  const { setUser } = useAuth();
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(undefined);
  };
  const primaryLinks = settingsLinks.slice(0, 4);
  const secondaryLinks = settingsLinks.slice(4);
  return (
    <>
      <Page title="设置" back={false} />
      <SettingsGroup links={primaryLinks} />
      <SettingsGroup links={secondaryLinks} />
      <Panel className="settings-toggle-row">
        <MoonIcon size={25} />
        <span>深色模式</span>
        <button aria-label="深色模式" type="button" />
      </Panel>
      <button className="logout" onClick={() => void logout()}>
        <SignOutIcon size={20} />
        退出登录
      </button>
    </>
  );
}
function SettingsGroup({ links }: { links: typeof settingsLinks }) {
  return (
    <Panel className="settings-list">
      {links.map(({ label, to, Icon }) => (
        <Link to={to} key={to}>
          <Icon size={24} />
          <span>{label}</span>
          <CaretRightIcon />
        </Link>
      ))}
    </Panel>
  );
}
type Resource = { id: string; name: string; type?: string; color?: string };
export function ManagementSettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { id: routeBookId } = useParams();
  const { book } = useActiveBook();
  const path = location.pathname.includes("categories")
    ? "categories"
    : location.pathname.includes("tags")
      ? "tags"
      : location.pathname.includes("accounts")
        ? "accounts"
        : undefined;
  const settingsTitle = settingsLinks.find((item) => location.pathname === item.to)?.label;
  const title = settingsTitle ?? (routeBookId ? "账本设置" : "设置");
  const { data, reload } = useApi<Record<string, Resource[]>>(
    path && book ? `/books/${book.id}/${path}` : undefined,
  );
  const { data: directBookData } = useApi<{ book: { name: string; currency: string } }>(
    !path && routeBookId ? `/books/${routeBookId}` : undefined,
  );
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const items = path ? (data?.[path] ?? []) : [];
  const create = async () => {
    if (!path || !book || !name.trim()) return;
    const body =
      path === "categories"
        ? { name, type: "expense", icon: "tag", sortOrder: items.length }
        : path === "tags"
          ? { name, color: "#ff681c" }
          : { name, type: "cash" };
    try {
      await api(`/books/${book.id}/${path}`, { method: "POST", body: JSON.stringify(body) });
      setName("");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    }
  };
  if (location.pathname.includes("/export")) {
    const exportBook = async () => {
      if (!book) return;
      const payload = await api(`/books/${book.id}/export`);
      const objectUrl = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${book.name}-export.json`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    };
    return (
      <>
        <Page title={title} />
        <Panel>
          <h2>导出账本数据</h2>
          <p className="muted">下载账本、成员、记录、分类、标签、账户和邀请的 JSON 备份。</p>
          <Button onClick={() => void exportBook()} disabled={!book}>
            下载 JSON 备份
          </Button>
        </Panel>
      </>
    );
  }
  if (!path && routeBookId) {
    const remove = async () => {
      if (window.confirm("删除账本会隐藏其全部数据，确定继续吗？")) {
        await api(`/books/${routeBookId}`, { method: "DELETE" });
        navigate("/books");
      }
    };
    return (
      <>
        <Page title="账本设置" />
        <Panel className="settings-list book-settings-list">
          <button type="button">
            <BookOpenIcon size={24} />
            <span>账本名称</span>
            <small>{directBookData?.book.name ?? "我的日常账本"}</small>
            <CaretRightIcon />
          </button>
          <button type="button">
            <WalletIcon size={24} />
            <span>默认货币</span>
            <small>{directBookData?.book.currency === "USD" ? "美元（USD）" : "人民币（CNY）"}</small>
            <CaretRightIcon />
          </button>
          <Link to="/members">
            <UsersThreeIcon size={24} />
            <span>成员与权限</span>
            <small>成员管理</small>
            <CaretRightIcon />
          </Link>
          <button type="button">
            <ChartPieSliceIcon size={24} />
            <span>预算设置</span>
            <small>未设置</small>
            <CaretRightIcon />
          </button>
          <Link to="/settings/categories">
            <SquaresFourIcon size={24} />
            <span>分类管理</span>
            <small>分类</small>
            <CaretRightIcon />
          </Link>
          <Link to="/settings/tags">
            <TagIcon size={24} />
            <span>标签管理</span>
            <small>标签</small>
            <CaretRightIcon />
          </Link>
        </Panel>
        <button className="logout danger-outline" onClick={() => void remove()}>
          <TrashIcon size={22} />
          删除账本
          <CaretRightIcon />
        </button>
      </>
    );
  }
  if (!path && !routeBookId && location.pathname.includes("/settings/privacy"))
    return (
      <>
        <Page title={title} />
        <Panel className="settings-list">
          {["隐藏金额", "隐藏收入", "仅本人可见记录", "保存导入文件", "允许智能分析"].map((item) => (
            <button type="button" key={item}>
              <span>{item}</span>
              <small>已关闭</small>
            </button>
          ))}
        </Panel>
      </>
    );
  if (!path && !routeBookId && location.pathname.includes("/settings/notifications"))
    return (
      <>
        <Page title={title} />
        <Panel className="settings-list">
          {["邀请通知", "导入完成提醒", "每周账本摘要"].map((item) => (
            <button type="button" key={item}>
              <span>{item}</span>
              <small>已开启</small>
            </button>
          ))}
        </Panel>
      </>
    );
  if (!path && !routeBookId && location.pathname.includes("/settings/about"))
    return (
      <>
        <Page title={title} />
        <Panel>
          <h2>一起记</h2>
          <p className="muted">和重要的人，一起记下生活。当前版本 0.1.0。</p>
        </Panel>
      </>
    );
  if (!path)
    return (
      <>
        <Page title={title} />
        <Panel>
          <h2>{title}</h2>
          <p className="muted">该设置项暂未开放。</p>
        </Panel>
      </>
    );
  return (
    <>
      <Page title={title} />
      <Panel>
        {items.map((item) => (
          <div className="history-row" key={item.id}>
            <strong>{item.name}</strong>
            <span>{item.type ?? item.color}</span>
          </div>
        ))}
        {!items.length && <p className="muted">暂无项目</p>}
      </Panel>
      <div className="form">
        <label>
          新增项目
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {error && <p className="field-error">{error}</p>}
        <Button onClick={() => void create()}>新增项目</Button>
      </div>
    </>
  );
}
