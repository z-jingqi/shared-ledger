import { CaretRightIcon, RobotIcon, SignOutIcon, SparkleIcon } from "@phosphor-icons/react";
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
  const { user, setUser } = useAuth();
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(undefined);
  };
  return (
    <>
      <Page title="我的" back={false} />
      <Panel className="profile">
        <span>{user?.name.slice(0, 1) ?? "?"}</span>
        <div>
          <h2>{user?.name ?? "未登录"}</h2>
          <p>{user?.email || "未绑定邮箱"}</p>
        </div>
        <Link to="/account">
          <CaretRightIcon />
        </Link>
      </Panel>
      {user?.plan === "pro" ? (
        <Link to="/ai" className="upgrade-banner">
          <RobotIcon size={24} weight="fill" />
          <span>
            <b>AI 助手已开启</b>
            <small>随时分析你的账本</small>
          </span>
          <CaretRightIcon />
        </Link>
      ) : (
        <Link to="/subscription" className="upgrade-banner">
          <SparkleIcon size={24} weight="fill" />
          <span>
            <b>升级 Pro</b>
            <small>开启 AI 账本助手</small>
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
      <button className="logout" onClick={() => void logout()}>
        <SignOutIcon size={20} />
        退出登录
      </button>
    </>
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
  const title = settingsLinks.find((item) => location.pathname === item.to)?.label ?? "账本设置";
  const { data, reload } = useApi<Record<string, Resource[]>>(
    path && book ? `/books/${book.id}/${path}` : undefined,
  );
  const { data: directBookData } = useApi<{ book: { name: string; currency: string } }>(
    !path && routeBookId ? `/books/${routeBookId}` : undefined,
  );
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [currency, setCurrency] = useState("CNY");
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
    const save = async () => {
      await api(`/books/${routeBookId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name || directBookData?.book.name, currency }),
      });
      navigate(`/books/${routeBookId}`);
    };
    const remove = async () => {
      if (window.confirm("删除账本会隐藏其全部数据，确定继续吗？")) {
        await api(`/books/${routeBookId}`, { method: "DELETE" });
        navigate("/books");
      }
    };
    return (
      <>
        <Page title="账本设置" />
        <div className="form">
          <label>
            账本名称
            <input
              defaultValue={directBookData?.book.name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            货币
            <select
              defaultValue={directBookData?.book.currency ?? "CNY"}
              onChange={(event) => setCurrency(event.target.value)}
            >
              <option value="CNY">人民币 CNY</option>
              <option value="USD">美元 USD</option>
            </select>
          </label>
          <Button onClick={() => void save()}>保存账本</Button>
          <button className="logout" onClick={() => void remove()}>
            删除账本
          </button>
        </div>
      </>
    );
  }
  if (!path)
    return (
      <>
        <Page title={title} />
        <Panel>
          <h2>{title}</h2>
          <p className="muted">账本名称、货币及成员均可通过对应入口管理。</p>
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
