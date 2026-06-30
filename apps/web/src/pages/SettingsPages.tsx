import {
  BookOpenIcon,
  CaretRightIcon,
  CheckSquareOffsetIcon,
  DownloadSimpleIcon,
  FilesIcon,
  InfoIcon,
  LifebuoyIcon,
  PencilSimpleLineIcon,
  ShieldCheckIcon,
  SignOutIcon,
  SparkleIcon,
  TagIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { Input } from "@shared-ledger/ui";
import { useReducer, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  IconTile,
  IosButton,
  IosCard,
  IosDialog,
  IosField,
  IosPage,
  IosScroll,
  IosSheet,
  IosTopBar,
} from "../components/ios/IosDesign";
import { useAuth } from "../features/auth/AuthProvider";
import { terminalImportStatuses } from "../features/imports/status";
import { useInvitationBadge } from "../features/invitations/useInvitationBadge";
import { useAppSheetActions, type AppSheet } from "../features/sheets/SheetContext";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api } from "../lib";

type Resource = { id: string; name: string; type?: "income" | "expense"; icon?: string; sortOrder?: number };
type ImportJobSummary = { id: string; fileName?: string; status: string };
type ProfileEditState = { avatarUploading: boolean; email: string; error: string; name: string; saving: boolean };
type ProfileEditAction =
  | { type: "field"; field: "email" | "name"; value: string }
  | { type: "avatar-start" }
  | { type: "avatar-finish" }
  | { type: "save-start" }
  | { type: "save-error"; error: string };

function profileEditReducer(state: ProfileEditState, action: ProfileEditAction): ProfileEditState {
  switch (action.type) {
    case "field":
      return { ...state, [action.field]: action.value, error: "" };
    case "avatar-start":
      return { ...state, avatarUploading: true };
    case "avatar-finish":
      return { ...state, avatarUploading: false };
    case "save-start":
      return { ...state, error: "", saving: true };
    case "save-error":
      return { ...state, error: action.error, saving: false };
  }
}

