import {
  BookOpenIcon,
  CaretRightIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserPlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  IosButton,
  IosCard,
  IosDialog,
  IosField,
  IosPage,
  IosScroll,
  IosSegment,
  IosSheet,
  IosTopBar,
} from "../components/ios/IosDesign";
import { useAuth } from "../features/auth/AuthProvider";
import {
  type InvitationLike,
  isBadgeInvitation,
  markInvitationItemsViewed,
} from "../features/invitations/viewed";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api } from "../lib";

type Role = "creator" | "admin" | "member";
type Member = { id: string; userId?: string; name: string; role: Role };
type UserSummary = {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  plan?: "free" | "pro";
};
type Invitation = InvitationLike & {
  bookId: string;
  inviterUserId: string;
  inviteeEmail?: string;
  inviteeUserId?: string;
  role: "admin" | "member";
  expiresAt: string;
  createdAt?: string;
  updatedAt?: string;
  book?: { id: string; name: string; currency: string };
  inviter?: UserSummary;
  invitee?: UserSummary;
  direction: "sent" | "received";
};
type InviteBlock = {
  id: string;
  createdAt: string;
  user: UserSummary;
};
type InvitationTab = "received" | "sent" | "history" | "blocked";

export function MembersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { book } = useActiveBook();
  const { data: memberData, reload: reloadMembers } = useApi<{ members: Member[] }>(
    book ? `/books/${book.id}/members` : undefined,
  );
  const [removing, setRemoving] = useState<Member | "me" | undefined>();
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);

  const members = memberData?.members ?? [];
  const myMember = members.find((member) => member.userId === user?.id);
  const canManageMembers = myMember?.role === "creator" || myMember?.role === "admin";
  const invitationsPath = queryPath("/invitations", book?.id);

  const removeMember = async () => {
    if (!book || !removing) return;
    try {
      if (removing === "me") {
        await api(`/books/${book.id}/members/me`, { method: "DELETE" });
        toast.success("已退出账本", { duration: 2600, closeButton: true });
        navigate("/books");
      } else {
        await api(`/books/${book.id}/members/${removing.id}`, { method: "DELETE" });
        toast.success("成员已移除", { duration: 2600, closeButton: true });
        await reloadMembers();
      }
      setRemoving(undefined);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "操作失败", { duration: 3000, closeButton: true });
    }
  };

  return (
    <IosPage className="ios-members-page">
      <IosTopBar title="成员管理" back onBack={() => navigate(queryPath("/settings", book?.id))} />
      <IosScroll className="ios-members-scroll ios-main-tab-scroll">
        <BookMemberSummary bookName={book?.name} currency={book?.currency} memberCount={members.length} />

        <section>
          <h3 className="ios-member-section-title">成员列表</h3>
          <IosCard className="ios-member-list">
            {members.map((member) => (
              <MemberRow
                member={member}
                isMe={member.userId === user?.id}
                canRemove={member.role !== "creator" && canManageMembers}
                onRemove={() => setRemoving(member)}
                key={member.id}
              />
            ))}
            {!members.length && <p className="muted">暂无成员</p>}
          </IosCard>
        </section>

        <IosCard className="ios-member-action-list" aria-label="成员操作">
          <ActionLink to={invitationsPath} title="邀请记录" caption="查看收到、已发和历史邀请" />
        </IosCard>

        {canManageMembers && (
          <IosButton className="ios-member-send-button" onClick={() => setInviteSheetOpen(true)}>
            邀请成员
          </IosButton>
        )}

        {myMember?.role !== "creator" && (
          <IosButton variant="outline" className="danger-text" onClick={() => setRemoving("me")}>
            退出该账本
          </IosButton>
        )}
      </IosScroll>
      {removing && (
        <IosDialog
          danger
          title={removing === "me" ? "退出账本" : "移除成员"}
          message={
            removing === "me"
              ? "退出后你将无法访问该账本，但历史记录会保留给其他成员。"
              : `确定移除「${removing.name}」？历史记录将保留，对方将无法再访问该账本。`
          }
          confirmText={removing === "me" ? "退出账本" : "移除"}
          onCancel={() => setRemoving(undefined)}
          onConfirm={() => void removeMember()}
        />
      )}
      {inviteSheetOpen && <InviteMemberSheet bookId={book?.id} onClose={() => setInviteSheetOpen(false)} />}
    </IosPage>
  );
}

export function MembersSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  useEffect(() => {
    onClose();
    navigate("/members");
  }, [navigate, onClose]);
  return null;
}

