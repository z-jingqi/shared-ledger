import {
  CaretRightIcon,
  EnvelopeSimpleIcon,
  PhoneIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  UserPlusIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams, type Location } from "react-router-dom";
import { toast } from "sonner";
import {
  IconTile,
  IosButton,
  IosCard,
  IosDialog,
  IosField,
  IosPage,
  IosSegment,
  IosSheet,
} from "../components/ios/IosDesign";
import { useAuth } from "../features/auth/AuthProvider";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api } from "../lib";

type Member = { id: string; userId?: string; name: string; role: "creator" | "admin" | "member" };
type SentInvitation = {
  id: string;
  inviteeEmail?: string;
  inviteePhone?: string;
  role: "admin" | "member";
  status: string;
};

export function MembersPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { book } = useActiveBook();
  const { data, reload } = useApi<{ members: Member[] }>(book ? `/books/${book.id}/members` : undefined);
  const { data: sentInvitations } = useApi<{ invitations: SentInvitation[] }>(book ? `/books/${book.id}/invitations` : undefined);
  const [removing, setRemoving] = useState<Member | "me" | undefined>();
  const pendingInvitations = sentInvitations?.invitations.filter((item) => item.status === "pending") ?? [];
  const myMember = data?.members.find((member) => member.userId === user?.id);
  const modalState = modalLinkState(location);
  const close = () => closeSheet(navigate, location, book ? `/settings?bookId=${book.id}` : "/settings");
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

  return (
    <IosPage>
      <IosSheet
        title="成员与邀请"
        onClose={close}
        right={
          <Link className="ios-sheet-text-action" to={`/members/invite?bookId=${book?.id ?? ""}`} state={modalState}>
            + 邀请
          </Link>
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
          </IosCard>
          <section>
            <h3>成员 · {data?.members.length ?? 0}</h3>
            <IosCard className="ios-member-list">
              {data?.members.map((member) => (
                <MemberRow
                  member={member}
                  isMe={member.userId === user?.id}
                  canRemove={member.role !== "creator" && myMember?.role !== "member"}
                  bookId={book?.id}
                  state={modalState}
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
              {pendingInvitations.map((invitation) => (
                <div className="ios-member-row" key={invitation.id}>
                  <IconTile tint="#f0f2f5" color="#5b6473">
                    {invitation.inviteeEmail ? <EnvelopeSimpleIcon size={18} weight="bold" /> : <PhoneIcon size={18} weight="bold" />}
                  </IconTile>
                  <span>
                    <b>{invitation.inviteeEmail || invitation.inviteePhone || "邀请链接"}</b>
                    <small>将加入为 {roleLabel(invitation.role)} · 待接受</small>
                  </span>
                  <Link to="/invitations/sent">管理</Link>
                </div>
              ))}
              {!pendingInvitations.length && <p className="muted">暂无待接受邀请</p>}
            </IosCard>
          </section>
          <div className="ios-member-links">
            <Link to="/invitations/received">我的邀请 <CaretRightIcon size={17} /></Link>
            <Link to="/invitations/sent">已发邀请 <CaretRightIcon size={17} /></Link>
          </div>
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
    </IosPage>
  );
}

export function InviteMemberPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { book } = useActiveBook();
  const modalState = modalLinkState(location);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [message, setMessage] = useState("");
  const send = async () => {
    if (!book) return;
    setMessage("");
    try {
      await api(`/books/${book.id}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email: method === "email" ? email || undefined : undefined, phone: method === "phone" ? phone || undefined : undefined, role }),
      });
      toast.success("邀请已发送", { duration: 2600, closeButton: true });
      navigate(`/members?bookId=${book.id}`, { state: modalState });
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "邀请失败");
    }
  };
  return (
    <IosPage>
      <IosSheet title="邀请成员" onClose={() => navigate(`/members${book ? `?bookId=${book.id}` : ""}`, { state: modalState })} back>
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
          <IosField label="邀请方式">
            <IosSegment
              value={method}
              onChange={setMethod}
              options={[
                { value: "email", label: "邮箱" },
                { value: "phone", label: "手机号" },
              ]}
            />
          </IosField>
          <IosField label={method === "email" ? "邮箱" : "手机号"}>
            <input
              value={method === "email" ? email : phone}
              placeholder={method === "email" ? "输入对方邮箱" : "输入对方手机号"}
              onChange={(event) => (method === "email" ? setEmail(event.currentTarget.value) : setPhone(event.currentTarget.value))}
            />
          </IosField>
          <IosField label="分配角色">
            <div className="ios-role-cards">
              {(["member", "admin"] as const).map((value) => (
                <button className={role === value ? "active" : ""} type="button" onClick={() => setRole(value)} key={value}>
                  <ShieldCheckIcon size={19} />
                  <b>{roleLabel(value)}</b>
                  <small>{value === "admin" ? "可邀请成员、管理权限" : "可查看账本并记录"}</small>
                </button>
              ))}
            </div>
          </IosField>
          {message && <p className="field-error">{message}</p>}
          <IosButton onClick={() => void send()}>发送邀请</IosButton>
        </div>
      </IosSheet>
    </IosPage>
  );
}

export function MemberRolePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [search] = useSearchParams();
  const bookId = search.get("bookId");
  const memberId = search.get("memberId");
  const { data } = useApi<{ members: Member[] }>(bookId ? `/books/${bookId}/members` : undefined);
  const member = useMemo(() => data?.members.find((item) => item.id === memberId), [data?.members, memberId]);
  const modalState = modalLinkState(location);
  const [role, setRole] = useState<"admin" | "member">("member");
  const [error, setError] = useState("");

  useEffect(() => {
    if (member?.role === "admin" || member?.role === "member") setRole(member.role);
  }, [member?.role]);

  const save = async () => {
    if (!bookId || !memberId) return;
    setError("");
    try {
      await api(`/books/${bookId}/members/${memberId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      toast.success("成员权限已更新", { duration: 2600, closeButton: true });
      navigate(`/members?bookId=${bookId}`, { state: modalState });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    }
  };
  return (
    <IosPage>
      <IosSheet
        title="成员权限"
        onClose={() => navigate(`/members${bookId ? `?bookId=${bookId}` : ""}`, { state: modalState })}
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
              <button className={role === value ? "active" : ""} type="button" onClick={() => setRole(value)} key={value}>
                <ShieldCheckIcon size={20} />
                <b>{roleLabel(value)}</b>
                <small>{value === "admin" ? "可邀请成员、管理成员" : "可查看账本并记录"}</small>
              </button>
            ))}
          </div>
          {error && <p className="field-error">{error}</p>}
        </div>
      </IosSheet>
    </IosPage>
  );
}

function MemberRow({
  member,
  isMe,
  canRemove,
  bookId,
  state,
  onRemove,
}: {
  member: Member;
  isMe: boolean;
  canRemove: boolean;
  bookId?: string;
  state?: { backgroundLocation: Location };
  onRemove: () => void;
}) {
  return (
    <div className="ios-member-row">
      <span className="ios-member-avatar">{member.name.slice(0, 1)}</span>
      <span>
        <b>{member.name}{isMe ? "（我）" : ""}</b>
        <small>{roleLabel(member.role)}</small>
      </span>
      {member.role !== "creator" && (
        <Link className="ios-role-pill" to={`/members/role?memberId=${member.id}${bookId ? `&bookId=${bookId}` : ""}`} state={state}>
          {roleLabel(member.role)}
        </Link>
      )}
      {canRemove && (
        <button className="ios-member-remove" type="button" aria-label="移除成员" onClick={onRemove}>
          <XIcon size={18} />
        </button>
      )}
    </div>
  );
}

function modalLinkState(location: Location) {
  const state = location.state as { backgroundLocation?: Location } | null;
  return { backgroundLocation: state?.backgroundLocation ?? location };
}

function closeSheet(navigate: ReturnType<typeof useNavigate>, location: Location, fallback: string) {
  const state = location.state as { backgroundLocation?: Location } | null;
  if (state?.backgroundLocation) navigate(-1);
  else navigate(fallback);
}

function roleLabel(role: Member["role"] | "admin" | "member") {
  if (role === "creator") return "创建者";
  if (role === "admin") return "管理员";
  return "成员";
}
