import {
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  ClockCounterClockwiseIcon,
  ProhibitIcon,
  PhoneIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  UserPlusIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { IconTile, IosButton, IosCard, IosDialog, IosField, IosSheet } from "../components/ios/IosDesign";
import { useAuth } from "../features/auth/AuthProvider";
import { useInvitationBadge } from "../features/invitations/useInvitationBadge";
import { markInvitationIdsViewed } from "../features/invitations/viewed";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api } from "../lib";

type Member = { id: string; userId?: string; name: string; role: "creator" | "admin" | "member" };
type SentInvitation = {
  id: string;
  inviteeEmail?: string;
  inviteePhone?: string;
  inviteeUserId?: string;
  role: "admin" | "member";
  status: string;
};
type MemberSheetView =
  | { type: "list" }
  | { type: "invite" }
  | { type: "role"; memberId: string }
  | { type: "sent" };

export function MembersPage() {
  return <Navigate to="/settings" replace />;
}

export function MembersSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { book } = useActiveBook();
  const { data, reload } = useApi<{ members: Member[] }>(book ? `/books/${book.id}/members` : undefined);
  const { data: sentInvitations, reload: reloadSentInvitations } = useApi<{ invitations: SentInvitation[] }>(
    book ? `/books/${book.id}/invitations` : undefined,
  );
  const {
    pendingInvitations: receivedInvitations,
    reload: reloadReceivedInvitations,
    unreadCount,
  } = useInvitationBadge(user?.id);
  const [removing, setRemoving] = useState<Member | "me" | undefined>();
  const [view, setView] = useState<MemberSheetView>({ type: "list" });
  const pendingSentInvitations =
    sentInvitations?.invitations.filter((item) => item.status === "pending") ?? [];
  const myMember = data?.members.find((member) => member.userId === user?.id);
  const receivedInvitationIds = useMemo(
    () => receivedInvitations.map((item) => item.id),
    [receivedInvitations],
  );
  const receivedInvitationKey = receivedInvitationIds.join(",");
  const close = onClose;

  useEffect(() => {
    if (user?.id && receivedInvitationIds.length) markInvitationIdsViewed(user.id, receivedInvitationIds);
  }, [receivedInvitationIds, receivedInvitationKey, user?.id]);

  const handleReceivedInvitation = async (id: string, action: "accept" | "decline") => {
    try {
      await api(`/invitations/${id}/${action}`, { method: "POST" });
      toast.success(action === "accept" ? "已加入账本" : "已拒绝邀请", { duration: 2600, closeButton: true });
      await Promise.all([reload(), reloadReceivedInvitations()]);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "操作失败", { duration: 3000, closeButton: true });
    }
  };

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
        await reload();
      }
      setRemoving(undefined);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "操作失败", { duration: 3000, closeButton: true });
    }
  };
  const handleSentInvitation = async (id: string, endpoint: "remind" | "revoke") => {
    try {
      await api(`/invitations/${id}/${endpoint}`, { method: "POST" });
      toast.success(endpoint === "remind" ? "提醒已发送" : "邀请已撤回", {
        duration: 2600,
        closeButton: true,
      });
      await reloadSentInvitations();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "操作失败", { duration: 3000, closeButton: true });
    }
  };

  if (view.type === "invite") {
    return (
      <InviteMemberSheet
        onClose={close}
        onBack={() => setView({ type: "list" })}
        onSent={() => {
          void reloadSentInvitations();
          setView({ type: "list" });
        }}
      />
    );
  }
  if (view.type === "role") {
    return (
      <MemberRoleSheet
        memberId={view.memberId}
        onClose={close}
        onBack={() => setView({ type: "list" })}
        onSaved={() => {
          void reload();
          setView({ type: "list" });
        }}
      />
    );
  }
  if (view.type === "sent") {
    return (
      <SentInvitationsSheet
        invitations={sentInvitations?.invitations ?? []}
        onBack={() => setView({ type: "list" })}
        onClose={close}
        onAction={handleSentInvitation}
      />
    );
  }

  return (
    <>
      <IosSheet
        title="成员与邀请"
        onClose={close}
        right={
          <button className="ios-sheet-text-action" type="button" onClick={() => setView({ type: "sent" })}>
            已发邀请
          </button>
        }
        footer={
          <button
            className="ios-button primary ios-member-invite-footer"
            type="button"
            onClick={() => setView({ type: "invite" })}
          >
            邀请成员
          </button>
        }
      >
        <div className="ios-members-sheet">
          <IosCard className="ios-member-summary">
            <IconTile tint="#eaf1ff" color="#4c8dff">
              <UsersThreeIcon size={24} weight="fill" />
            </IconTile>
            <span>
              <b>{data?.members.length ?? 0} 位成员</b>
              <small>{book?.name ?? "当前账本"} · 共同维护</small>
            </span>
            {unreadCount > 0 ? <em className="ios-row-badge">{unreadCount}</em> : null}
          </IosCard>
          {receivedInvitations.length > 0 && (
            <section>
              <h3>收到的邀请</h3>
              <IosCard className="ios-member-list">
                {receivedInvitations.map((invitation) => (
                  <div className="ios-member-row ios-received-invite-row" key={invitation.id}>
                    <IconTile tint="#fff0e8" color="#ff681c">
                      <EnvelopeSimpleIcon size={18} weight="bold" />
                    </IconTile>
                    <span>
                      <b>账本邀请</b>
                      <small>将加入为 {roleLabel(invitation.role)} · 等待处理</small>
                    </span>
                    <div className="ios-inline-actions">
                      <button
                        type="button"
                        onClick={() => void handleReceivedInvitation(invitation.id, "accept")}
                      >
                        接受
                      </button>
                      <button
                        className="danger"
                        type="button"
                        onClick={() => void handleReceivedInvitation(invitation.id, "decline")}
                      >
                        拒绝
                      </button>
                    </div>
                  </div>
                ))}
              </IosCard>
            </section>
          )}
          <section>
            <h3>成员 · {data?.members.length ?? 0}</h3>
            <IosCard className="ios-member-list">
              {data?.members.map((member) => (
                <MemberRow
                  member={member}
                  isMe={member.userId === user?.id}
                  canRemove={member.role !== "creator" && myMember?.role !== "member"}
                  onRole={() => setView({ type: "role", memberId: member.id })}
                  onRemove={() => setRemoving(member)}
                  key={member.id}
                />
              ))}
              {!data?.members.length && <p className="muted">暂无成员</p>}
            </IosCard>
          </section>
          <section>
            <h3>邀请记录</h3>
            <IosCard className="ios-member-list">
              {pendingSentInvitations.map((invitation) => (
                <div className="ios-member-row" key={invitation.id}>
                  <IconTile tint="#f0f2f5" color="#5b6473">
                    {invitation.inviteePhone ? (
                      <PhoneIcon size={18} weight="bold" />
                    ) : (
                      <EnvelopeSimpleIcon size={18} weight="bold" />
                    )}
                  </IconTile>
                  <span>
                    <b>
                      {invitation.inviteeEmail ||
                        invitation.inviteePhone ||
                        invitation.inviteeUserId ||
                        "指定用户"}
                    </b>
                    <small>将加入为 {roleLabel(invitation.role)} · 待接受</small>
                  </span>
                  <button type="button" onClick={() => setView({ type: "sent" })}>
                    管理
                  </button>
                </div>
              ))}
              {!pendingSentInvitations.length && (
                <div className="ios-member-empty-note">
                  <b>暂无待接受邀请</b>
                  <small>发送给邮箱、手机号、用户名或用户 ID 后，会在这里看到记录。</small>
                </div>
              )}
            </IosCard>
          </section>
          {myMember?.role !== "creator" && (
            <IosButton variant="outline" className="danger-text" onClick={() => setRemoving("me")}>
              退出该账本
            </IosButton>
          )}
        </div>
      </IosSheet>
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
    </>
  );
}