export function InviteMemberPage() {
  const navigate = useNavigate();
  const { book } = useActiveBook();

  return (
    <IosPage className="ios-members-page ios-invite-member-page">
      <IosTopBar title="邀请成员" back onBack={() => navigate(queryPath("/members", book?.id))} />
      <IosScroll className="ios-members-scroll ios-main-tab-scroll">
        <BookMemberSummary bookName={book?.name} currency={book?.currency} memberCount={undefined} />
        <InviteMemberForm bookId={book?.id} onSent={() => navigate(queryPath("/members", book?.id))} />
      </IosScroll>
    </IosPage>
  );
}

function InviteMemberSheet({ bookId, onClose }: { bookId?: string; onClose: () => void }) {
  return (
    <IosSheet
      title="邀请成员"
      className="ios-invite-sheet"
      onClose={onClose}
      right={
        <Link className="ios-sheet-text-action" to={queryPath("/invitations", bookId)}>
          邀请记录
        </Link>
      }
    >
      <InviteMemberForm bookId={bookId} onSent={onClose} />
    </IosSheet>
  );
}

function InviteMemberForm({ bookId, onSent }: { bookId?: string; onSent: () => void }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [result, setResult] = useState<UserSummary | undefined>();
  const [message, setMessage] = useState("");
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);

  const search = async () => {
    const value = query.trim();
    setMessage("");
    setResult(undefined);
    if (!value) {
      setMessage("请输入完整用户名、邮箱或手机号。");
      return;
    }
    setSearching(true);
    try {
      const response = await api<{ users: UserSummary[] }>(
        `/users/search?query=${encodeURIComponent(value)}`,
      );
      const found = response.users[0];
      setResult(found);
      if (!found) setMessage("没有找到完全匹配的用户。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "搜索失败");
    } finally {
      setSearching(false);
    }
  };

  const send = async () => {
    if (!bookId || !result) return;
    setSending(true);
    setMessage("");
    try {
      await api(`/books/${bookId}/invitations`, {
        method: "POST",
        body: JSON.stringify({ userId: result.id, role }),
      });
      toast.success("邀请已发送", { duration: 2600, closeButton: true });
      onSent();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "邀请失败");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="ios-invite-form">
      <IosCard className="ios-invite-intro-card">
        <span className="ios-invite-intro-icon">
          <UserPlusIcon size={22} weight="fill" />
        </span>
        <span>
          <b>邀请到当前账本</b>
          <small>先搜索用户，选中后发送邀请。</small>
        </span>
      </IosCard>

      <IosCard className="ios-invite-search-card">
        <p className="ios-invite-help">输入完整用户名、邮箱或手机号，只会匹配一个用户。</p>
        <div className="ios-invite-search-row">
          <IosField label="搜索用户" error={message}>
            <input
              value={query}
              aria-label="搜索用户"
              placeholder="完整用户名 / 邮箱 / 手机号"
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setMessage("");
                setResult(undefined);
              }}
            />
          </IosField>
          <button
            className="ios-invite-search-button"
            type="button"
            disabled={searching}
            onClick={() => void search()}
          >
            <MagnifyingGlassIcon size={18} weight="bold" />
            {searching ? "搜索中" : "搜索"}
          </button>
        </div>

        {result && (
          <div className="ios-invite-selected exact">
            <UserIdentity user={result} />
            <span className="ios-invite-result-badge">可邀请</span>
          </div>
        )}
      </IosCard>

      <section>
        <h3 className="ios-member-section-title">分配角色</h3>
        <div className="ios-role-cards">
          {(["member", "admin"] as const).map((value) => (
            <button
              className={role === value ? "active" : ""}
              type="button"
              onClick={() => setRole(value)}
              key={value}
            >
              <ShieldCheckIcon size={18} weight="bold" />
              <b>{roleLabel(value)}</b>
              <small>{value === "admin" ? "可邀请成员、管理权限" : "可查看账本并记录"}</small>
            </button>
          ))}
        </div>
      </section>

      <IosButton
        className="ios-invite-submit-button"
        disabled={sending || !bookId || !result}
        onClick={() => void send()}
      >
        {sending ? "发送中…" : "发送邀请"}
      </IosButton>
    </div>
  );
}

