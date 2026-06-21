import { CaretRightIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { Button, Panel } from "@shared-ledger/ui";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Page } from "../components/layout/Page";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api } from "../lib";

type Member = { id: string; name: string; role: "creator" | "admin" | "member" };
export function MembersPage() {
  const { book } = useActiveBook();
  const { data } = useApi<{ members: Member[] }>(book ? `/books/${book.id}/members` : undefined);
  return (
    <>
      <Page
        title="成员管理"
        action={
          <Link className="text-action" to={`/members/invite?bookId=${book?.id ?? ""}`}>
            邀请
          </Link>
        }
      />
      <Panel>
        {data?.members.map((member) => (
          <Link
            to={`/members/role?bookId=${book?.id ?? ""}&memberId=${member.id}`}
            className="member-row"
            key={member.id}
          >
            <span>{member.name.slice(0, 1)}</span>
            <div>
              <strong>{member.name}</strong>
              <small>{member.role}</small>
            </div>
            <CaretRightIcon />
          </Link>
        ))}
        {!data?.members.length && <p className="muted">暂无成员</p>}
      </Panel>
      <Link className="sub-action" to="/invitations/received">
        我的邀请 <CaretRightIcon />
      </Link>
      <Link className="sub-action" to="/invitations/sent">
        已发邀请 <CaretRightIcon />
      </Link>
    </>
  );
}
export function InviteMemberPage() {
  const { book } = useActiveBook();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
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
      <div className="form">
        <label>
          邮箱
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="输入对方邮箱"
          />
        </label>
        <label>
          手机号
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="或输入手机号"
          />
        </label>
        <label>
          成员角色
          <select value={role} onChange={(event) => setRole(event.target.value as "member" | "admin")}>
            <option value="member">成员</option>
            <option value="admin">管理员</option>
          </select>
        </label>
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
      <div className="role-options">
        {(["admin", "member"] as const).map((value) => (
          <label key={value}>
            <input type="radio" name="role" checked={role === value} onChange={() => setRole(value)} />
            {value === "admin" ? "管理员" : "成员"}
            <small>{value === "admin" ? "可邀请成员、管理成员" : "可查看账本并记录"}</small>
          </label>
        ))}
      </div>
      {error && <p className="field-error">{error}</p>}
      <Button onClick={() => void save()}>保存权限</Button>
    </>
  );
}