export function InviteMemberPage() {
  return <Navigate to="/settings" replace />;
}

function InviteMemberSheet({
  onClose,
  onBack,
  onSent,
}: {
  onClose: () => void;
  onBack: () => void;
  onSent: () => void;
}) {
  const { book } = useActiveBook();
  const [target, setTarget] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [message, setMessage] = useState("");
  const send = async () => {
    if (!book) return;
    const normalizedTarget = target.trim();
    setMessage("");
    if (!normalizedTarget) {
      setMessage("请输入对方的邮箱、手机号、用户名或用户 ID。");
      return;
    }
    if (looksLikeEmail(normalizedTarget) && !isValidEmail(normalizedTarget)) {
      setMessage("邮箱格式不正确，请检查 @ 和域名。");
      return;
    }
    if (looksLikePhone(normalizedTarget) && !isValidPhone(normalizedTarget)) {
      setMessage("手机号格式不正确，请输入至少 6 位数字，可包含 + 号。");
      return;
    }
    try {
      await api(`/books/${book.id}/invitations`, {
        method: "POST",
        body: JSON.stringify({ target: normalizedTarget, role }),
      });
      toast.success("邀请已发送", { duration: 2600, closeButton: true });
      onSent();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "邀请失败");
    }
  };
  return (
    <IosSheet title="邀请成员" onClose={onClose} onBack={onBack} back>
      <div className="ios-invite-sheet">
        <IosCard className="ios-invite-intro">
          <IconTile>
            <UserPlusIcon size={24} weight="fill" />
          </IconTile>
          <span>
            <b>邀请成员一起记账</b>
            <small>对方接受后即可查看并记录该账本。邀请有效期 7 天。</small>
          </span>
        </IosCard>
        <IosField label="邀请对象" error={message}>
          <input
            value={target}
            aria-label="邀请对象"
            placeholder="邮箱 / 手机号 / 用户名 / 用户 ID"
            onChange={(event) => {
              setTarget(event.currentTarget.value);
              if (message) setMessage("");
            }}
          />
        </IosField>
        <IosField label="分配角色">
          <div className="ios-role-cards">
            {(["member", "admin"] as const).map((value) => (
              <button
                className={role === value ? "active" : ""}
                type="button"
                onClick={() => setRole(value)}
                key={value}
              >
                <ShieldCheckIcon size={19} />
                <b>{roleLabel(value)}</b>
                <small>{value === "admin" ? "可邀请成员、管理权限" : "可查看账本并记录"}</small>
              </button>
            ))}
          </div>
        </IosField>
        <IosButton onClick={() => void send()}>发送邀请</IosButton>
      </div>
    </IosSheet>
  );
}