export function InvitationRecordsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { book } = useActiveBook();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = parseInvitationTab(searchParams.get("tab"));
  const [tab, setTab] = useState<InvitationTab>(initialTab);
  const [declining, setDeclining] = useState<Invitation | undefined>();
  const [deletingInvitation, setDeletingInvitation] = useState<Invitation | undefined>();
  const { data: invitationsData, reload: reloadInvitations } = useApi<{ invitations: Invitation[] }>(
    user ? "/invitations" : undefined,
  );
  const { data: blocksData, reload: reloadBlocks } = useApi<{ blocks: InviteBlock[] }>(
    user ? "/users/invite-blocks" : undefined,
  );

  const invitations = invitationsData?.invitations ?? [];
  const blocks = blocksData?.blocks ?? [];
  const received = invitations.filter((item) => item.direction === "received");
  const sent = invitations.filter((item) => item.direction === "sent");
  const history = invitations.filter((item) => item.status !== "pending");
  const badgeInvitations = useMemo(() => invitations.filter(isBadgeInvitation), [invitations]);

  useEffect(() => {
    if (user?.id && badgeInvitations.length) markInvitationItemsViewed(user.id, badgeInvitations);
  }, [badgeInvitations, user?.id]);

  const changeTab = (value: string) => {
    const nextTab = value as InvitationTab;
    setTab(nextTab);
    const next = new URLSearchParams(searchParams);
    next.set("tab", nextTab);
    setSearchParams(next, { replace: true });
  };

  const reloadAll = async () => {
    await Promise.all([reloadInvitations(), reloadBlocks()]);
  };

  const handleReceivedInvitation = async (invitation: Invitation, action: "accept" | "decline") => {
    try {
      if (action === "accept") {
        await api(`/invitations/${invitation.id}/accept`, { method: "POST" });
        toast.success("已加入账本", { duration: 2600, closeButton: true });
      } else {
        await api(`/invitations/${invitation.id}/decline`, { method: "POST", body: JSON.stringify({}) });
        toast.success("已拒绝邀请", { duration: 2600, closeButton: true });
      }
      await reloadAll();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "操作失败", { duration: 3000, closeButton: true });
    }
  };

  const declineAndBlock = async (invitation: Invitation) => {
    try {
      await api(`/invitations/${invitation.id}/decline`, {
        method: "POST",
        body: JSON.stringify({ blockInviter: true }),
      });
      toast.success("已拒绝并屏蔽对方邀请", { duration: 2600, closeButton: true });
      setDeclining(undefined);
      await reloadAll();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "操作失败", { duration: 3000, closeButton: true });
    }
  };

  const handleSentInvitation = async (invitation: Invitation, endpoint: "remind" | "revoke") => {
    try {
      await api(`/invitations/${invitation.id}/${endpoint}`, { method: "POST" });
      toast.success(endpoint === "remind" ? "提醒已发送" : "邀请已撤回", {
        duration: 2600,
        closeButton: true,
      });
      await reloadInvitations();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "操作失败", { duration: 3000, closeButton: true });
    }
  };

  const deleteInvitation = async () => {
    if (!deletingInvitation) return;
    try {
      await api(`/invitations/${deletingInvitation.id}`, { method: "DELETE" });
      toast.success("邀请记录已删除", { duration: 2400, closeButton: true });
      setDeletingInvitation(undefined);
      await reloadInvitations();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "删除失败", { duration: 3000, closeButton: true });
    }
  };

  const unblock = async (target: UserSummary) => {
    try {
      await api(`/users/${target.id}/invite-blocks`, { method: "DELETE" });
      toast.success("已解除屏蔽", { duration: 2400, closeButton: true });
      await reloadBlocks();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "操作失败", { duration: 3000, closeButton: true });
    }
  };

  return (
    <IosPage className="ios-members-page ios-invitation-records-page">
      <IosTopBar title="邀请记录" back onBack={() => navigate(queryPath("/members", book?.id))} />
      <IosScroll className="ios-members-scroll ios-main-tab-scroll">
        <IosSegment
          className="ios-members-tabs"
          value={tab}
          onChange={changeTab}
          options={[
            { value: "received", label: "收到" },
            { value: "sent", label: "已发" },
            { value: "history", label: "历史" },
            { value: "blocked", label: "屏蔽" },
          ]}
        />

        {tab === "received" && (
          <InvitationSection
            title="收到的邀请"
            emptyTitle="暂无收到的邀请"
            emptyCaption="别人邀请你加入账本时会显示在这里。"
            invitations={received}
            onAccept={(invitation) => void handleReceivedInvitation(invitation, "accept")}
            onDecline={setDeclining}
            onDelete={setDeletingInvitation}
          />
        )}
        {tab === "sent" && (
          <InvitationSection
            title="已发邀请"
            emptyTitle="暂无已发邀请"
            emptyCaption="邀请发送后，会在这里看到处理状态。"
            invitations={sent}
            sent
            onRemind={(invitation) => void handleSentInvitation(invitation, "remind")}
            onRevoke={(invitation) => void handleSentInvitation(invitation, "revoke")}
            onDelete={setDeletingInvitation}
          />
        )}
        {tab === "history" && (
          <InvitationSection
            title="历史记录"
            emptyTitle="暂无历史记录"
            emptyCaption="已接受、已拒绝、已撤回或过期的邀请会显示在这里。"
            invitations={history}
            compact
            onDelete={setDeletingInvitation}
          />
        )}
        {tab === "blocked" && (
          <section>
            <h3 className="ios-member-section-title">屏蔽名单</h3>
            <IosCard className="ios-member-list">
              {blocks.map((block) => (
                <UserRow
                  user={block.user}
                  caption="对方无法搜索到你或邀请你"
                  action={
                    <button type="button" onClick={() => void unblock(block.user)}>
                      解除
                    </button>
                  }
                  key={block.id}
                />
              ))}
              {!blocks.length && (
                <div className="ios-member-empty-note">
                  <b>没有屏蔽任何人</b>
                  <small>拒绝邀请时可以选择屏蔽对方。</small>
                </div>
              )}
            </IosCard>
          </section>
        )}
      </IosScroll>
      {declining && (
        <DeclineInviteDialog
          invitation={declining}
          onCancel={() => setDeclining(undefined)}
          onDecline={() => {
            void handleReceivedInvitation(declining, "decline").then(() => setDeclining(undefined));
          }}
          onDeclineAndBlock={() => void declineAndBlock(declining)}
        />
      )}
      {deletingInvitation && (
        <IosDialog
          danger
          title="删除邀请记录"
          message={
            deletingInvitation.status === "pending"
              ? "进行中的邀请不能删除，请先撤回或等待对方处理。"
              : "删除后这条邀请历史不会再显示。"
          }
          confirmText="删除"
          onCancel={() => setDeletingInvitation(undefined)}
          onConfirm={() => void deleteInvitation()}
        />
      )}
    </IosPage>
  );
}

