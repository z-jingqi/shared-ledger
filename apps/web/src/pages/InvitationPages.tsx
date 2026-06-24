import { CheckCircleIcon, ClockCounterClockwiseIcon, ProhibitIcon, UserPlusIcon } from "@phosphor-icons/react";
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
      <Panel className="invitation-list">
        {data?.invitations.map((invitation) => (
          <div className="history-row invitation-row" key={invitation.id}>
            <span className="invitation-icon">
              <UserPlusIcon size={22} weight="fill" />
            </span>
            <div>
              <strong>{invitation.role === "admin" ? "管理员邀请" : "成员邀请"}</strong>
              <small>有效至 {new Date(invitation.expiresAt).toLocaleString("zh-CN")}</small>
            </div>
            {invitation.status === "pending" ? (
              <span className="inline-actions">
                <Button onClick={() => void respond(invitation.id, "accept")}>
                  <CheckCircleIcon size={16} />
                  接受
                </Button>
                <Button variant="outline" onClick={() => void respond(invitation.id, "decline")}>
                  <ProhibitIcon size={16} />
                  拒绝
                </Button>
              </span>
            ) : (
              <span className="status">{statusLabel(invitation.status)}</span>
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
      <Panel className="invitation-list">
        {data?.invitations.map((invitation) => (
          <div className="history-row invitation-row" key={invitation.id}>
            <span className="invitation-icon">
              <ClockCounterClockwiseIcon size={22} weight="fill" />
            </span>
            <div>
              <strong>{invitation.inviteeEmail || invitation.inviteePhone || "未命名受邀人"}</strong>
              <small>
                {invitation.role === "admin" ? "管理员" : "成员"} · {statusLabel(invitation.status)}
              </small>
            </div>
            {invitation.status === "pending" && (
              <span className="inline-actions">
                <Button variant="outline" onClick={() => void action(invitation.id, "remind")}>
                  提醒
                </Button>
                <Button variant="destructive" onClick={() => void action(invitation.id, "revoke")}>
                  撤回
                </Button>
              </span>
            )}
          </div>
        ))}
        {!data?.invitations.length && <p className="muted">没有已发邀请</p>}
      </Panel>
    </>
  );
}

function statusLabel(status: string) {
  if (status === "pending") return "待处理";
  if (status === "accepted") return "已接受";
  if (status === "declined") return "已拒绝";
  if (status === "revoked") return "已撤回";
  return status;
}