export function MemberRolePage() {
  return <Navigate to="/settings" replace />;
}

function MemberRoleSheet({
  memberId,
  onClose,
  onBack,
  onSaved,
}: {
  memberId: string;
  onClose: () => void;
  onBack: () => void;
  onSaved: () => void;
}) {
  const { book } = useActiveBook();
  const bookId = book?.id;
  const { data } = useApi<{ members: Member[] }>(bookId ? `/books/${bookId}/members` : undefined);
  const member = useMemo(() => data?.members.find((item) => item.id === memberId), [data?.members, memberId]);
  const memberRole = member?.role === "admin" ? "admin" : "member";
  const [roleOverride, setRoleOverride] = useState<
    { memberId: string; role: "admin" | "member" } | undefined
  >();
  const role = roleOverride?.memberId === memberId ? roleOverride.role : memberRole;
  const [error, setError] = useState("");

  const save = async () => {
    if (!bookId || !memberId) return;
    setError("");
    try {
      await api(`/books/${bookId}/members/${memberId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      toast.success("成员权限已更新", { duration: 2600, closeButton: true });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    }
  };
  return (
    <IosSheet
      title="成员权限"
      onClose={onClose}
      onBack={onBack}
      back
      footer={<IosButton onClick={() => void save()}>保存权限</IosButton>}
    >
      <div className="ios-member-role-sheet">
        <IosCard className="ios-role-intro">
          <IconTile tint="#eaf1ff" color="#4c8dff">
            <UserCircleIcon size={24} weight="fill" />
          </IconTile>
          <span>
            <b>{member?.name ?? "编辑成员角色"}</b>
            <small>管理员可邀请成员、调整权限；成员可查看账本并新增自己的记录。</small>
          </span>
        </IosCard>
        <div className="ios-role-cards">
          {(["member", "admin"] as const).map((value) => (
            <button
              className={role === value ? "active" : ""}
              type="button"
              onClick={() => setRoleOverride({ memberId, role: value })}
              key={value}
            >
              <ShieldCheckIcon size={20} />
              <b>{roleLabel(value)}</b>
              <small>{value === "admin" ? "可邀请成员、管理成员" : "可查看账本并记录"}</small>
            </button>
          ))}
        </div>
        {error && <p className="field-error">{error}</p>}
      </div>
    </IosSheet>
  );
}

function MemberRow({
  member,
  isMe,
  canRemove,
  onRole,
  onRemove,
}: {
  member: Member;
  isMe: boolean;
  canRemove: boolean;
  onRole: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="ios-member-row">
      <span className="ios-member-avatar">{member.name.slice(0, 1)}</span>
      <span>
        <b>
          {member.name}
          {isMe ? "（我）" : ""}
        </b>
        <small>{roleLabel(member.role)}</small>
      </span>
      {member.role !== "creator" && (
        <button className="ios-role-pill" type="button" onClick={onRole}>
          {roleLabel(member.role)}
        </button>
      )}
      {canRemove && (
        <button className="ios-member-remove" type="button" aria-label="移除成员" onClick={onRemove}>
          <XIcon size={18} />
        </button>
      )}
    </div>
  );
}

function SentInvitationsSheet({
  invitations,
  onBack,
  onClose,
  onAction,
}: {
  invitations: SentInvitation[];
  onBack: () => void;
  onClose: () => void;
  onAction: (id: string, endpoint: "remind" | "revoke") => void;
}) {
  return (
    <IosSheet title="已发邀请" onClose={onClose} onBack={onBack} back>
      <IosCard className="ios-invitation-list">
        {invitations.map((invitation) => (
          <div className="ios-invitation-row" key={invitation.id}>
            <IconTile tint="#eaf1ff" color="#4c8dff">
              <ClockCounterClockwiseIcon size={20} weight="fill" />
            </IconTile>
            <span>
              <b>
                {invitation.inviteeEmail || invitation.inviteePhone || invitation.inviteeUserId || "指定用户"}
              </b>
              <small>
                {roleLabel(invitation.role)} · {statusLabel(invitation.status)}
              </small>
            </span>
            {invitation.status === "pending" ? (
              <div className="ios-inline-actions">
                <button type="button" onClick={() => onAction(invitation.id, "remind")}>
                  提醒
                </button>
                <button className="danger" type="button" onClick={() => onAction(invitation.id, "revoke")}>
                  撤回
                </button>
              </div>
            ) : (
              <em>{statusIcon(invitation.status)}</em>
            )}
          </div>
        ))}
        {!invitations.length && (
          <div className="ios-member-empty-note">
            <b>还没有已发邀请</b>
            <small>从成员与邀请底部发送邀请后，这里会显示状态和撤回操作。</small>
          </div>
        )}
      </IosCard>
    </IosSheet>
  );
}

function looksLikeEmail(value: string) {
  return value.includes("@");
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function looksLikePhone(value: string) {
  return /^[+\d][\d\s-]*$/.test(value);
}

function isValidPhone(value: string) {
  return /^\+?\d[\d\s-]{4,}\d$/.test(value);
}

function statusIcon(status: string) {
  if (status === "accepted") return <CheckCircleIcon size={19} weight="fill" />;
  if (status === "declined" || status === "revoked") return <ProhibitIcon size={19} weight="fill" />;
  return statusLabel(status);
}

function statusLabel(status: string) {
  if (status === "pending") return "待处理";
  if (status === "accepted") return "已接受";
  if (status === "declined") return "已拒绝";
  if (status === "revoked") return "已撤回";
  return status;
}

function roleLabel(role: Member["role"] | "admin" | "member") {
  if (role === "creator") return "创建者";
  if (role === "admin") return "管理员";
  return "成员";
}
