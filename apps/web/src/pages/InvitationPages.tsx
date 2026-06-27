import { CheckCircleIcon, ClockCounterClockwiseIcon, ProhibitIcon, UserPlusIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { IconTile, IosButton, IosCard, IosPage, IosScroll, IosTopBar } from "../components/ios/IosDesign";
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
    try {
      await api(`/invitations/${id}/${action}`, { method: "POST" });
      toast.success(action === "accept" ? "已接受邀请" : "已拒绝邀请", { duration: 2600, closeButton: true });
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "操作失败", { duration: 3000, closeButton: true });
    }
  };
  return (
    <IosPage>
      <IosTopBar title="我的邀请" />
      <IosScroll className="ios-account-scroll">
        <IosCard className="ios-invitation-list">
          {data?.invitations.map((invitation) => (
            <InvitationRow
              invitation={invitation}
              icon="received"
              actions={
                invitation.status === "pending" ? (
                  <>
                    <button type="button" onClick={() => void respond(invitation.id, "accept")}>
                      接受
                    </button>
                    <button type="button" onClick={() => void respond(invitation.id, "decline")}>
                      拒绝
                    </button>
                  </>
                ) : undefined
              }
              key={invitation.id}
            />
          ))}
          {!data?.invitations.length && <p className="muted">没有待处理邀请</p>}
        </IosCard>
      </IosScroll>
    </IosPage>
  );
}

export function SentInvitationsPage() {
  const { book } = useActiveBook();
  const { data, reload } = useApi<{ invitations: Invitation[] }>(book ? `/books/${book.id}/invitations` : undefined);
  const action = async (id: string, endpoint: "remind" | "revoke") => {
    try {
      await api(`/invitations/${id}/${endpoint}`, { method: "POST" });
      toast.success(endpoint === "remind" ? "提醒已发送" : "邀请已撤回", { duration: 2600, closeButton: true });
      await reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "操作失败", { duration: 3000, closeButton: true });
    }
  };
  return (
    <IosPage>
      <IosTopBar title="已发邀请" />
      <IosScroll className="ios-account-scroll">
        <IosCard className="ios-invitation-list">
          {data?.invitations.map((invitation) => (
            <InvitationRow
              invitation={invitation}
              icon="sent"
              actions={
                invitation.status === "pending" ? (
                  <>
                    <button type="button" onClick={() => void action(invitation.id, "remind")}>
                      提醒
                    </button>
                    <button className="danger" type="button" onClick={() => void action(invitation.id, "revoke")}>
                      撤回
                    </button>
                  </>
                ) : undefined
              }
              key={invitation.id}
            />
          ))}
          {!data?.invitations.length && <p className="muted">没有已发邀请</p>}
        </IosCard>
        <IosButton variant="outline" onClick={() => history.back()}>返回</IosButton>
      </IosScroll>
    </IosPage>
  );
}

function InvitationRow({
  invitation,
  icon,
  actions,
}: {
  invitation: Invitation;
  icon: "received" | "sent";
  actions?: ReactNode;
}) {
  return (
    <div className="ios-invitation-row">
      <IconTile tint={icon === "received" ? "#fff0e8" : "#eaf1ff"} color={icon === "received" ? "#ff681c" : "#4c8dff"}>
        {icon === "received" ? <UserPlusIcon size={20} weight="fill" /> : <ClockCounterClockwiseIcon size={20} weight="fill" />}
      </IconTile>
      <span>
        <b>{invitation.inviteeEmail || invitation.inviteePhone || (invitation.role === "admin" ? "管理员邀请" : "成员邀请")}</b>
        <small>
          {roleLabel(invitation.role)} · {statusLabel(invitation.status)}
          {invitation.expiresAt ? ` · 有效至 ${new Date(invitation.expiresAt).toLocaleDateString("zh-CN")}` : ""}
        </small>
      </span>
      {actions ? <div className="ios-inline-actions">{actions}</div> : <em>{statusIcon(invitation.status)}</em>}
    </div>
  );
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

function roleLabel(role: string) {
  return role === "admin" ? "管理员" : "成员";
}
