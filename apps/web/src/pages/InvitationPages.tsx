import { Button, Panel } from "@shared-ledger/ui";
import { Page } from "../components/layout/Page";
import { useActiveBook } from "../hooks/useActiveBook";
import { useApi } from "../hooks/useApi";
import { api } from "../lib";

type Invitation = {
  id: string;
  role: string;
  status: string;
  expiresAt: string;
  inviteeEmail?: string;
  inviteePhone?: string;
};
export function ReceivedInvitationsPage() {
  const { data, reload } = useApi<{ invitations: Invitation[] }>("/invitations/received");
  const respond = async (id: string, action: "accept" | "decline") => {
    await api(`/invitations/${id}/${action}`, { method: "POST" });
    await reload();
  };
  return (
    <>
      <Page title="我的邀请" />
      <Panel>
        {data?.invitations.map((invitation) => (
          <div className="history-row" key={invitation.id}>
            <div>
              <strong>{invitation.role === "admin" ? "管理员邀请" : "成员邀请"}</strong>
              <small>有效至 {new Date(invitation.expiresAt).toLocaleString("zh-CN")}</small>
            </div>
            {invitation.status === "pending" ? (
              <span>
                <Button onClick={() => void respond(invitation.id, "accept")}>接受</Button>
                <button onClick={() => void respond(invitation.id, "decline")}>拒绝</button>
              </span>
            ) : (
              <span>{invitation.status}</span>
            )}
          </div>
        ))}
        {!data?.invitations.length && <p className="muted">没有待处理邀请</p>}
      </Panel>
    </>
  );
}
export function SentInvitationsPage() {
  const { book } = useActiveBook();
  const { data, reload } = useApi<{ invitations: Invitation[] }>(
    book ? `/books/${book.id}/invitations` : undefined,
  );
  const action = async (id: string, endpoint: "remind" | "revoke") => {
    await api(`/invitations/${id}/${endpoint}`, { method: "POST" });
    await reload();
  };
  return (
    <>
      <Page title="已发邀请" />
      <Panel>
        {data?.invitations.map((invitation) => (
          <div className="history-row" key={invitation.id}>
            <div>
              <strong>{invitation.inviteeEmail || invitation.inviteePhone || "未命名受邀人"}</strong>
              <small>
                {invitation.role} · {invitation.status}
              </small>
            </div>
            {invitation.status === "pending" && (
              <span>
                <button onClick={() => void action(invitation.id, "remind")}>提醒</button>
                <button onClick={() => void action(invitation.id, "revoke")}>撤回</button>
              </span>
            )}
          </div>
        ))}
        {!data?.invitations.length && <p className="muted">没有已发邀请</p>}
      </Panel>
    </>
  );
}