export function MemberRolePage() {
  return <Navigate to="/members" replace />;
}

function BookMemberSummary({
  bookName,
  currency,
  memberCount,
}: {
  bookName?: string;
  currency?: string;
  memberCount?: number;
}) {
  return (
    <IosCard className="ios-members-overview">
      <span className="ios-members-book-icon" aria-hidden="true">
        <BookOpenIcon size={22} weight="bold" />
      </span>
      <span>
        <b>{bookName ?? "当前账本"}</b>
        {typeof memberCount === "number" ? (
          <small>
            {memberCount} 位成员 · {currency ?? "CNY"}
          </small>
        ) : null}
      </span>
    </IosCard>
  );
}

function ActionLink({ to, title, caption }: { to: string; title: string; caption: string }) {
  return (
    <Link className="ios-member-action-row" to={to}>
      <span>
        <b>{title}</b>
        <small>{caption}</small>
      </span>
      <CaretRightIcon size={18} weight="bold" />
    </Link>
  );
}

function InvitationSection({
  title,
  emptyTitle,
  emptyCaption,
  invitations,
  sent,
  compact,
  onAccept,
  onDecline,
  onRemind,
  onRevoke,
  onDelete,
}: {
  title: string;
  emptyTitle: string;
  emptyCaption: string;
  invitations: Invitation[];
  sent?: boolean;
  compact?: boolean;
  onAccept?: (invitation: Invitation) => void;
  onDecline?: (invitation: Invitation) => void;
  onRemind?: (invitation: Invitation) => void;
  onRevoke?: (invitation: Invitation) => void;
  onDelete: (invitation: Invitation) => void;
}) {
  return (
    <section>
      <h3 className="ios-member-section-title">{title}</h3>
      <IosCard className="ios-invitation-list">
        {invitations.map((invitation) => (
          <div className={`ios-invitation-row${compact ? " compact" : ""}`} key={invitation.id}>
            <span
              className={`ios-invitation-status-dot ${statusTone(invitation.status)}`}
              aria-hidden="true"
            />
            <span>
              <b>{sent ? inviteeDisplay(invitation) : inviterDisplay(invitation)}</b>
              <small>
                {invitation.book?.name ?? "账本邀请"} · {roleLabel(invitation.role)} ·{" "}
                {statusLabel(invitation.status)}
              </small>
            </span>
            {invitation.status === "pending" && !sent ? (
              <div className="ios-inline-actions">
                <button type="button" onClick={() => onAccept?.(invitation)}>
                  接受
                </button>
                <button className="danger" type="button" onClick={() => onDecline?.(invitation)}>
                  拒绝
                </button>
              </div>
            ) : invitation.status === "pending" && sent ? (
              <div className="ios-inline-actions">
                <button type="button" onClick={() => onRemind?.(invitation)}>
                  提醒
                </button>
                <button className="danger" type="button" onClick={() => onRevoke?.(invitation)}>
                  撤回
                </button>
              </div>
            ) : (
              <button
                className="ios-member-remove"
                type="button"
                aria-label="删除邀请记录"
                onClick={() => onDelete(invitation)}
              >
                <TrashIcon size={18} />
              </button>
            )}
          </div>
        ))}
        {!invitations.length && (
          <div className="ios-member-empty-note">
            <b>{emptyTitle}</b>
            {emptyCaption ? <small>{emptyCaption}</small> : null}
          </div>
        )}
      </IosCard>
    </section>
  );
}

