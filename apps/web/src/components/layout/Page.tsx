import { ArrowLeftIcon } from "@phosphor-icons/react";
import { PageTitle } from "@shared-ledger/ui";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

export function BackButton({ to }: { to?: string }) {
  const navigate = useNavigate();
  return (
    <button className="back" onClick={() => (to ? navigate(to) : navigate(-1))} aria-label="返回">
      <ArrowLeftIcon size={24} />
    </button>
  );
}

export function Page({
  title,
  children,
  action,
  back = true,
  backTo,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  back?: boolean;
  backTo?: string;
}) {
  return (
    <>
      <PageTitle title={title} left={back ? <BackButton to={backTo} /> : undefined} action={action} />
      {children}
    </>
  );
}