export function SettingsPage() {
  const { user, setUser } = useAuth();
  const { book } = useActiveBook();
  const { openSheet } = useAppSheetActions();
  const { unreadCount: invitationBadge } = useInvitationBadge(user?.id);
  const { data: importsData } = useApi<{ imports: ImportJobSummary[] }>(book ? `/books/${book.id}/imports` : undefined);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const imports = importsData?.imports ?? [];
  const pendingCount = imports.filter((job) => job.status === "pending_confirmation").length;
  const fileTasks = imports.filter(
    (job) => job.status !== "pending_confirmation" && (!terminalImportStatuses.has(job.status) || job.status === "failed"),
  );
  const statusItems = [
    pendingCount > 0
      ? {
          key: "pending",
          icon: <CheckSquareOffsetIcon size={23} weight="fill" />,
          title: "待确认记录",
          count: pendingCount,
          caption: "有记录等待你确认",
          tone: "blue" as const,
        }
      : undefined,
    fileTasks.length > 0
      ? {
          key: "files",
          icon: <FilesIcon size={23} weight="fill" />,
          title: "文件任务",
          count: fileTasks.length,
          caption: fileTasks.some((job) => job.status === "failed") ? "有文件处理失败" : "文件处理中",
          tone: "orange" as const,
        }
      : undefined,
  ].filter(Boolean) as Array<{
    key: string;
    icon: ReactNode;
    title: string;
    count: number;
    caption: string;
    tone: "blue" | "orange";
  }>;
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(undefined);
  };

  return (
    <IosPage className="ios-me">
      <IosTopBar title="我的" />
      <IosScroll className="ios-me-scroll ios-main-tab-scroll">
        <IosCard className="ios-profile-card ios-me-hero" onClick={() => setProfileOpen(true)}>
          <span className="ios-profile-avatar-button" aria-hidden="true">
            <ProfileAvatar name={user?.name} url={user?.avatarUrl} />
            <i>
              <PencilSimpleLineIcon size={15} weight="bold" />
            </i>
          </span>
          <span className="ios-me-hero-copy">
            <span>
              <b>{user?.name || "当前用户"}</b>
              <em>✦ {user?.plan === "pro" ? "Pro" : "Free"}</em>
            </span>
            <small>当前账本 · {book?.name ?? "未选择账本"}</small>
          </span>
          <CaretRightIcon size={24} weight="bold" />
        </IosCard>

        {statusItems.length > 0 && (
          <section className={`ios-me-status ${statusItems.length === 1 ? "single" : ""}`}>
            <h2>待处理</h2>
            <div>
              {statusItems.map((item) => (
                <button
                  className={`ios-me-status-card ${item.tone}${statusItems.length === 1 ? " banner" : ""}`}
                  type="button"
                  onClick={() => openSheet({ type: item.key === "pending" ? "pending-imports" : "imports" })}
                  key={item.key}
                >
                  <IconTile>{item.icon}</IconTile>
                  <span>
                    <b>{item.title}</b>
                    <strong>{item.count}</strong>
                    <small>{item.caption}</small>
                  </span>
                  {statusItems.length === 1 ? <em>去处理</em> : <CaretRightIcon size={20} />}
                </button>
              ))}
            </div>
          </section>
        )}

        <Link className="ios-subscription-card" to="/subscription">
          <i />
          <IconTile tint="rgba(255,255,255,.12)" color="#fff">
            <SparkleIcon size={22} weight="fill" />
          </IconTile>
          <span>
            <b>{user?.plan === "pro" ? "Pro" : "升级 Pro"}</b>
            <small>AI 识别 · 批量处理 · 高级分析</small>
          </span>
          <em>
            查看权益 <CaretRightIcon size={16} weight="bold" />
          </em>
        </Link>

        <SettingsSection title="账本与协作">
          <SettingsRow to="/books/manage" icon={<BookOpenIcon size={18} />} label="管理账本" detail={book?.name} />
          <SettingsRow sheet={{ type: "members" }} icon={<UsersThreeIcon size={18} />} label="成员与邀请" badge={invitationBadge} />
          <SettingsRow to="/settings/categories" icon={<TagIcon size={18} />} label="分类管理" />
        </SettingsSection>
        <SettingsSection title="数据">
          <SettingsRow sheet={{ type: "settings-export" }} icon={<DownloadSimpleIcon size={18} />} label="导出数据" />
        </SettingsSection>
        <SettingsSection title="账户">
          <SettingsRow to="/account" icon={<ShieldCheckIcon size={18} />} label="账户与安全" />
          <SettingsRow sheet={{ type: "settings-help" }} icon={<LifebuoyIcon size={18} />} label="帮助与反馈" />
          <SettingsRow sheet={{ type: "settings-about" }} icon={<InfoIcon size={18} />} label="关于一起记" />
        </SettingsSection>
        <button className="ios-logout-row" type="button" onClick={() => setLogoutOpen(true)}>
          <SignOutIcon size={18} weight="bold" />
          退出登录
        </button>
      </IosScroll>
      {profileOpen && <ProfileEditSheet close={() => setProfileOpen(false)} />}
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

function ProfileEditSheet({ close }: { close: () => void }) {
  const { user, setUser } = useAuth();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [{ avatarUploading, email, error, name, saving }, dispatchProfileEdit] = useReducer(profileEditReducer, {
    avatarUploading: false,
    email: user?.email ?? "",
    error: "",
    name: user?.name ?? "",
    saving: false,
  });

  const uploadAvatar = async (file?: File) => {
    if (!file || avatarUploading) return;
    const formData = new FormData();
    formData.append("avatar", file);
    dispatchProfileEdit({ type: "avatar-start" });
    try {
      const result = await api<{ user: NonNullable<typeof user> }>("/auth/me/avatar", {
        method: "PUT",
        body: formData,
      });
      setUser(result.user);
      toast.success("头像已更新", { duration: 2400, closeButton: true });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "头像上传失败", { duration: 3000, closeButton: true });
    } finally {
      dispatchProfileEdit({ type: "avatar-finish" });
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  const save = async () => {
    if (!user) return;
    dispatchProfileEdit({ type: "save-start" });
    try {
      const result = await api<{ user: NonNullable<typeof user> }>("/auth/me/profile", {
        method: "PATCH",
        body: JSON.stringify({ name, email }),
      });
      setUser(result.user);
      toast.success("资料已保存", { duration: 2400, closeButton: true });
      close();
    } catch (cause) {
      dispatchProfileEdit({ type: "save-error", error: cause instanceof Error ? cause.message : "保存失败" });
    }
  };

  return (
    <IosSheet
      title="编辑个人资料"
      onClose={close}
      footer={<IosButton disabled={saving || !name.trim()} onClick={() => void save()}>{saving ? "保存中…" : "保存资料"}</IosButton>}
    >
      <div className="ios-profile-edit-sheet">
        <input
          ref={avatarInputRef}
          className="sr-only"
          type="file"
          aria-label="上传头像"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          onChange={(event) => void uploadAvatar(event.currentTarget.files?.[0])}
        />
        <button className="ios-profile-edit-avatar" type="button" disabled={avatarUploading} onClick={() => avatarInputRef.current?.click()}>
          <ProfileAvatar name={user?.name} url={user?.avatarUrl} />
          <small>{avatarUploading ? "上传中…" : "更换头像"}</small>
        </button>
        <IosField label="昵称" error={!name.trim() ? "请输入昵称" : undefined}>
          <Input value={name} onChange={(event) => dispatchProfileEdit({ type: "field", field: "name", value: event.currentTarget.value })} placeholder="昵称" />
        </IosField>
        <IosField label="邮箱">
          <Input type="email" value={email} onChange={(event) => dispatchProfileEdit({ type: "field", field: "email", value: event.currentTarget.value })} placeholder="可选，用于邀请和找回" />
        </IosField>
        {error && <p className="field-error">{error}</p>}
      </div>
    </IosSheet>
  );
}

function ProfileAvatar({ name, url }: { name?: string; url?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | undefined>();
  const usableUrl = url && !url.includes("/auth/avatar/") ? url : undefined;
  const failed = Boolean(usableUrl && failedUrl === usableUrl);

  if (usableUrl && !failed) return <img src={usableUrl} alt="" onError={() => setFailedUrl(usableUrl)} />;
  return <span>{userInitials(name)}</span>;
}

function userInitials(name?: string) {
  const value = (name || "我").trim();
  if (!value) return "我";
  if ([...value].every((char) => char.charCodeAt(0) <= 0x7f)) return value.slice(0, 2).toUpperCase();
  return Array.from(value).slice(0, 2).join("");
}

export function ManagementSettingsPage() {
  const location = useLocation();
  const { id: routeBookId } = useParams();

  if (location.pathname.includes("/export") || location.pathname.includes("/help") || location.pathname.includes("/about")) {
    return <Navigate to="/settings" replace />;
  }
  if (location.pathname.includes("/categories")) return <CategoryManagerPage />;
  if (routeBookId) return <BookSettingsPage bookId={routeBookId} />;
  return <CategoryManagerPage />;
}

function BookSettingsPage({ bookId }: { bookId: string }) {
  const navigate = useNavigate();
  const { data, reload } = useApi<{ book: { name: string; currency: string }; role?: string }>(`/books/${bookId}`);
  const [bookNameEdit, setBookNameEdit] = useState<{ bookId: string; name: string }>();
  const [bookError, setBookError] = useState("");
  const [savingBook, setSavingBook] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const canManageBook = data?.role === "creator" || data?.role === "admin";
  const bookName = bookNameEdit?.bookId === bookId ? bookNameEdit.name : (data?.book.name ?? "");
  const trimmedBookName = bookName.trim();
  const saveBook = async () => {
    if (!trimmedBookName || trimmedBookName === data?.book.name) return;
    setSavingBook(true);
    setBookError("");
    try {
      await api(`/books/${bookId}`, { method: "PATCH", body: JSON.stringify({ name: trimmedBookName }) });
      await reload();
      setBookNameEdit(undefined);
      toast.success("账本名称已更新", { duration: 2400, closeButton: true });
    } catch (cause) {
      setBookError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSavingBook(false);
    }
  };
  const remove = async () => {
    await api(`/books/${bookId}`, { method: "DELETE" });
    navigate("/books/manage");
  };

  return (
    <IosPage>
      <IosTopBar title="账本设置" back onBack={() => navigate("/books/manage", { replace: true })} />
      <IosScroll className="ios-me-scroll">
        <SettingsSection title="账本信息">
          <div className="ios-settings-info">
            <IconTile>
              <BookOpenIcon size={18} />
            </IconTile>
            <span>账本名称</span>
            <small>{data?.book.name ?? "账本"}</small>
          </div>
          <div className="ios-settings-info">
            <IconTile>
              <BookOpenIcon size={18} />
            </IconTile>
            <span>默认货币</span>
            <small>{data?.book.currency ?? "CNY"}</small>
          </div>
          <SettingsRow sheet={{ type: "members" }} icon={<UsersThreeIcon size={18} />} label="成员与权限" />
        </SettingsSection>
        {canManageBook && (
          <IosCard className="ios-form-card ios-book-rename-card">
            <IosField label="账本名称" error={bookError}>
              <Input
                value={bookName}
                onChange={(event) => setBookNameEdit({ bookId, name: event.currentTarget.value })}
                placeholder="账本名称"
              />
            </IosField>
            <IosButton disabled={savingBook || !trimmedBookName || trimmedBookName === data?.book.name} onClick={() => void saveBook()}>
              {savingBook ? "保存中…" : "保存名称"}
            </IosButton>
          </IosCard>
        )}
        {data?.role === "creator" && (
          <button className="ios-danger-text-button" type="button" onClick={() => setDeleteOpen(true)}>
            删除账本
          </button>
        )}
      </IosScroll>
      {deleteOpen && (
        <IosDialog
          title="删除账本"
          message="删除后将无法恢复，所有记录、成员与文件都会被移除。"
          confirmText="删除账本"
          danger
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => void remove()}
        />
      )}
    </IosPage>
  );
}

function CategoryManagerPage() {
  const navigate = useNavigate();
  const { book } = useActiveBook();
  const { data, reload } = useApi<{ categories: Resource[] }>(book ? `/books/${book.id}/categories` : undefined);
  const [editing, setEditing] = useState<Resource | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<Resource | undefined>();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const items = data?.categories ?? [];

  const startEdit = (item: Resource) => {
    setEditing(item);
    setName(item.name);
    setError("");
  };
  const resetForm = () => {
    setEditing(undefined);
    setName("");
    setError("");
  };
  const save = async () => {
    if (!book || !name.trim()) return;
    setError("");
    const body = JSON.stringify({
      name: name.trim(),
      type: editing?.type ?? "expense",
      icon: editing?.icon ?? "tag",
      sortOrder: editing?.sortOrder ?? items.length,
    });
    try {
      if (editing) await api(`/categories/${editing.id}`, { method: "PATCH", body });
      else await api(`/books/${book.id}/categories`, { method: "POST", body });
      toast.success(editing ? "分类已更新" : "分类已新增", { duration: 2400, closeButton: true });
      resetForm();
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    }
  };
  const remove = async () => {
    if (!deleteTarget) return;
    await api(`/categories/${deleteTarget.id}`, { method: "DELETE" });
    toast.success("分类已删除", { duration: 2400, closeButton: true });
    setDeleteTarget(undefined);
    await reload();
  };

  return (
    <IosPage>
      <IosTopBar title="分类管理" back onBack={() => goBack(navigate, "/settings")} />
      <IosScroll className="ios-me-scroll">
        <IosCard className="ios-category-list ios-category-manager">
          {items.map((item) => (
            <div key={item.id}>
              <IconTile tint="#fff0e8" color="#ff681c">
                <TagIcon size={18} weight="fill" />
              </IconTile>
              <span>
                <b>{item.name}</b>
                <small>通用分类</small>
              </span>
              <button type="button" onClick={() => startEdit(item)}>
                编辑
              </button>
              <button className="danger" type="button" onClick={() => setDeleteTarget(item)}>
                删除
              </button>
            </div>
          ))}
          {!items.length && <p className="muted">暂无分类</p>}
        </IosCard>
        <IosCard className="ios-form-card">
          <IosField label={editing ? "编辑分类" : "新增分类"} error={error}>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：餐饮" />
          </IosField>
          <div className="ios-category-actions">
            {editing && (
              <IosButton variant="secondary" onClick={resetForm}>
                取消编辑
              </IosButton>
            )}
            <IosButton disabled={!name.trim()} onClick={() => void save()}>
              {editing ? "保存分类" : "新增分类"}
            </IosButton>
          </div>
        </IosCard>
      </IosScroll>
      {deleteTarget && (
        <IosDialog
          title="删除分类"
          message={`确定删除「${deleteTarget.name}」吗？已有记录不会被删除，但可能显示为未分类。`}
          confirmText="删除"
          danger
          onCancel={() => setDeleteTarget(undefined)}
          onConfirm={() => void remove()}
        />
      )}
    </IosPage>
  );
}

export function ExportSheet({ onClose }: { onClose: () => void }) {
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
      toast.success("导出已开始", { duration: 2400, closeButton: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <IosSheet
      title="导出数据"
      onClose={onClose}
      footer={
        <IosButton disabled={!book || busy} onClick={() => void exportBook()}>
          {busy ? "导出中…" : "导出为 JSON"}
        </IosButton>
      }
    >
      <div className="ios-me-scroll">
        <IosCard className="ios-export-card">
          <h2>本次导出包含</h2>
          {["账本信息与默认货币", "全部成员与角色", "全部交易与明细", "类别与邀请记录", "相关元数据"].map((item) => (
            <p key={item}>
              <i />
              {item}
            </p>
          ))}
        </IosCard>
        <p className="ios-export-note">导出格式为 JSON，文件仅包含你有权访问的数据。</p>
      </div>
    </IosSheet>
  );
}

export function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <IosSheet title="帮助与反馈" onClose={onClose}>
      <div className="ios-me-scroll">
        <IosCard className="ios-help-card">
          <h2>常见问题</h2>
          <article>
            <b>文件识别后为什么要确认？</b>
            <p>OCR 与 AI 会先生成候选记录，确认后才会正式写入账本，避免误入账。</p>
          </article>
          <article>
            <b>成员可以看到哪些数据？</b>
            <p>成员只能访问自己加入的账本。管理员可以邀请成员和调整权限。</p>
          </article>
          <article>
            <b>如何反馈问题？</b>
            <p>请把问题现象、文件类型和时间告诉维护者；后续会接入正式反馈入口。</p>
          </article>
        </IosCard>
      </div>
    </IosSheet>
  );
}

export function AboutSheet({ onClose }: { onClose: () => void }) {
  return (
    <IosSheet title="关于一起记" onClose={onClose}>
      <div className="ios-me-scroll">
        <IosCard className="ios-about-card">
          <IconTile>
            <BookOpenIcon size={24} weight="fill" />
          </IconTile>
          <h2>一起记</h2>
          <p>和重要的人，一起记下生活。当前版本 0.1.0。</p>
          <small>Shared Ledger · Mobile Web</small>
        </IosCard>
      </div>
    </IosSheet>
  );
}

function goBack(navigate: ReturnType<typeof useNavigate>, fallback: string) {
  if (window.history.length > 1) navigate(-1);
  else navigate(fallback);
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ios-settings-section">
      <h2>{title}</h2>
      <IosCard>{children}</IosCard>
    </section>
  );
}

function SettingsRow({
  to,
  sheet,
  icon,
  label,
  detail,
  badge = 0,
}: {
  to?: string;
  sheet?: AppSheet;
  icon: ReactNode;
  label: string;
  detail?: string;
  badge?: number;
}) {
  const { openSheet } = useAppSheetActions();
  const content = (
    <>
      <IconTile>{icon}</IconTile>
      <span>{label}</span>
      {detail ? <small>{detail}</small> : null}
      {badge > 0 ? <em className="ios-row-badge">{badge > 9 ? "9+" : badge}</em> : null}
      <CaretRightIcon size={18} />
    </>
  );
  if (sheet) {
    return (
      <button className="ios-settings-row" type="button" onClick={() => openSheet(sheet)}>
        {content}
      </button>
    );
  }
  return (
    <Link className="ios-settings-row" to={to ?? "#"}>
      {content}
    </Link>
  );
}