function MemberRow({
  member,
  isMe,
  canRemove,
  onRemove,
}: {
  member: Member;
  isMe: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="ios-member-row">
      <span className="ios-member-avatar">{initials(member.name)}</span>
      <span>
        <b>
          {member.name}
          {isMe ? "（我）" : ""}
        </b>
        <small>{roleLabel(member.role)}</small>
      </span>
      {canRemove && (
        <button className="ios-member-remove" type="button" aria-label="移除成员" onClick={onRemove}>
          <XIcon size={18} />
        </button>
      )}
    </div>
  );
}

function UserRow({ user, caption, action }: { user: UserSummary; caption: string; action: ReactNode }) {
  return (
    <div className="ios-member-row">
      <UserIdentity user={user} caption={caption} />
      {action}
    </div>
  );
}

function UserIdentity({ user, caption }: { user: UserSummary; caption?: string }) {
  return (
    <>
      <span className="ios-member-avatar">
        {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user.name)}
      </span>
      <span>
        <b>{user.name || "已注册用户"}</b>
        <small>{caption ?? user.email ?? "已注册用户"}</small>
      </span>
    </>
  );
}

function DeclineInviteDialog({
  invitation,
  onCancel,
  onDecline,
  onDeclineAndBlock,
}: {
  invitation: Invitation;
  onCancel: () => void;
  onDecline: () => void;
  onDeclineAndBlock: () => void;
}) {
  return (
    <div className="ios-dialog-layer">
      <button className="ios-dialog-backdrop" type="button" aria-label="取消" onClick={onCancel} />
      <dialog
        open
        className="ios-dialog ios-invite-decline-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label="拒绝邀请"
      >
        <span className="ios-dialog-danger">!</span>
        <h2>拒绝邀请</h2>
        <p>
          拒绝来自「{inviterDisplay(invitation)}」的「{invitation.book?.name ?? "账本"}」邀请？
        </p>
        <div>
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="button" onClick={onDecline}>
            仅拒绝
          </button>
          <button className="danger" type="button" onClick={onDeclineAndBlock}>
            拒绝并屏蔽
          </button>
        </div>
      </dialog>
    </div>
  );
}

function queryPath(path: string, bookId?: string, params: Record<string, string | undefined> = {}) {
  const query = new URLSearchParams();
  if (bookId) query.set("bookId", bookId);
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const serialized = query.toString();
  return serialized ? `${path}?${serialized}` : path;
}

function parseInvitationTab(value: string | null): InvitationTab {
  if (value === "sent" || value === "history" || value === "blocked") return value;
  return "received";
}

function statusLabel(status: string) {
  if (status === "pending") return "待处理";
  if (status === "accepted") return "已接受";
  if (status === "declined") return "已拒绝";
  if (status === "revoked") return "已撤回";
  if (status === "expired") return "已过期";
  return status;
}

function statusTone(status: string) {
  if (status === "accepted") return "success";
  if (status === "declined" || status === "revoked") return "danger";
  if (status === "expired") return "muted";
  return "pending";
}

function roleLabel(role: Role | "admin" | "member") {
  if (role === "creator") return "创建者";
  if (role === "admin") return "管理员";
  return "成员";
}

function inviteeDisplay(invitation: Invitation) {
  return invitation.invitee?.name || invitation.invitee?.email || invitation.inviteeEmail || "已注册用户";
}

function inviterDisplay(invitation: Invitation) {
  return invitation.inviter?.name || invitation.inviter?.email || "邀请人";
}

function initials(name?: string) {
  const value = (name ?? "用户").trim();
  return value.slice(0, 2).toUpperCase();
}
