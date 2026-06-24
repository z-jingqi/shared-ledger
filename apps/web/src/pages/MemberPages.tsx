import {
  CaretRightIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  LinkIcon,
  PhoneIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  UserPlusIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import {
  Button,
  Input,
  Panel,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared-ledger/ui";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Page } from "../components/layout/Page";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api } from "../lib";

type Member = { id: string; name: string; role: "creator" | "admin" | "member" };
type SentInvitation = {
  id: string;
  inviteeEmail?: string;
  inviteePhone?: string;
  role: "admin" | "member";
  status: string;
};
export function MembersPage() {
  const { book } = useActiveBook();
  const { data } = useApi<{ members: Member[] }>(book ? `/books/${book.id}/members` : undefined);
  const { data: sentInvitations } = useApi<{ invitations: SentInvitation[] }>(
    book ? `/books/${book.id}/invitations` : undefined,
  );
  const pendingInvitations = sentInvitations?.invitations.filter((item) => item.status === "pending") ?? [];
  return (
    <>
      <Page
        title="成员管理"
        action={
          <Link className="icon-link icon-link-primary" to={`/members/invite?bookId=${book?.id ?? ""}`} aria-label="邀请成员">
            <UserPlusIcon size={26} />
          </Link>
        }
      />
      <Panel className="member-summary">
        <UsersThreeIcon size={31} weight="fill" />
        <span>
          <b>{data?.members.length ?? 0} 位成员</b>
          <small>共同维护当前账本</small>
        </span>
      </Panel>
      <h2 className="section-kicker">当前成员</h2>
      <Panel className="member-list">
        {data?.members.map((member) => (
          <Link
            to={`/members/role?bookId=${book?.id ?? ""}&memberId=${member.id}`}
            className="member-row"
            key={member.id}
          >
            <span>{member.name.slice(0, 1)}</span>
            <div>
              <strong>{member.name}</strong>
              <small>{roleLabel(member.role)}</small>
            </div>
            <CaretRightIcon />
          </Link>
        ))}
        {!data?.members.length && <p className="muted">暂无成员</p>}
      </Panel>
      <h2 className="section-kicker">邀请中的成员</h2>
      <Panel className="member-list">
        {pendingInvitations.map((invitation) => (
          <div className="member-row pending-member-row" key={invitation.id}>
            <span>
              {invitation.inviteeEmail ? (
                <EnvelopeSimpleIcon size={20} weight="bold" />
              ) : (
                <PhoneIcon size={20} weight="bold" />
              )}
            </span>
            <div>
              <strong>{invitation.inviteeEmail || invitation.inviteePhone || "邀请链接"}</strong>
              <small>将加入为 {roleLabel(invitation.role)} · 待接受</small>
            </div>
            <Link className="text-action" to="/invitations/sent">
              管理
            </Link>
          </div>
        ))}
        {!pendingInvitations.length && <p className="muted">暂无待接受邀请</p>}
      </Panel>
      <Link className="sub-action" to="/invitations/received">
        我的邀请 <CaretRightIcon />
      </Link>
      <Link className="sub-action" to="/invitations/sent">
        已发邀请 <CaretRightIcon />
      </Link>
      <Link className="primary-wide" to={`/members/invite?bookId=${book?.id ?? ""}`}>
        <UserPlusIcon size={24} weight="bold" />
        邀请成员
      </Link>
    </>
  );
}
export function InviteMemberPage() {
  const { book } = useActiveBook();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"email" | "phone" | "link">("email");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [message, setMessage] = useState("");
  const send = async () => {
    if (!book) return;
    try {
      await api(`/books/${book.id}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email: email || undefined, phone: phone || undefined, role }),
      });
      setMessage("邀请已发送，对方接受后将加入账本。");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "邀请失败");
    }
  };
  return (
    <>
      <Page title="邀请成员" />
      <Panel className="invite-intro">
        <UserPlusIcon size={34} weight="fill" />
        <b>邀请成员一起记账</b>
        <small>支持邮箱、手机号或复制邀请链接，成员接受后即可加入。</small>
      </Panel>
      <div className="invite-tabs">
        {(["email", "phone", "link"] as const).map((value) => (
          <Button
            className={method === value ? "selected" : ""}
            type="button"
            variant="ghost"
            onClick={() => setMethod(value)}
            key={value}
          >
            {value === "email" ? "邮箱" : value === "phone" ? "手机号" : "链接"}
          </Button>
        ))}
      </div>
      <div className="form invite-form">
        {method !== "link" && (
          <label>
            {method === "email" ? <EnvelopeSimpleIcon size={20} /> : <PhoneIcon size={20} />}
            {method === "email" ? "邮箱" : "手机号"}
            <Input
              value={method === "email" ? email : phone}
              onChange={(event) =>
                method === "email" ? setEmail(event.target.value) : setPhone(event.target.value)
              }
              placeholder={method === "email" ? "输入对方邮箱" : "输入对方手机号"}
            />
          </label>
        )}
        <label>
          <ShieldCheckIcon size={20} />
          成员角色
          <Select value={role} onValueChange={(value) => setRole(value as "member" | "admin")}>
            <SelectTrigger aria-label="成员角色">
              <SelectValue placeholder="请选择角色" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="member">成员</SelectItem>
                <SelectItem value="admin">管理员</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </label>
        {method === "link" && (
          <Button className="sub-action invite-link-row" type="button" variant="ghost">
            <LinkIcon size={21} />
            复制邀请链接
            <CaretRightIcon />
          </Button>
        )}
        <Button onClick={() => void send()}>发送邀请</Button>
        {message && (
          <p className="success-note">
            <CheckCircleIcon /> {message}
          </p>
        )}
      </div>
    </>
  );
}
export function MemberRolePage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const bookId = search.get("bookId"),
    memberId = search.get("memberId");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [error, setError] = useState("");
  const save = async () => {
    if (!bookId || !memberId) return;
    try {
      await api(`/books/${bookId}/members/${memberId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      navigate("/members");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    }
  };
  return (
    <>
      <Page title="成员权限" />
      <Panel className="role-intro">
        <span>
          <UserCircleIcon size={25} weight="fill" />
        </span>
        <h2>编辑成员角色</h2>
        <p>管理员可邀请成员、调整权限；成员可查看账本并新增自己的记录。</p>
      </Panel>
      <RadioGroup
        className="role-options"
        value={role}
        onValueChange={(value) => setRole(value as "admin" | "member")}
      >
        {(["admin", "member"] as const).map((value) => (
          <label key={value}>
            <RadioGroupItem value={value} aria-label={value === "admin" ? "管理员" : "成员"} />
            {value === "admin" ? "管理员" : "成员"}
            <small>{value === "admin" ? "可邀请成员、管理成员" : "可查看账本并记录"}</small>
          </label>
        ))}
      </RadioGroup>
      {error && <p className="field-error">{error}</p>}
      <Button onClick={() => void save()}>保存权限</Button>
    </>
  );
}

function roleLabel(role: Member["role"]) {
  if (role === "creator") return "创建者";
  if (role === "admin") return "管理员";
  return "成员";
}
